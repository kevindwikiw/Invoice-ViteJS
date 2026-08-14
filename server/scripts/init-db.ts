import { Database } from "bun:sqlite";

// Ensure db directory exists
import { mkdir } from "node:fs/promises";
await mkdir("db", { recursive: true });

const dbPath = process.env.SQLITE_PATH || "db/sqlite.db";
const db = new Database(dbPath);

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
    is_archived INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("Table 'invoices' ready.");

// Invoice Activity Logs
db.run(`
  CREATE TABLE IF NOT EXISTS invoice_activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    actor_id INTEGER,
    actor_email TEXT,
    actor_name TEXT,
    actor_role TEXT,
    details TEXT,
    ip_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
db.run(`
  CREATE INDEX IF NOT EXISTS idx_invoice_activity_logs_invoice_id
  ON invoice_activity_logs(invoice_id, created_at DESC)
`);
console.log("Table 'invoice_activity_logs' ready.");

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

// Granular user permissions for feature-level RBAC
db.run(`
  CREATE TABLE IF NOT EXISTS user_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    permission_key TEXT NOT NULL,
    effect TEXT NOT NULL CHECK(effect IN ('grant', 'deny')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, permission_key)
  )
`);
db.run(`
  CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id
  ON user_permissions(user_id)
`);
console.log("Table 'user_permissions' ready.");

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
    const seedPasswords = {
      superadmin: process.env.SEED_SUPERADMIN_PASSWORD,
      admin: process.env.SEED_ADMIN_PASSWORD,
      employee: process.env.SEED_EMPLOYEE_PASSWORD,
    };
    const missing = Object.entries(seedPasswords)
      .filter(([, password]) => !password || password.length < 12)
      .map(([role]) => role);
    if (missing.length > 0) {
      throw new Error(`Missing strong seed password(s): ${missing.join(", ")}. Set them in server/.env before initializing the database.`);
    }

    const devHash = await hashPassword(seedPasswords.superadmin!);
    const adminHash = await hashPassword(seedPasswords.admin!);
    const staffHash = await hashPassword(seedPasswords.employee!);

    db.run(`INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)`,
      ["dev@orbit.com", "Developer", devHash, "superadmin"]);
    db.run(`INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)`,
      ["admin@orbit.com", "Admin", adminHash, "admin"]);
    db.run(`INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)`,
      ["staff@orbit.com", "Staff", staffHash, "employee"]);

    console.log("Seed users created. Store their credentials securely; they are not printed by this script.");
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

console.log(`Database initialized successfully at ${dbPath}`);
