import { Database } from "bun:sqlite";

// Ensure db directory exists
import { mkdir } from "node:fs/promises";
await mkdir("db", { recursive: true });

const db = new Database("db/sqlite.db");

console.log("Initializing Database...");

// Packages
db.run(`
  CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    category TEXT,
    description TEXT,
    is_active INTEGER DEFAULT 1
  )
`);
console.log("Table 'packages' ready.");

// Invoices
db.run(`
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT,
    client_name TEXT,
    date TEXT,
    total_amount REAL,
    invoice_data TEXT,
    pdf_blob BLOB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("Table 'invoices' ready.");

// Config
db.run(`
  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT
  )
`);
console.log("Table 'app_config' ready.");

console.log("Database initialized successfully at db/sqlite.db");
