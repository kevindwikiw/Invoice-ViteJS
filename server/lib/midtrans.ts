import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

export interface QrisChargeParams {
    orderId: string;
    grossAmount: number;
    itemName: string;
    customerName?: string;
    customerEmail?: string;
}

export interface QrisChargeResult {
    orderId: string;
    grossAmount: number;
    transactionStatus: string;
    qrString?: string;
    qrUrl?: string;
    expiryTime?: string;
    isSimulated?: boolean;
}

export function isMidtransConfigured(): boolean {
    const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim();
    return Boolean(serverKey && serverKey.length > 5);
}

export function getMidtransConfig() {
    const serverKey = process.env.MIDTRANS_SERVER_KEY?.trim() || "";
    const clientKey = process.env.MIDTRANS_CLIENT_KEY?.trim() || "";
    const isProduction = process.env.MIDTRANS_IS_PRODUCTION === "true";
    const baseUrl = isProduction
        ? "https://api.midtrans.com"
        : "https://api.sandbox.midtrans.com";

    return {
        serverKey,
        clientKey,
        isProduction,
        baseUrl,
    };
}

export function verifyMidtransSignature(
    orderId: string,
    statusCode: string,
    grossAmount: string,
    incomingSignature: string
): boolean {
    const { serverKey } = getMidtransConfig();
    if (!serverKey) return false;

    // Standard Midtrans Signature Algorithm: SHA512(order_id + status_code + gross_amount + ServerKey)
    const payload = `${orderId}${statusCode}${grossAmount}${serverKey}`;
    const calculated = createHash("sha512").update(payload).digest("hex");
    return calculated.toLowerCase() === incomingSignature.toLowerCase();
}

export async function createQrisCharge(params: QrisChargeParams): Promise<QrisChargeResult> {
    const config = getMidtransConfig();

    // If Server Key is not yet configured, provide a clean Mock QRIS for instant developer sandbox testing
    if (!config.serverKey) {
        const dummyQrString = `00020101021226590014ID.ORBIT.WWW01189360091100220673470215${params.orderId}520458125303360540${params.grossAmount}5802ID5914The Orbit Photo6007Jakarta6304`;
        const dummyQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(dummyQrString)}`;
        const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();

        return {
            orderId: params.orderId,
            grossAmount: params.grossAmount,
            transactionStatus: "pending",
            qrString: dummyQrString,
            qrUrl: dummyQrUrl,
            expiryTime: expiry,
            isSimulated: true,
        };
    }

    const authHeader = Buffer.from(`${config.serverKey}:`).toString("base64");
    const payload = {
        payment_type: "qris",
        transaction_details: {
            order_id: params.orderId,
            gross_amount: Math.round(params.grossAmount),
        },
        qris: {
            acquirer: "gopay",
        },
        item_details: [
            {
                id: params.orderId,
                price: Math.round(params.grossAmount),
                quantity: 1,
                name: params.itemName.slice(0, 50),
            },
        ],
        customer_details: {
            first_name: (params.customerName || "Client").slice(0, 50),
            email: params.customerEmail || "client@theorbitphoto.com",
        },
    };

    const response = await fetch(`${config.baseUrl}/v2/charge`, {
        method: "POST",
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": `Basic ${authHeader}`,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Midtrans QRIS charge error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
        status_code: string;
        transaction_status: string;
        actions?: Array<{ name: string; url: string; method?: string }>;
        qr_string?: string;
        expiry_time?: string;
    };

    const qrAction = data.actions?.find((a) => a.name === "generate-qr-code");

    return {
        orderId: params.orderId,
        grossAmount: params.grossAmount,
        transactionStatus: data.transaction_status || "pending",
        qrString: data.qr_string,
        qrUrl: qrAction?.url,
        expiryTime: data.expiry_time,
        isSimulated: false,
    };
}

export async function checkMidtransStatus(orderId: string): Promise<{ status: string; statusCode: string } | null> {
    const config = getMidtransConfig();
    if (!config.serverKey) return null;

    const authHeader = Buffer.from(`${config.serverKey}:`).toString("base64");
    const response = await fetch(`${config.baseUrl}/v2/${orderId}/status`, {
        headers: {
            "Accept": "application/json",
            "Authorization": `Basic ${authHeader}`,
        },
    });

    if (!response.ok) return null;
    const data = (await response.json()) as { transaction_status?: string; status_code?: string };
    return {
        status: data.transaction_status || "unknown",
        statusCode: data.status_code || "404",
    };
}
