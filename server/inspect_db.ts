import { Database } from "bun:sqlite";
const db = new Database("c:/Users/kuz/Streamlit/my_invoice_app/invoice_app/invoice-web-v2/server/db/sqlite.db");

const count = db.query("SELECT COUNT(*) as count FROM invoices").get() as { count: number };
console.log("Total Invoices:", count.count);

const withNotes = db.query("SELECT id, invoice_no FROM invoices WHERE invoice_data LIKE '%notes%'").all();
console.log("Invoices with 'notes' key in JSON:", withNotes.length);
if (withNotes.length > 0) {
    console.log("Latest with notes:", withNotes[withNotes.length - 1]);
}

const samples = db.query("SELECT id, invoice_no, invoice_data FROM invoices ORDER BY id DESC LIMIT 3").all();
samples.forEach((s: any) => {
    console.log(`--- ID ${s.id} (${s.invoice_no}) ---`);
    console.log(s.invoice_data);
});

db.close();
