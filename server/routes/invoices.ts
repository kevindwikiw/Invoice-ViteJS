import { Hono } from "hono";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { all, insertReturningId, one, run } from "../db/runtime";
import { hasFeaturePermission } from "../permissions";

const invoicesRouter = new Hono();
const PROOF_DIR = process.env.UPLOAD_DIR || "uploads/proofs";

type AuthUser = { sub: number; email: string; name: string; role: string };
type InvoiceActivityInput = {
    invoiceId: number;
    action: "CREATED" | "UPDATED" | "DELETED" | "BATCH_DELETED" | "PROOF_UPLOADED" | "PROOF_DELETED";
    actor?: AuthUser;
    details?: string;
    ipAddress?: string;
};

function getClientIp(c: any): string {
    return c.req.header("x-forwarded-for")?.split(",")[0].trim() || c.req.header("x-real-ip") || "unknown";
}

async function logInvoiceActivity(input: InvoiceActivityInput) {
    try {
        await run(`
            INSERT INTO invoice_activity_logs (
                invoice_id, action, actor_id, actor_email, actor_name, actor_role, details, ip_address
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [input.invoiceId, input.action, input.actor?.sub || null, input.actor?.email || null, input.actor?.name || null, input.actor?.role || null, input.details || null, input.ipAddress || null]);
    } catch (e) { console.error("Failed to log invoice activity:", e); }
}

function invoicePermission(c: any) { return c.get("user") as AuthUser | undefined; }

invoicesRouter.get("/activity", async (c) => {
    const user = invoicePermission(c);
    if (!user || !await hasFeaturePermission(user, "view_billing_history")) return c.json({ error: "Permission denied" }, 403);
    try {
        const search = (c.req.query("search") || "").trim().toLowerCase();
        const action = (c.req.query("action") || "").trim().toUpperCase();
        const safeLimit = Math.min(Math.max(parseInt(c.req.query("limit") || "100"), 1), 300);
        const requestedPage = Math.max(parseInt(c.req.query("page") || "1"), 1);
        const conditions: string[] = [];
        const params: Array<string | number> = [];
        if (action && action !== "ALL") { conditions.push("UPPER(l.action) = ?"); params.push(action); }
        if (search) {
            const pattern = `%${search}%`;
            conditions.push(`(
                LOWER(COALESCE(i.invoice_no, '')) LIKE ? OR LOWER(COALESCE(i.client_name, '')) LIKE ?
                OR LOWER(COALESCE(l.actor_name, '')) LIKE ? OR LOWER(COALESCE(l.actor_email, '')) LIKE ?
                OR LOWER(COALESCE(l.details, '')) LIKE ? OR LOWER(COALESCE(l.action, '')) LIKE ?
                OR CAST(l.invoice_id AS TEXT) LIKE ?
            )`);
            params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
        }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const summary = await one<{ total: number; created: number | null; updated: number | null; proofs: number | null }>(`
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN l.action = 'CREATED' THEN 1 ELSE 0 END) as created,
                   SUM(CASE WHEN l.action = 'UPDATED' THEN 1 ELSE 0 END) as updated,
                   SUM(CASE WHEN l.action IN ('PROOF_UPLOADED', 'PROOF_DELETED') THEN 1 ELSE 0 END) as proofs
            FROM invoice_activity_logs l LEFT JOIN invoices i ON i.id = l.invoice_id ${where}
        `, params);
        const total = Number(summary?.total || 0);
        const totalPages = Math.max(1, Math.ceil(total / safeLimit));
        const page = Math.min(requestedPage, totalPages);
        const rows = await all(`
            SELECT l.id, l.invoice_id as "invoiceId", l.action, l.actor_id as "actorId",
                   l.actor_email as "actorEmail", l.actor_name as "actorName", l.actor_role as "actorRole",
                   l.details, l.ip_address as "ipAddress", l.created_at as "createdAt",
                   i.invoice_no as "invoiceNo", i.client_name as "clientName"
            FROM invoice_activity_logs l LEFT JOIN invoices i ON i.id = l.invoice_id ${where}
            ORDER BY l.id DESC LIMIT ? OFFSET ?
        `, [...params, safeLimit, (page - 1) * safeLimit]);
        return c.json({ items: rows, page, limit: safeLimit, total, totalPages, stats: { total, created: Number(summary?.created || 0), updated: Number(summary?.updated || 0), proofs: Number(summary?.proofs || 0) } });
    } catch (e) { return c.json({ error: String(e) }, 500); }
});

invoicesRouter.get("/stats", async (c) => {
    const user = invoicePermission(c);
    if (!user || !await hasFeaturePermission(user, "view_billing_history")) return c.json({ error: "Permission denied" }, 403);
    try {
        const allInvoices = await all<{ totalAmount: number | null; invoiceData: string | null }>("SELECT total_amount as \"totalAmount\", invoice_data as \"invoiceData\" FROM invoices ORDER BY id DESC");
        let totalRevenue = 0, cntLunas = 0, cntDp = 0, cntUnpaid = 0;
        for (const inv of allInvoices) {
            totalRevenue += inv.totalAmount || 0;
            let paymentTerms: any[] = [];
            try { paymentTerms = inv.invoiceData ? JSON.parse(inv.invoiceData).paymentTerms || [] : []; } catch { /* ignore */ }
            if (paymentTerms.length) {
                const pelunasan = paymentTerms.find((t: any) => t.id === "full" || (t.label && t.label.toLowerCase().includes("pelunasan")));
                if (pelunasan && Number(pelunasan.amount || 0) > 0) cntLunas++;
                else if (paymentTerms.some((t: any) => t.id !== "full" && Number(t.amount || 0) > 0)) cntDp++;
                else cntUnpaid++;
            } else cntUnpaid++;
        }
        return c.json({ total: allInvoices.length, totalRevenue, lunas: cntLunas, dp: cntDp, unpaid: cntUnpaid });
    } catch (e) { return c.json({ error: String(e) }, 500); }
});

invoicesRouter.get("/", async (c) => {
    const user = invoicePermission(c);
    if (!user || !await hasFeaturePermission(user, "view_billing_history")) return c.json({ error: "Permission denied" }, 403);
    try {
        const search = c.req.query("search") || "";
        const safeLimit = Math.min(Math.max(parseInt(c.req.query("limit") || "50"), 1), 200);
        const rows = search
            ? await all(`SELECT id, invoice_no as "invoiceNo", client_name as "clientName", date, total_amount as "totalAmount", invoice_data as "invoiceData", payment_proofs as "paymentProofs", is_archived as "isArchived", created_at as "createdAt" FROM invoices WHERE invoice_no LIKE ? OR client_name LIKE ? ORDER BY id DESC LIMIT ?`, [`%${search}%`, `%${search}%`, safeLimit])
            : await all(`SELECT id, invoice_no as "invoiceNo", client_name as "clientName", date, total_amount as "totalAmount", invoice_data as "invoiceData", payment_proofs as "paymentProofs", is_archived as "isArchived", created_at as "createdAt" FROM invoices ORDER BY id DESC LIMIT ?`, [safeLimit]);
        return c.json(rows);
    } catch (e) { return c.json({ error: String(e) }, 500); }
});

invoicesRouter.get("/:id", async (c) => {
    const user = invoicePermission(c);
    if (!user || !await hasFeaturePermission(user, "view_billing_history")) return c.json({ error: "Permission denied" }, 403);
    try {
        const invoice = await one(`SELECT id, invoice_no as "invoiceNo", client_name as "clientName", date, total_amount as "totalAmount", invoice_data as "invoiceData", payment_proofs as "paymentProofs", is_archived as "isArchived", created_at as "createdAt" FROM invoices WHERE id = ?`, [Number(c.req.param("id"))]);
        return invoice ? c.json(invoice) : c.json({ error: "Not found" }, 404);
    } catch (e) { return c.json({ error: String(e) }, 500); }
});

invoicesRouter.patch("/:id/archive", async (c) => {
    const user = invoicePermission(c);
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) return c.json({ error: "Permission denied" }, 403);
    try {
        const id = Number(c.req.param("id"));
        if (!Number.isInteger(id)) return c.json({ error: "Invalid ID" }, 400);
        const isArchived = (await c.req.json()).isArchived ? 1 : 0;
        await run("UPDATE invoices SET is_archived = ? WHERE id = ?", [isArchived, id]);
        await logInvoiceActivity({ invoiceId: id, action: "UPDATED", actor: user, details: isArchived ? "Invoice archived" : "Invoice unarchived", ipAddress: getClientIp(c) });
        return c.json({ status: isArchived ? "archived" : "unarchived" });
    } catch (e) { return c.json({ error: String(e) }, 500); }
});

invoicesRouter.post("/batch-delete", async (c) => {
    const user = invoicePermission(c);
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) return c.json({ error: "Permission denied" }, 403);
    try {
        const { ids } = await c.req.json();
        if (!Array.isArray(ids) || !ids.length) return c.json({ error: "No IDs provided" }, 400);
        const normalized = ids.map((v: unknown) => Number(v)).filter((v: number) => Number.isInteger(v));
        if (!normalized.length) return c.json({ error: "No valid IDs provided" }, 400);
        const placeholders = normalized.map(() => "?").join(",");
        const targets = await all<{ id: number; paymentProofs: string | null }>(`SELECT id, payment_proofs as "paymentProofs" FROM invoices WHERE id IN (${placeholders})`, normalized);
        for (const inv of targets) await removeProofFiles(inv.paymentProofs);
        const result = await run(`DELETE FROM invoices WHERE id IN (${placeholders})`, normalized);
        for (const id of normalized) await logInvoiceActivity({ invoiceId: id, action: "BATCH_DELETED", actor: user, details: `Invoice batch-deleted (${normalized.length} total)`, ipAddress: getClientIp(c) });
        const remaining = await one<{ cnt: number }>("SELECT COUNT(*) as cnt FROM invoices");
        if (Number(remaining?.cnt || 0) === 0) await run("UPDATE sequences SET last_value = 0 WHERE name = 'invoice'");
        return c.json({ status: "deleted", count: result.changes });
    } catch (e) { return c.json({ error: String(e) }, 500); }
});

async function removeProofFiles(raw: string | null | undefined) {
    if (!raw) return;
    try {
        const files = JSON.parse(raw);
        if (Array.isArray(files)) for (const fileName of files) {
            try { await unlink(join(PROOF_DIR, fileName)); } catch { /* ignore missing */ }
        }
    } catch { /* ignore malformed JSON */ }
}

invoicesRouter.delete("/:id", async (c) => {
    const user = invoicePermission(c);
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) return c.json({ error: "Permission denied" }, 403);
    try {
        const id = Number(c.req.param("id"));
        const inv = await one<{ invoiceNo: string | null; paymentProofs: string | null }>("SELECT invoice_no as \"invoiceNo\", payment_proofs as \"paymentProofs\" FROM invoices WHERE id = ?", [id]);
        await removeProofFiles(inv?.paymentProofs);
        await run("DELETE FROM invoices WHERE id = ?", [id]);
        await logInvoiceActivity({ invoiceId: id, action: "DELETED", actor: user, details: `Invoice ${inv?.invoiceNo || id} deleted`, ipAddress: getClientIp(c) });
        const remaining = await one<{ cnt: number }>("SELECT COUNT(*) as cnt FROM invoices");
        if (Number(remaining?.cnt || 0) === 0) await run("UPDATE sequences SET last_value = 0 WHERE name = 'invoice'");
        return c.json({ status: "deleted" });
    } catch (e) { return c.json({ error: String(e) }, 500); }
});

function buildInvoiceData(body: any): string {
    const { items, paymentTerms, cashback, venue, weddingDate, clientPhone, eventTitle, bankName, bankAcc, bankHolder, terms, footerAddress, footerEmail, footerIG, footerPhone, waTemplate, hours, notes } = body;
    return JSON.stringify({ items, paymentTerms, cashback, venue, weddingDate, clientPhone, eventTitle, bankName, bankAcc, bankHolder, terms, footerAddress, footerEmail, footerIG, footerPhone, waTemplate, hours: hours || "", notes: notes || "" });
}

invoicesRouter.put("/:id", async (c) => {
    const user = invoicePermission(c);
    if (!user || !await hasFeaturePermission(user, "edit_billing_history")) return c.json({ error: "Permission denied" }, 403);
    try {
        const id = Number(c.req.param("id"));
        if (!Number.isInteger(id)) return c.json({ error: "Invalid ID" }, 400);
        const body = await c.req.json();
        await run("UPDATE invoices SET invoice_no = ?, client_name = ?, date = ?, total_amount = ?, invoice_data = ? WHERE id = ?", [body.invoiceNo, body.clientName, body.weddingDate || new Date().toISOString().split("T")[0], body.totalAmount, buildInvoiceData(body), id]);
        await logInvoiceActivity({ invoiceId: id, action: "UPDATED", actor: user, details: `Updated invoice total: ${body.totalAmount}`, ipAddress: getClientIp(c) });
        return c.json({ id, invoiceNo: body.invoiceNo, clientName: body.clientName, totalAmount: body.totalAmount, status: "updated" });
    } catch (e) { return c.json({ error: String(e) }, 500); }
});

invoicesRouter.post("/", async (c) => {
    const user = invoicePermission(c);
    if (!user || !await hasFeaturePermission(user, "edit_billing_history")) return c.json({ error: "Permission denied" }, 403);
    try {
        const body = await c.req.json();
        const seq = await one<{ prefix: string; padding: number; last_value: number }>("SELECT prefix, padding, last_value FROM sequences WHERE name = 'invoice'");
        let invoiceNo = body.invoiceNo;
        if (seq) {
            const next = Number(seq.last_value) + 1;
            if (!invoiceNo) invoiceNo = `${seq.prefix}${String(next).padStart(seq.padding, "0")}_${String(body.clientName || "").replace(/\s+/g, "_")}`;
            await run("UPDATE sequences SET last_value = ? WHERE name = 'invoice'", [next]);
        } else if (!invoiceNo) return c.json({ error: "Invoice sequence configuration missing" }, 500);
        const id = await insertReturningId(`INSERT INTO invoices (invoice_no, client_name, date, total_amount, invoice_data) VALUES (?, ?, ?, ?, ?)`, [invoiceNo, body.clientName, body.weddingDate || new Date().toISOString().split("T")[0], body.totalAmount, buildInvoiceData(body)]);
        await logInvoiceActivity({ invoiceId: id, action: "CREATED", actor: user, details: `Created invoice ${invoiceNo} for ${body.clientName}`, ipAddress: getClientIp(c) });
        return c.json({ id, invoiceNo, clientName: body.clientName, totalAmount: body.totalAmount, status: "created" });
    } catch (e) { console.error("Error creating invoice:", e); return c.json({ error: String(e) }, 500); }
});

invoicesRouter.post("/:id/proofs", async (c) => {
    const user = invoicePermission(c);
    if (!user || !await hasFeaturePermission(user, "edit_billing_history")) return c.json({ error: "Permission denied" }, 403);
    try {
        const id = Number(c.req.param("id"));
        if (!Number.isInteger(id)) return c.json({ error: "Invalid ID" }, 400);
        const body = await c.req.parseBody({ all: true });
        let files = body.file;
        if (!files) return c.json({ error: "No files uploaded" }, 400);
        if (!Array.isArray(files)) files = [files];
        const validFiles = (files as File[]).filter((file) => file instanceof File && file.size > 0);
        if (!validFiles.length) return c.json({ error: "No valid files uploaded" }, 400);
        const names: string[] = [];
        for (const file of validFiles) {
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}_${file.name.replace(/\s+/g, "_")}`;
            await Bun.write(join(PROOF_DIR, fileName), file);
            names.push(fileName);
        }
        const inv = await one<{ paymentProofs: string | null }>("SELECT payment_proofs as \"paymentProofs\" FROM invoices WHERE id = ?", [id]);
        if (!inv) return c.json({ error: "Invoice not found" }, 404);
        let current: string[] = [];
        try { current = inv.paymentProofs ? JSON.parse(inv.paymentProofs) : []; } catch { /* ignore */ }
        const proofs = [...current, ...names];
        await run("UPDATE invoices SET payment_proofs = ? WHERE id = ?", [JSON.stringify(proofs), id]);
        await logInvoiceActivity({ invoiceId: id, action: "PROOF_UPLOADED", actor: user, details: `Uploaded ${names.length} proof file(s)`, ipAddress: getClientIp(c) });
        return c.json({ status: "success", proofs });
    } catch (e) { return c.json({ error: String(e) }, 500); }
});

invoicesRouter.delete("/:id/proofs/:filename", async (c) => {
    const user = invoicePermission(c);
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) return c.json({ error: "Permission denied" }, 403);
    try {
        const id = Number(c.req.param("id"));
        const filename = c.req.param("filename");
        const inv = await one<{ paymentProofs: string | null }>("SELECT payment_proofs as \"paymentProofs\" FROM invoices WHERE id = ?", [id]);
        if (!inv) return c.json({ error: "Invoice not found" }, 404);
        let current: string[] = [];
        try { current = inv.paymentProofs ? JSON.parse(inv.paymentProofs) : []; } catch { /* ignore */ }
        const proofs = current.filter((proof) => proof !== filename);
        await run("UPDATE invoices SET payment_proofs = ? WHERE id = ?", [JSON.stringify(proofs), id]);
        try { await unlink(join(PROOF_DIR, filename)); } catch { /* ignore */ }
        await logInvoiceActivity({ invoiceId: id, action: "PROOF_DELETED", actor: user, details: `Deleted proof file ${filename}`, ipAddress: getClientIp(c) });
        return c.json({ status: "success", proofs });
    } catch (e) { return c.json({ error: String(e) }, 500); }
});

invoicesRouter.get("/:id/activity", async (c) => {
    const user = invoicePermission(c);
    if (!user || !await hasFeaturePermission(user, "view_billing_history")) return c.json({ error: "Permission denied" }, 403);
    try {
        const rows = await all(`SELECT id, invoice_id as "invoiceId", action, actor_id as "actorId", actor_email as "actorEmail", actor_name as "actorName", actor_role as "actorRole", details, ip_address as "ipAddress", created_at as "createdAt" FROM invoice_activity_logs WHERE invoice_id = ? ORDER BY id DESC LIMIT 100`, [Number(c.req.param("id"))]);
        return c.json(rows);
    } catch (e) { return c.json({ error: String(e) }, 500); }
});

export default invoicesRouter;
