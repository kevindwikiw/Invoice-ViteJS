import { Hono } from "hono";
import { galleryOne, galleryRun } from "../db/galleries";
import {
    checkMidtransStatus,
    createQrisCharge,
    isMidtransConfigured,
    verifyMidtransSignature,
} from "../lib/midtrans";
import { getGallerySettings } from "../lib/gallery-settings-cache";

const paymentsRouter = new Hono();

export interface DiscountRule {
    minCount: number;
    discountPercent: number;
}

export const DEFAULT_ADDON_DISCOUNT_RULES: DiscountRule[] = [
    { minCount: 20, discountPercent: 20 },
    { minCount: 10, discountPercent: 10 },
];

function parseDiscountRules(raw?: string): DiscountRule[] {
    if (!raw) return DEFAULT_ADDON_DISCOUNT_RULES;
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
        // ignore fallback to default
    }
    return DEFAULT_ADDON_DISCOUNT_RULES;
}

function calculateQuote(count: number, unitPrice: number, rules?: DiscountRule[]) {
    let discountPercent = 0;
    const activeRules = rules && rules.length > 0 ? rules : DEFAULT_ADDON_DISCOUNT_RULES;
    const sortedRules = [...activeRules].sort((a, b) => b.minCount - a.minCount);
    for (const rule of sortedRules) {
        if (count >= rule.minCount) {
            discountPercent = rule.discountPercent;
            break;
        }
    }
    const normalTotal = count * unitPrice;
    const total = Math.round(normalTotal * (1 - discountPercent / 100));
    return { discountPercent, normalTotal, total, savings: normalTotal - total };
}

// 1. Create QRIS Transaction for Gallery Add-on
paymentsRouter.post("/qris/create", async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const galleryIdentifier = String(body.galleryId || "").trim();
        const requestedCount = Math.max(1, Math.min(500, Number(body.requestedCount) || 0));

        if (!galleryIdentifier || !requestedCount) {
            return c.json({ error: "Invalid galleryId or requestedCount" }, 400);
        }

        // Fetch gallery row
        const gallery = await galleryOne<any>(
            `SELECT id, title, public_key, edit_addon_price, additional_selection_limit, edit_addon_status, qris_enabled
             FROM galleries
             WHERE id = ? OR public_key = ?`,
            [Number(galleryIdentifier) || -1, galleryIdentifier]
        );

        if (!gallery) {
            return c.json({ error: "Gallery not found" }, 404);
        }
        if (!gallery.qris_enabled) {
            return c.json({ error: "QRIS self-service is not enabled for this gallery." }, 403);
        }

        const unitPrice = Number(gallery.edit_addon_price || 10_000);
        const settings = await getGallerySettings();
        const discountRules = parseDiscountRules(settings.addon_discount_rules);
        const quote = calculateQuote(requestedCount, unitPrice, discountRules);
        const grossAmount = quote.total;

        // Generate unique order ID
        const orderId = `ORBIT-ADDON-${gallery.id}-${Date.now()}`;
        const itemName = `Add-on ${requestedCount} Photos - ${gallery.title}`.slice(0, 50);

        // Call Midtrans QRIS charge
        const chargeResult = await createQrisCharge({
            orderId,
            grossAmount,
            itemName,
            customerName: gallery.title,
        });

        // Store transaction in database
        const metadata = JSON.stringify({
            requestedCount,
            galleryId: gallery.id,
            galleryTitle: gallery.title,
            unitPrice,
            discountPercent: quote.discountPercent,
        });

        await galleryRun(
            `INSERT INTO payment_transactions (
                order_id, entity_type, entity_id, gross_amount, payment_type,
                transaction_status, qr_string, qr_url, expiry_time, metadata
            ) VALUES (?, 'gallery_addon', ?, ?, 'qris', ?, ?, ?, ?, ?)`,
            [
                orderId,
                gallery.id,
                grossAmount,
                chargeResult.transactionStatus,
                chargeResult.qrString || null,
                chargeResult.qrUrl || null,
                chargeResult.expiryTime || null,
                metadata,
            ]
        );

        return c.json({
            success: true,
            orderId,
            grossAmount,
            requestedCount,
            qrString: chargeResult.qrString,
            qrUrl: chargeResult.qrUrl,
            expiryTime: chargeResult.expiryTime,
            isSimulated: chargeResult.isSimulated || !isMidtransConfigured(),
        });
    } catch (error: any) {
        console.error("Failed to create QRIS charge:", error);
        return c.json({ error: error.message || "Failed to create QRIS payment" }, 500);
    }
});

// 2. Check Status of a Payment Transaction
paymentsRouter.get("/status/:orderId", async (c) => {
    const orderId = c.req.param("orderId");
    if (!orderId) return c.json({ error: "orderId is required" }, 400);

    const tx = await galleryOne<any>(
        `SELECT order_id, entity_type, entity_id, gross_amount, transaction_status, qr_url, expiry_time, metadata
         FROM payment_transactions
         WHERE order_id = ?`,
        [orderId]
    );

    if (!tx) return c.json({ error: "Transaction not found" }, 404);

    // If still pending and Midtrans is active, check remote status
    if (tx.transaction_status === "pending" && isMidtransConfigured()) {
        try {
            const remote = await checkMidtransStatus(orderId);
            if (remote && (remote.status === "settlement" || remote.status === "capture")) {
                await fulfillPayment(tx);
                tx.transaction_status = "settlement";
            } else if (remote && (remote.status === "expire" || remote.status === "cancel")) {
                await galleryRun(
                    `UPDATE payment_transactions SET transaction_status = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ?`,
                    [remote.status, orderId]
                );
                tx.transaction_status = remote.status;
            }
        } catch (e) {
            console.warn("Could not check remote Midtrans status:", e);
        }
    }

    return c.json({
        orderId: tx.order_id,
        status: tx.transaction_status,
        grossAmount: tx.gross_amount,
        entityType: tx.entity_type,
        entityId: tx.entity_id,
        expiryTime: tx.expiry_time,
    });
});

// Helper to fulfill a payment
async function fulfillPayment(tx: any) {
    if (tx.transaction_status === "settlement") return;

    await galleryRun(
        `UPDATE payment_transactions
         SET transaction_status = 'settlement', updated_at = CURRENT_TIMESTAMP
         WHERE order_id = ?`,
        [tx.order_id]
    );

    if (tx.entity_type === "gallery_addon") {
        try {
            const meta = typeof tx.metadata === "string" ? JSON.parse(tx.metadata) : tx.metadata;
            const additionalCount = Number(meta?.requestedCount) || 0;

            if (additionalCount > 0) {
                await galleryRun(
                    `UPDATE galleries
                     SET additional_selection_limit = additional_selection_limit + ?,
                         edit_addon_status = 'paid',
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [additionalCount, tx.entity_id]
                );
                console.info(`[QRIS] Quota added: +${additionalCount} photos to gallery ID ${tx.entity_id}`);
            }
        } catch (err) {
            console.error("Failed to parse metadata or fulfill gallery quota:", err);
        }
    }
}

// 3. Simulate Successful Payment (For Developer Sandbox Testing)
paymentsRouter.post("/simulate-success/:orderId", async (c) => {
    const orderId = c.req.param("orderId");
    const tx = await galleryOne<any>(
        `SELECT * FROM payment_transactions WHERE order_id = ?`,
        [orderId]
    );

    if (!tx) return c.json({ error: "Transaction not found" }, 404);

    await fulfillPayment(tx);

    return c.json({
        success: true,
        message: "Payment successfully simulated and gallery quota unlocked!",
        orderId,
    });
});

// 4. Midtrans Webhook Notification
paymentsRouter.post("/webhook", async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const orderId = String(body.order_id || "");
        const statusCode = String(body.status_code || "");
        const grossAmount = String(body.gross_amount || "");
        const signatureKey = String(body.signature_key || "");
        const transactionStatus = String(body.transaction_status || "");

        if (!orderId || !signatureKey) {
            return c.json({ error: "Missing required webhook parameters" }, 400);
        }

        // Verify Signature
        if (isMidtransConfigured()) {
            const isValid = verifyMidtransSignature(orderId, statusCode, grossAmount, signatureKey);
            if (!isValid) {
                console.warn(`[Midtrans Webhook] Invalid signature for order: ${orderId}`);
                return c.json({ error: "Invalid signature" }, 403);
            }
        }

        const tx = await galleryOne<any>(
            `SELECT * FROM payment_transactions WHERE order_id = ?`,
            [orderId]
        );

        if (!tx) {
            console.warn(`[Midtrans Webhook] Transaction not found for order: ${orderId}`);
            return c.json({ message: "Transaction not found" }, 200);
        }

        if (transactionStatus === "settlement" || transactionStatus === "capture") {
            await fulfillPayment(tx);
        } else if (
            transactionStatus === "expire" ||
            transactionStatus === "cancel" ||
            transactionStatus === "deny"
        ) {
            await galleryRun(
                `UPDATE payment_transactions
                 SET transaction_status = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE order_id = ?`,
                [transactionStatus, orderId]
            );
        }

        return c.json({ status: "OK" }, 200);
    } catch (error: any) {
        console.error("[Midtrans Webhook] Error processing notification:", error);
        return c.json({ error: error.message || "Internal server error" }, 500);
    }
});

export default paymentsRouter;
