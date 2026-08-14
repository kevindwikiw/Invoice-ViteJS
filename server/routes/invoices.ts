import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { invoices, appConfig } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { hasFeaturePermission } from "../permissions";

const invoicesRouter = new Hono();
const sqlite = new Database("db/sqlite.db");
const db = drizzle(sqlite);
const PROOF_DIR = "uploads/proofs";

type AuthUser = {
    sub: number;
    email: string;
    name: string;
    role: string;
};

type InvoiceActivityInput = {
    invoiceId: number;
    action: "CREATED" | "UPDATED" | "DELETED" | "BATCH_DELETED" | "PROOF_UPLOADED" | "PROOF_DELETED";
    actor?: AuthUser;
    details?: string;
    ipAddress?: string;
};

function getClientIp(c: any): string {
    return c.req.header("x-forwarded-for")?.split(",")[0].trim()
        || c.req.header("x-real-ip")
        || "unknown";
}

function logInvoiceActivity(input: InvoiceActivityInput) {
    try {
        sqlite.prepare(`
            INSERT INTO invoice_activity_logs (
                invoice_id, action, actor_id, actor_email, actor_name, actor_role, details, ip_address
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            input.invoiceId,
            input.action,
            input.actor?.sub || null,
            input.actor?.email || null,
            input.actor?.name || null,
            input.actor?.role || null,
            input.details || null,
            input.ipAddress || null
        );
    } catch (e) {
        console.error("Failed to log invoice activity:", e);
    }
}


invoicesRouter.get("/activity", async (c) => {
    const user = c.get("user" as any) as AuthUser | undefined;
    if (!user || !hasFeaturePermission(sqlite, user, "view_billing_history")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const search = (c.req.query("search") || "").trim().toLowerCase();
        const action = (c.req.query("action") || "").trim().toUpperCase();
        const limitParam = parseInt(c.req.query("limit") || "100");
        const pageParam = parseInt(c.req.query("page") || "1");
        const safeLimit = Math.min(Math.max(limitParam, 1), 300);
        const requestedPage = Math.max(pageParam, 1);
        const conditions: string[] = [];
        const queryParams: Array<string | number> = [];

        if (action && action !== "ALL") {
            conditions.push("UPPER(l.action) = ?");
            queryParams.push(action);
        }
        if (search) {
            const pattern = `%${search}%`;
            conditions.push(`(
                LOWER(COALESCE(i.invoice_no, '')) LIKE ?
                OR LOWER(COALESCE(i.client_name, '')) LIKE ?
                OR LOWER(COALESCE(l.actor_name, '')) LIKE ?
                OR LOWER(COALESCE(l.actor_email, '')) LIKE ?
                OR LOWER(COALESCE(l.details, '')) LIKE ?
                OR LOWER(COALESCE(l.action, '')) LIKE ?
                OR CAST(l.invoice_id AS TEXT) LIKE ?
            )`);
            queryParams.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const summary = sqlite.prepare(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN l.action = 'CREATED' THEN 1 ELSE 0 END) as created,
                SUM(CASE WHEN l.action = 'UPDATED' THEN 1 ELSE 0 END) as updated,
                SUM(CASE WHEN l.action IN ('PROOF_UPLOADED', 'PROOF_DELETED') THEN 1 ELSE 0 END) as proofs
            FROM invoice_activity_logs l
            LEFT JOIN invoices i ON i.id = l.invoice_id
            ${whereClause}
        `).get(...queryParams) as {
            total: number;
            created: number | null;
            updated: number | null;
            proofs: number | null;
        };

        const total = Number(summary.total || 0);
        const totalPages = Math.max(1, Math.ceil(total / safeLimit));
        const safePage = Math.min(requestedPage, totalPages);
        const offset = (safePage - 1) * safeLimit;

        const rows = sqlite.prepare(`
            SELECT
                l.id,
                l.invoice_id as invoiceId,
                l.action,
                l.actor_id as actorId,
                l.actor_email as actorEmail,
                l.actor_name as actorName,
                l.actor_role as actorRole,
                l.details,
                l.ip_address as ipAddress,
                l.created_at as createdAt,
                i.invoice_no as invoiceNo,
                i.client_name as clientName
            FROM invoice_activity_logs l
            LEFT JOIN invoices i ON i.id = l.invoice_id
            ${whereClause}
            ORDER BY l.id DESC
            LIMIT ? OFFSET ?
        `).all(...queryParams, safeLimit, offset) as Array<Record<string, unknown>>;

        return c.json({
            items: rows,
            page: safePage,
            limit: safeLimit,
            total,
            totalPages,
            stats: {
                total,
                created: Number(summary.created || 0),
                updated: Number(summary.updated || 0),
                proofs: Number(summary.proofs || 0),
            },
        });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});
// Stats endpoint
invoicesRouter.get("/stats", async (c) => {
    const user = c.get("user" as any) as AuthUser | undefined;
    if (!user || !hasFeaturePermission(sqlite, user, "view_billing_history")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const allInvoices = await db.select().from(invoices).orderBy(desc(invoices.id));

        let totalRevenue = 0;
        let cntLunas = 0;
        let cntDp = 0;
        let cntUnpaid = 0;

        for (const inv of allInvoices) {
            totalRevenue += inv.totalAmount || 0;

            let paymentTerms: any[] = [];
            try {
                if (inv.invoiceData) {
                    const data = JSON.parse(inv.invoiceData as string);
                    paymentTerms = data.paymentTerms || [];
                }
            } catch { /* ignore parse errors */ }

            if (Array.isArray(paymentTerms) && paymentTerms.length > 0) {
                const pelunasan = paymentTerms.find((t: any) =>
                    t.id === "full" || (t.label && t.label.toLowerCase().includes("pelunasan"))
                );
                const isLunas = pelunasan && Number(pelunasan.amount || 0) > 0;

                if (isLunas) {
                    cntLunas++;
                } else {
                    const hasDp = paymentTerms.some((t: any) =>
                        t.id !== "full" && Number(t.amount || 0) > 0
                    );
                    if (hasDp) cntDp++;
                    else cntUnpaid++;
                }
            } else {
                cntUnpaid++;
            }
        }

        return c.json({
            total: allInvoices.length,
            totalRevenue,
            lunas: cntLunas,
            dp: cntDp,
            unpaid: cntUnpaid,
        });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

invoicesRouter.get("/", async (c) => {
    const user = c.get("user" as any) as AuthUser | undefined;
    if (!user || !hasFeaturePermission(sqlite, user, "view_billing_history")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const search = c.req.query("search") || "";
        const limitParam = parseInt(c.req.query("limit") || "50");
        const safeLimit = Math.min(Math.max(limitParam, 1), 200);

        let result;
        if (search) {
            const pattern = `%${search}%`;
            result = sqlite.prepare(
                `SELECT * FROM invoices WHERE invoice_no LIKE ? OR client_name LIKE ? ORDER BY id DESC LIMIT ?`
            ).all(pattern, pattern, safeLimit);
        } else {
            result = await db.select().from(invoices).orderBy(desc(invoices.id)).limit(safeLimit);
        }

        return c.json(result);
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

invoicesRouter.get("/:id", async (c) => {
    const user = c.get("user" as any) as AuthUser | undefined;
    if (!user || !hasFeaturePermission(sqlite, user, "view_billing_history")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const id = c.req.param("id");
        const result = await db.select().from(invoices).where(eq(invoices.id, Number(id))).limit(1);
        if (result.length === 0) return c.json({ error: "Not found" }, 404);
        return c.json(result[0]);
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

invoicesRouter.patch("/:id/archive", async (c) => {
    const user = c.get("user" as any) as AuthUser | undefined;
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const id = parseInt(c.req.param("id"));
        if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

        const body = await c.req.json();
        const isArchived = body.isArchived ? 1 : 0;

        sqlite.prepare("UPDATE invoices SET is_archived = ? WHERE id = ?").run(isArchived, id);

        logInvoiceActivity({
            invoiceId: id,
            action: "UPDATED",
            actor: user,
            details: isArchived ? "Invoice archived" : "Invoice unarchived",
            ipAddress: getClientIp(c)
        });

        return c.json({ status: isArchived ? "archived" : "unarchived" });
    } catch (e) {
        console.error("Error archiving invoice:", e);
        return c.json({ error: String(e) }, 500);
    }
});

invoicesRouter.post("/batch-delete", async (c) => {
    const user = c.get("user" as any) as AuthUser | undefined;
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const { ids } = await c.req.json();
        if (!Array.isArray(ids) || ids.length === 0) {
            return c.json({ error: "No IDs provided" }, 400);
        }

        const normalizedIds = ids.map((value: unknown) => Number(value)).filter((value: number) => Number.isInteger(value));
        if (normalizedIds.length === 0) {
            return c.json({ error: "No valid IDs provided" }, 400);
        }

        const placeholders = normalizedIds.map(() => "?").join(",");

        const targetInvoices = sqlite.prepare(
            `SELECT id, payment_proofs FROM invoices WHERE id IN (${placeholders})`
        ).all(...normalizedIds) as Array<{ id: number; payment_proofs?: string | null }>;

        for (const inv of targetInvoices) {
            if (inv.payment_proofs) {
                try {
                    const proofsArr = JSON.parse(inv.payment_proofs);
                    if (Array.isArray(proofsArr)) {
                        for (const fileName of proofsArr) {
                            try {
                                await unlink(join(PROOF_DIR, fileName));
                            } catch { /* ignore if already missing */ }
                        }
                    }
                } catch { /* ignore json parse errors */ }
            }
        }

        const result = sqlite.prepare(`DELETE FROM invoices WHERE id IN (${placeholders})`).run(...normalizedIds);

        for (const id of normalizedIds) {
            logInvoiceActivity({
                invoiceId: id,
                action: "BATCH_DELETED",
                actor: user,
                details: `Invoice batch-deleted (${normalizedIds.length} total)`,
                ipAddress: getClientIp(c)
            });
        }

        const remaining = sqlite.query("SELECT COUNT(*) as cnt FROM invoices").get() as { cnt: number };
        if (remaining.cnt === 0) {
            sqlite.prepare("UPDATE sequences SET last_value = 0 WHERE name = 'invoice'").run();
        }

        return c.json({ status: "deleted", count: result.changes });
    } catch (e) {
        console.error("Error batch deleting invoices:", e);
        return c.json({ error: String(e) }, 500);
    }
});

invoicesRouter.delete("/:id", async (c) => {
    const user = c.get("user" as any) as AuthUser | undefined;
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const id = c.req.param("id");
        const numericId = Number(id);

        const inv = await db.select().from(invoices).where(eq(invoices.id, numericId)).get();
        if (inv && inv.paymentProofs) {
            try {
                const proofsArr = JSON.parse(inv.paymentProofs);
                if (Array.isArray(proofsArr)) {
                    for (const fileName of proofsArr) {
                        try {
                            await unlink(join(PROOF_DIR, fileName));
                        } catch { /* ignore file missing error */ }
                    }
                }
            } catch (e) {
                console.error("Error deleting proof files:", e);
            }
        }

        logInvoiceActivity({
            invoiceId: numericId,
            action: "DELETED",
            actor: user,
            details: `Invoice ${inv?.invoiceNo || id} deleted`,
            ipAddress: getClientIp(c)
        });

        sqlite.prepare(`DELETE FROM invoices WHERE id = ?`).run(numericId);

        const remaining = sqlite.query("SELECT COUNT(*) as cnt FROM invoices").get() as { cnt: number };
        if (remaining.cnt === 0) {
            sqlite.prepare("UPDATE sequences SET last_value = 0 WHERE name = 'invoice'").run();
        }

        return c.json({ status: "deleted" });
    } catch (e) {
        console.error("Error deleting invoice:", e);
        return c.json({ error: String(e) }, 500);
    }
});

invoicesRouter.put("/:id", async (c) => {
    const user = c.get("user" as any) as AuthUser | undefined;
    if (!user || !hasFeaturePermission(sqlite, user, "edit_billing_history")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const id = parseInt(c.req.param("id"));
        if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

        const body = await c.req.json();
        const {
            clientName,
            invoiceNo,
            venue,
            weddingDate,
            clientPhone,
            eventTitle,
            items,
            paymentTerms,
            cashback,
            totalAmount,
            bankName,
            bankAcc,
            bankHolder,
            terms,
            footerAddress,
            footerEmail,
            footerIG,
            footerPhone,
            waTemplate,
            hours,
            notes
        } = body;

        const invoiceData = JSON.stringify({
            items,
            paymentTerms,
            cashback,
            venue,
            weddingDate,
            clientPhone,
            eventTitle,
            bankName,
            bankAcc,
            bankHolder,
            terms,
            footerAddress,
            footerEmail,
            footerIG,
            footerPhone,
            waTemplate,
            hours: hours || '',
            notes: notes || ''
        });

        sqlite.prepare(`
            UPDATE invoices 
            SET invoice_no = ?, client_name = ?, date = ?, total_amount = ?, invoice_data = ?
            WHERE id = ?
        `).run(
            invoiceNo,
            clientName,
            weddingDate || new Date().toISOString().split('T')[0],
            totalAmount,
            invoiceData,
            id
        );

        logInvoiceActivity({
            invoiceId: id,
            action: "UPDATED",
            actor: user,
            details: `Updated invoice total: ${totalAmount}`,
            ipAddress: getClientIp(c)
        });

        return c.json({ id, invoiceNo, clientName, totalAmount, status: "updated" });
    } catch (e) {
        console.error("Error updating invoice:", e);
        return c.json({ error: String(e) }, 500);
    }
});

invoicesRouter.post("/", async (c) => {
    try {
        const user = c.get("user" as any) as AuthUser | undefined;
        if (!user || !hasFeaturePermission(sqlite, user, "edit_billing_history")) {
            return c.json({ error: "Permission denied" }, 403);
        }

        const body = await c.req.json();
        const {
            clientName,
            invoiceNo,
            venue,
            weddingDate,
            clientPhone,
            eventTitle,
            items,
            paymentTerms,
            cashback,
            totalAmount,
            bankName,
            bankAcc,
            bankHolder,
            terms,
            footerAddress,
            footerEmail,
            footerIG,
            footerPhone,
            waTemplate,
            hours,
            notes
        } = body;

        const invoiceData = JSON.stringify({
            items,
            paymentTerms,
            cashback,
            venue,
            weddingDate,
            clientPhone,
            eventTitle,
            bankName,
            bankAcc,
            bankHolder,
            terms,
            footerAddress,
            footerEmail,
            footerIG,
            footerPhone,
            waTemplate,
            hours: hours || '',
            notes: notes || ''
        });

        const transaction = sqlite.transaction(() => {
            let finalInvoiceNo = invoiceNo;
            const seq = sqlite.query("SELECT * FROM sequences WHERE name = 'invoice'").get() as { prefix: string, padding: number, last_value: number } | null;

            if (seq) {
                const nextVal = seq.last_value + 1;
                if (!finalInvoiceNo) {
                    const paddedSeq = String(nextVal).padStart(seq.padding, '0');
                    finalInvoiceNo = `${seq.prefix}${paddedSeq}_${clientName.replace(/\s+/g, '_')}`;
                }
                sqlite.prepare("UPDATE sequences SET last_value = ? WHERE name = 'invoice'").run(nextVal);
            } else if (!finalInvoiceNo) {
                throw new Error("Invoice sequence configuration missing");
            }

            const result = sqlite.prepare(`
                INSERT INTO invoices (invoice_no, client_name, date, total_amount, invoice_data)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                finalInvoiceNo,
                clientName,
                weddingDate || new Date().toISOString().split('T')[0],
                totalAmount,
                invoiceData
            );

            return { id: result.lastInsertRowid, invoiceNo: finalInvoiceNo };
        });

        const { id: insertedId, invoiceNo: generatedNo } = transaction();
        const numericInvoiceId = Number(insertedId);

        logInvoiceActivity({
            invoiceId: numericInvoiceId,
            action: "CREATED",
            actor: user,
            details: `Created invoice ${generatedNo} for ${clientName}`,
            ipAddress: getClientIp(c)
        });

        return c.json({
            id: numericInvoiceId,
            invoiceNo: generatedNo,
            clientName,
            totalAmount,
            status: "created"
        });
    } catch (e) {
        console.error("Error creating invoice:", e);
        return c.json({ error: String(e) }, 500);
    }
});

invoicesRouter.post("/:id/proofs", async (c) => {
    const user = c.get("user" as any) as AuthUser | undefined;
    if (!user || !hasFeaturePermission(sqlite, user, "edit_billing_history")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const id = parseInt(c.req.param("id"));
        if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

        const body = await c.req.parseBody({ all: true });
        let files = body['file'];

        if (!files) return c.json({ error: "No files uploaded" }, 400);
        if (!Array.isArray(files)) files = [files];

        const validFiles = (files as File[]).filter(f => f instanceof File && f.size > 0);
        if (validFiles.length === 0) return c.json({ error: "No valid files uploaded" }, 400);

        const newFilenames: string[] = [];
        for (const file of validFiles) {
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}_${file.name.replace(/\s+/g, '_')}`;
            const filePath = join(PROOF_DIR, fileName);
            await Bun.write(filePath, file);
            newFilenames.push(fileName);
        }

        const inv = await db.select().from(invoices).where(eq(invoices.id, id)).get();
        if (!inv) return c.json({ error: "Invoice not found" }, 404);

        let currentProofs: string[] = [];
        try {
            currentProofs = inv.paymentProofs ? JSON.parse(inv.paymentProofs) : [];
        } catch (e) {
            console.error("[Upload] JSON Parse Error:", e);
        }

        const updatedProofs = [...currentProofs, ...newFilenames];

        await db.update(invoices)
            .set({ paymentProofs: JSON.stringify(updatedProofs) })
            .where(eq(invoices.id, id));

        logInvoiceActivity({
            invoiceId: id,
            action: "PROOF_UPLOADED",
            actor: user,
            details: `Uploaded ${newFilenames.length} proof file(s)`,
            ipAddress: getClientIp(c)
        });

        return c.json({ status: "success", proofs: updatedProofs });
    } catch (e) {
        console.error("Error uploading proof:", e);
        return c.json({ error: String(e) }, 500);
    }
});

invoicesRouter.delete("/:id/proofs/:filename", async (c) => {
    const user = c.get("user" as any) as AuthUser | undefined;
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const id = parseInt(c.req.param("id"));
        const filename = c.req.param("filename");

        if (isNaN(id) || !filename) return c.json({ error: "Invalid parameters" }, 400);

        const inv = await db.select().from(invoices).where(eq(invoices.id, id)).get();
        if (!inv) return c.json({ error: "Invoice not found" }, 404);

        let currentProofs: string[] = [];
        try {
            currentProofs = inv.paymentProofs ? JSON.parse(inv.paymentProofs) : [];
        } catch { /* ignore parse error */ }

        const updatedProofs = currentProofs.filter(p => p !== filename);

        await db.update(invoices)
            .set({ paymentProofs: JSON.stringify(updatedProofs) })
            .where(eq(invoices.id, id));

        const filePath = join(PROOF_DIR, filename);
        try {
            await unlink(filePath);
        } catch (err) {
            console.warn(`File ${filePath} could not be deleted from disk:`, err);
        }

        logInvoiceActivity({
            invoiceId: id,
            action: "PROOF_DELETED",
            actor: user,
            details: `Deleted proof file ${filename}`,
            ipAddress: getClientIp(c)
        });

        return c.json({ status: "success", proofs: updatedProofs });
    } catch (e) {
        console.error("Error deleting proof:", e);
        return c.json({ error: String(e) }, 500);
    }
});

invoicesRouter.get("/:id/activity", async (c) => {
    const user = c.get("user" as any) as AuthUser | undefined;
    if (!user || !hasFeaturePermission(sqlite, user, "view_billing_history")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const id = parseInt(c.req.param("id"));
        if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

        const rows = sqlite.prepare(`
            SELECT
                id,
                invoice_id as invoiceId,
                action,
                actor_id as actorId,
                actor_email as actorEmail,
                actor_name as actorName,
                actor_role as actorRole,
                details,
                ip_address as ipAddress,
                created_at as createdAt
            FROM invoice_activity_logs
            WHERE invoice_id = ?
            ORDER BY id DESC
            LIMIT 100
        `).all(id);

        return c.json(rows);
    } catch (e) {
        console.error("Error fetching activity logs:", e);
        return c.json({ error: String(e) }, 500);
    }
});

export default invoicesRouter;
