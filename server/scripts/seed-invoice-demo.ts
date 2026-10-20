import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.env.DATABASE_DRIVER === "postgres" || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.NODE_ENV === "production") {
    throw new Error("Invoice demo seed is SQLite-local only; refusing a production or PostgreSQL environment.");
}

const dbPath = resolve("db/sqlite.db");
const db = new Database(dbPath, { readwrite: true, create: false });
const invoiceNo = "TEST_LEGACY_TERMIN_001";

try {
    const columns = db.query("PRAGMA table_info(invoices)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "payment_proofs")) {
        throw new Error("Local invoices table needs payment_proofs. Start the local server once to apply its additive schema upgrade.");
    }

    const existing = db.query("SELECT id FROM invoices WHERE invoice_no = ?").get(invoiceNo) as { id: number } | null;
    if (existing) {
        console.log(`Demo invoice already exists: ${invoiceNo} (id ${existing.id}). No data changed.`);
    } else {
        const proof = `data:image/png;base64,${readFileSync(new URL("../../client/src/assets/pdf/logo.png", import.meta.url)).toString("base64")}`;
        const invoiceData = {
            items: [{ id: "demo-package", desc: "Paket Foto Wedding (Demo)", details: "Invoice percobaan - bukan transaksi asli", price: 6_000_000, qty: 1 }],
            meta: {
                venue: "Demo Ballroom, Jakarta",
                wedding_date: "Saturday, 12 December 2026",
                event_time: "10:00 - 14:00",
                pay_dp1: 2_000_000,
                pay_term2: 0,
                pay_term3: 0,
                pay_full: 0,
                payment_proof: [proof],
                test_fixture: true,
            },
        };
        const result = db.prepare(`INSERT INTO invoices
            (invoice_no, client_name, date, total_amount, invoice_data, payment_proofs, created_at)
            VALUES (?, ?, ?, ?, ?, NULL, ?)`)
            .run(invoiceNo, "KLIEN DEMO - TEST ONLY", "2026-12-12", 6_000_000, JSON.stringify(invoiceData), "2026-04-24 10:00:00");
        console.log(`Created demo invoice ${invoiceNo} (id ${result.lastInsertRowid}). The included image is a test placeholder, not a real transfer receipt.`);
    }
} finally {
    db.close();
}
