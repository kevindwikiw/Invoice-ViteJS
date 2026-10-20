import { Database } from "bun:sqlite";
import postgres from "postgres";

type Row = { id: number; invoice_no: string | null; date: string | null; invoice_data: string | null; payment_proofs: string | null; revisions: number };

const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
const usePostgres = process.env.DATABASE_DRIVER === "postgres" || Boolean(dbUrl);
let rows: Row[];
if (usePostgres) {
    if (!dbUrl) throw new Error("DATABASE_URL or SUPABASE_DB_URL is required");
    const sql = postgres(dbUrl, { prepare: false, ssl: process.env.DATABASE_SSL === "false" ? false : "require", max: 1 });
    try {
        rows = await sql.begin(async transaction => {
            await transaction`SET TRANSACTION READ ONLY`;
            return await transaction<Row[]>`SELECT i.id, i.invoice_no, i.date, i.invoice_data, i.payment_proofs,
                (SELECT count(*)::integer FROM invoice_activity_logs l WHERE l.invoice_id = i.id AND l.action = 'UPDATED') AS revisions
                FROM invoices i ORDER BY i.id`;
        });
    } finally {
        await sql.end();
    }
} else {
    const db = new Database(process.env.SQLITE_PATH || "db/sqlite.db", { readonly: true, create: false });
    try {
        rows = db.query(`SELECT i.id, i.invoice_no, i.date, i.invoice_data, i.payment_proofs,
            (SELECT count(*) FROM invoice_activity_logs l WHERE l.invoice_id = i.id AND l.action = 'UPDATED') AS revisions
            FROM invoices i ORDER BY i.id`).all() as Row[];
    } finally {
        db.close();
    }
}

for (const row of rows) {
    let data: Record<string, unknown> = {};
    let invalidJson = false;
    try { data = JSON.parse(row.invoice_data || "{}"); } catch { invalidJson = true; }
    const meta = data.meta && typeof data.meta === "object" ? data.meta as Record<string, unknown> : {};
    const present = (...keys: string[]) => keys.some(key => Boolean(data[key] ?? meta[key]));
    let proofCount = 0;
    try {
        const proofs = row.payment_proofs == null ? (meta.payment_proof ?? meta.paymentProof) : JSON.parse(row.payment_proofs);
        proofCount = Array.isArray(proofs) ? proofs.length : 0;
    } catch { invalidJson = true; }
    const flags = [
        invalidJson && "invalid_json",
        !present("venue", "eventVenue", "event_venue", "location") && "missing_venue",
        !present("weddingDate", "wedding_date", "eventDate", "event_date") && "missing_event_date_in_payload",
        !present("hours", "eventTime", "event_time", "time") && "missing_event_time",
        row.revisions > 0 && proofCount === 0 && "revised_without_proofs",
    ].filter(Boolean);
    if (flags.length) console.log(JSON.stringify({ id: row.id, invoiceNo: row.invoice_no, revisions: row.revisions, proofCount, flags }));
}
console.log(`Audited ${rows.length} invoices (read only). Missing fields are candidates for backup comparison, not proof of data loss.`);
