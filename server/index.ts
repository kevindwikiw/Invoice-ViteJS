import { Hono } from "hono";
import { cors } from "hono/cors";
import { join, resolve } from "node:path";
import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import packagesRoutes from "./routes/packages";
import invoicesRoutes from "./routes/invoices";
import configRoutes from "./routes/config";
import analyticsRoutes from "./routes/analytics";
import sequencesRoutes from "./routes/sequences";
import { feedbackAdminRoutes, publicFeedbackRoutes } from "./routes/feedback";
import { adminGalleriesRouter, publicGalleriesRouter } from "./routes/galleries";
import { authMiddleware, requireRole } from "./middleware/auth";
import { galleryPinRateLimiter, loginRateLimiter } from "./middleware/rate-limit";
import { ensureUserPermissionsTable, hasFeaturePermission } from "./permissions";
import { databaseDriver, sqlite } from "./db/runtime";
import { feedbackStorageDriver } from "./db/feedback";
import { galleryStorageDriver } from "./db/galleries";
import { rateLimitStorageDriver } from "./db/rate-limit";

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
    sqlite.run(`
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
            invoice_no TEXT NOT NULL,
            client_name TEXT,
            rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
            tags TEXT NOT NULL DEFAULT '[]',
            message TEXT NOT NULL,
            photo_data BLOB,
            photo_mime TEXT,
            photo_size INTEGER,
            status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewed')),
            reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    sqlite.run("CREATE INDEX IF NOT EXISTS idx_feedback_status_created_at ON feedback(status, created_at DESC)");
    sqlite.run("CREATE INDEX IF NOT EXISTS idx_feedback_invoice_no ON feedback(invoice_no)");
    ensureUserPermissionsTable(sqlite);
} catch (error) {
    console.error("Database initialization failed:", error);
    process.exit(1);
}
} else {
    console.log("Postgres mode enabled; expecting the Supabase migration to be applied.");
}
console.log(`Feedback storage mode: ${feedbackStorageDriver}`);
console.log(`Gallery storage mode: ${galleryStorageDriver}`);
console.log(`Rate limit storage mode: ${rateLimitStorageDriver}`);

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
    allowHeaders: ["Content-Type", "Authorization", "x-gallery-token"],
}));

app.get("/api/health", (c) => c.json({ ok: true, service: "invoice-api" }));
app.get("/healthz", (c) => c.json({ ok: true }));

app.post("/api/auth/login", loginRateLimiter);
app.use("/api/auth/me", authMiddleware);
app.route("/api/auth", authRoutes);
app.route("/api/public/feedback", publicFeedbackRoutes);
app.use("/api/public/galleries/:id/verify", galleryPinRateLimiter);
app.route("/api/public/galleries", publicGalleriesRouter);

for (const path of [
    "/api/packages",
    "/api/invoices",
    "/api/users",
    "/api/config",
    "/api/analytics",
    "/api/sequences",
    "/api/feedback",
    "/api/galleries",
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
app.route("/api/galleries", adminGalleriesRouter);
app.use("/api/feedback", requireRole("admin", "superadmin"));
app.use("/api/feedback/*", requireRole("admin", "superadmin"));
app.use("/api/feedback", async (c, next) => {
    const user = c.get("user");
    if (!await hasFeaturePermission(user, "view_feedback_inbox")) {
        return c.json({ error: "Permission denied" }, 403);
    }
    await next();
});
app.use("/api/feedback/*", async (c, next) => {
    const user = c.get("user");
    if (!await hasFeaturePermission(user, "view_feedback_inbox")) {
        return c.json({ error: "Permission denied" }, 403);
    }
    await next();
});
app.route("/api/feedback", feedbackAdminRoutes);

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
