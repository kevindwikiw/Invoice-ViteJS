import { beforeAll, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";

process.env.DATABASE_DRIVER = "sqlite";
process.env.SQLITE_PATH = ":memory:";
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_DB_URL;

const { sqlite } = await import("../db/runtime");
const { default: invoicesRouter } = await import("./invoices");
const app = new Hono<{ Variables: { user: { sub: number; email: string; name: string; role: string } } }>();
app.use("/*", async (c, next) => { c.set("user", { sub: 1, email: "test@orbit.invalid", name: "Test", role: "admin" }); await next(); });
app.route("/invoices", invoicesRouter);

const legacy = {
    meta: {
        venue: "Legacy Ballroom", wedding_date: "2026-12-12", event_time: "10:00 - 12:00",
        pay_dp1: 100, payment_proof: ["data:image/png;base64,b2xk"], extra_legacy_field: "keep me",
    },
    items: [{ desc: "Wedding", price: 300, qty: 1 }],
};

beforeAll(() => {
    sqlite!.exec(`CREATE TABLE invoices (id INTEGER PRIMARY KEY, invoice_no TEXT, client_name TEXT, date TEXT, total_amount REAL,
        invoice_data TEXT, payment_proofs TEXT, is_archived INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT);
        CREATE TABLE user_permissions (user_id INTEGER, permission_key TEXT, effect TEXT);
        CREATE TABLE invoice_activity_logs (id INTEGER PRIMARY KEY, invoice_id INTEGER, action TEXT, actor_id INTEGER,
        actor_email TEXT, actor_name TEXT, actor_role TEXT, details TEXT, ip_address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE sequences (name TEXT, prefix TEXT, padding INTEGER, last_value INTEGER);`);
});

beforeEach(() => {
    sqlite!.exec("DELETE FROM invoices; DELETE FROM invoice_activity_logs");
    sqlite!.prepare("INSERT INTO invoices (id, invoice_no, client_name, date, total_amount, invoice_data, created_at) VALUES (1, 'INV1', 'Couple', '2026-12-12', 300, ?, '2026-04-24 10:00:00')")
        .run(JSON.stringify(legacy));
});

const update = () => app.request("/invoices/1", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({
    invoiceNo: "INV1", clientName: "Couple", venue: "Legacy Ballroom", weddingDate: "2026-12-12", hours: "10:00 - 12:00",
    items: legacy.items, paymentTerms: [{ id: "dp", amount: 100 }, { id: "t2", amount: 100 }], cashback: 0,
}) });

test("edit keeps unknown legacy metadata, original date, and proof", async () => {
    expect((await update()).status).toBe(200);
    const response = await app.request("/invoices/1");
    const invoice = await response.json() as { createdAt: string; updatedAt: string; invoiceData: string; paymentProofs: string };
    expect(invoice.createdAt).toBe("2026-04-24 10:00:00");
    expect(invoice.updatedAt).toBeTruthy();
    expect(JSON.parse(invoice.invoiceData).meta.extra_legacy_field).toBe("keep me");
    expect(JSON.parse(invoice.paymentProofs)).toEqual(["data:image/png;base64,b2xk"]);
});

test("new proof survives invoice save and deleting the last proof stays deleted", async () => {
    const form = new FormData();
    form.append("file", new File(["new proof"], "proof.png", { type: "image/png" }));
    expect((await app.request("/invoices/1/proofs", { method: "POST", body: form })).status).toBe(200);
    expect((await (await app.request("/invoices/1")).json() as { updatedAt: string | null }).updatedAt).toBeNull();
    expect((await update()).status).toBe(200);
    let invoice = await (await app.request("/invoices/1")).json() as { paymentProofs: string };
    const proofs = JSON.parse(invoice.paymentProofs) as string[];
    expect(proofs).toHaveLength(2);
    for (const proof of proofs) {
        expect((await app.request("/invoices/1/proofs", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ proof }) })).status).toBe(200);
    }
    invoice = await (await app.request("/invoices/1")).json() as { paymentProofs: string };
    expect(JSON.parse(invoice.paymentProofs)).toEqual([]);
});

test("new-format invoice retains its fields while only the revision date changes", async () => {
    const modern = { items: legacy.items, venue: "Modern Venue", weddingDate: "2026-12-12", hours: "13:00", paymentTerms: [{ id: "dp", amount: 100 }], customField: "keep" };
    sqlite!.prepare("UPDATE invoices SET invoice_data = ?, payment_proofs = '[]' WHERE id = 1").run(JSON.stringify(modern));
    expect((await update()).status).toBe(200);
    const invoice = await (await app.request("/invoices/1")).json() as { createdAt: string; updatedAt: string; invoiceData: string; paymentProofs: string };
    expect(invoice.createdAt).toBe("2026-04-24 10:00:00");
    expect(invoice.updatedAt).toBeTruthy();
    expect(JSON.parse(invoice.invoiceData).customField).toBe("keep");
    expect(JSON.parse(invoice.paymentProofs)).toEqual([]);
});

test("invalid stored JSON refuses an update", async () => {
    sqlite!.exec("UPDATE invoices SET invoice_data = 'not-json' WHERE id = 1");
    expect((await update()).status).toBe(409);
    const row = sqlite!.query("SELECT invoice_data, updated_at FROM invoices WHERE id = 1").get() as { invoice_data: string; updated_at: string | null };
    expect(row.invoice_data).toBe("not-json");
    expect(row.updated_at).toBeNull();
});
