import { Hono } from "hono";
import { cors } from "hono/cors";
import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import packagesRoutes from "./routes/packages";
import invoicesRoutes from "./routes/invoices";
import configRoutes from "./routes/config";
import analyticsRoutes from "./routes/analytics";
import sequencesRoutes from "./routes/sequences";
import { authMiddleware } from "./middleware/auth";
import { loginRateLimiter } from "./middleware/rate-limit";
import { ensureUserPermissionsTable } from "./permissions";

type AuthUser = {
    sub: number;
    email: string;
    name: string;
    role: string;
};

type AppEnv = {
    Variables: {
        user: AuthUser;
    };
};

const PROOF_DIR = "uploads/proofs";
await mkdir(PROOF_DIR, { recursive: true });

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error("FATAL: JWT_SECRET must be set and at least 32 characters long!");
    console.error("Please set JWT_SECRET in your .env file.");
    process.exit(1);
}

const sqlite = new Database("db/sqlite.db");

try {
    const invoiceColumns = sqlite.prepare("PRAGMA table_info(invoices)").all() as Array<{ name: string }>;
    if (!invoiceColumns.some((column) => column.name === "payment_proofs")) {
        sqlite.prepare("ALTER TABLE invoices ADD COLUMN payment_proofs TEXT").run();
    }
    if (!invoiceColumns.some((column) => column.name === "is_archived")) {
        sqlite.prepare("ALTER TABLE invoices ADD COLUMN is_archived INTEGER DEFAULT 0").run();
    }

    sqlite.run(`
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
    sqlite.run(`
        CREATE INDEX IF NOT EXISTS idx_invoice_activity_logs_invoice_id
        ON invoice_activity_logs(invoice_id, created_at DESC)
    `);
    sqlite.run("CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)");
    ensureUserPermissionsTable(sqlite);
} catch (error) {
    console.error("Database initialization failed:", error);
    process.exit(1);
}

const app = new Hono<AppEnv>();
const allowedOrigins = (
    process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:3000"
).split(",");

app.use("/*", cors({
    origin: (origin) => {
        if (!origin) return null;
        if (allowedOrigins.includes(origin)) return origin;
        if (process.env.NODE_ENV !== "production" && origin.includes("localhost")) return origin;
        return null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
}));

app.get("/", (c) => c.text("Invoice App V2 API Running"));

// Proof files contain private payment evidence. They must never be served as
// anonymous static assets; the client fetches them with its bearer token.
app.use("/uploads/proofs/:filename", authMiddleware);

app.get("/uploads/proofs/:filename", async (c) => {
    const filename = c.req.param("filename");
    if (filename !== basename(filename)) return c.text("Invalid filename", 400);

    const file = Bun.file(join(PROOF_DIR, filename));
    if (!(await file.exists())) return c.text("File not found", 404);

    return c.body(file.stream(), 200, {
        "Content-Type": file.type || "application/octet-stream",
    });
});

app.post("/api/auth/login", loginRateLimiter);
app.use("/api/auth/me", authMiddleware);
app.route("/api/auth", authRoutes);

for (const path of [
    "/api/packages",
    "/api/invoices",
    "/api/users",
    "/api/config",
    "/api/analytics",
    "/api/sequences",
]) {
    app.use(path, authMiddleware);
    app.use(`${path}/*`, authMiddleware);
}

app.route("/api/packages", packagesRoutes);
app.route("/api/invoices", invoicesRoutes);
app.route("/api/users", usersRoutes);
app.route("/api/config", configRoutes);
app.route("/api/analytics", analyticsRoutes);
app.route("/api/sequences", sequencesRoutes);

console.log("Server running on http://localhost:3000");
console.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);

export default {
    port: 3000,
    fetch: app.fetch,
};
