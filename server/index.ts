import { Hono } from "hono";
import { cors } from "hono/cors";
import { mkdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
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
import { databaseDriver, sqlite } from "./db/runtime";

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

const PROOF_DIR = process.env.UPLOAD_DIR || "uploads/proofs";
await mkdir(PROOF_DIR, { recursive: true });

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error("FATAL: JWT_SECRET must be set and at least 32 characters long!");
    console.error("Please set JWT_SECRET in your .env file.");
    process.exit(1);
}

if (databaseDriver === "sqlite" && sqlite) {
try {
    // A brand-new Fly volume has no tables yet. The full schema is created by
    // scripts/init-db.ts; only run additive migrations when the base table
    // already exists so the health endpoint can come up for first boot.
    const invoicesTable = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'invoices'")
        .get() as { name: string } | null;
    if (invoicesTable) {
        const invoiceColumns = sqlite.prepare("PRAGMA table_info(invoices)").all() as Array<{ name: string }>;
        if (!invoiceColumns.some((column) => column.name === "payment_proofs")) {
            sqlite.prepare("ALTER TABLE invoices ADD COLUMN payment_proofs TEXT").run();
        }
        if (!invoiceColumns.some((column) => column.name === "is_archived")) {
            sqlite.prepare("ALTER TABLE invoices ADD COLUMN is_archived INTEGER DEFAULT 0").run();
        }
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
} else {
    console.log("Postgres mode enabled; expecting the Supabase migration to be applied.");
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

app.get("/api/health", (c) => c.json({ ok: true, service: "invoice-api" }));
app.get("/healthz", (c) => c.json({ ok: true }));

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

// In production the API and the Rsbuild output are served from one Fly app.
// Keeping the SPA fallback here makes direct refreshes such as /history work
// without exposing server files or requiring a second public origin.
const STATIC_DIR = resolve(process.env.STATIC_DIR || join(process.cwd(), "../client/dist"));
const serveClientFile = async (path: string) => {
    const requestedPath = path === "/" ? "index.html" : path.replace(/^\/+/, "");
    const filePath = resolve(STATIC_DIR, requestedPath);
    if (requestedPath.split(/[\\/]/).includes("..") || !filePath.startsWith(STATIC_DIR)) {
        return null;
    }
    const file = Bun.file(filePath);
    return (await file.exists()) ? file : null;
};

app.get("*", async (c) => {
    if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/uploads/")) {
        return c.notFound();
    }

    const requestedFile = await serveClientFile(c.req.path);
    if (requestedFile) {
        return c.body(requestedFile.stream(), 200, {
            "Content-Type": requestedFile.type || "application/octet-stream",
            "Cache-Control": c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        });
    }

    const indexFile = await serveClientFile("/");
    if (!indexFile) return c.text("Frontend build not found", 503);
    return c.html(await indexFile.text());
});

const port = Number(process.env.PORT || 3000);
console.log(`Server running on port ${port}`);
console.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);

export default {
    hostname: "0.0.0.0",
    port,
    fetch: app.fetch,
};
