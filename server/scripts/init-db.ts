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

// Users table for auth
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("Table 'users' ready.");

// Seed default users (if not exist)
const existingUsers = db.query("SELECT COUNT(*) as count FROM users").get() as { count: number };
if (existingUsers.count === 0) {
  console.log("Seeding default users...");

  // Using Bun's built-in password hashing
  const hashPassword = async (password: string) => {
    return await Bun.password.hash(password, {
      algorithm: "bcrypt",
      cost: 10,
    });
  };

  const seedUsers = async () => {
    const devHash = await hashPassword("dev123");
    const adminHash = await hashPassword("admin123");
    const staffHash = await hashPassword("staff123");

    db.run(`INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)`,
      ["dev@orbit.com", "Developer", devHash, "superadmin"]);
    db.run(`INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)`,
      ["admin@orbit.com", "Admin", adminHash, "admin"]);
    db.run(`INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)`,
      ["staff@orbit.com", "Staff", staffHash, "employee"]);

    console.log("Default users seeded:");
    console.log("  - dev@orbit.com (SuperAdmin) / dev123");
    console.log("  - admin@orbit.com (Admin) / admin123");
    console.log("  - staff@orbit.com (Employee) / staff123");
  };

  await seedUsers();
}

// Audit Logs table for security monitoring
db.run(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    user_id INTEGER,
    email TEXT,
    ip_address TEXT,
    user_agent TEXT,
    success INTEGER DEFAULT 0,
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("Table 'audit_logs' ready.");

// Refresh tokens table
db.run(`
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked INTEGER DEFAULT 0
  )
`);
console.log("Table 'refresh_tokens' ready.");

// Sequences table for atomic counters
db.run(`
  CREATE TABLE IF NOT EXISTS sequences (
    name TEXT PRIMARY KEY,
    prefix TEXT,
    padding INTEGER DEFAULT 5,
    last_value INTEGER DEFAULT 0
  )
`);
// Seed invoice sequence if not exists
const seq = db.query("SELECT name FROM sequences WHERE name = 'invoice'").get();
if (!seq) {
  db.run("INSERT INTO sequences (name, prefix, padding, last_value) VALUES (?, ?, ?, ?)", ["invoice", "INV", 5, 0]);
}
console.log("Table 'sequences' ready.");

console.log("Database initialized successfully at db/sqlite.db");
