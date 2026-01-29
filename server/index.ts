import { Hono } from "hono";
import { cors } from "hono/cors";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { packages, invoices, appConfig, users } from "./db/schema";
import { eq, desc } from "drizzle-orm";
import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import { authMiddleware } from "./middleware/auth";

const app = new Hono();

app.use("/*", cors());

const sqlite = new Database("db/sqlite.db");
const db = drizzle(sqlite);

app.get("/", (c) => {
    return c.text("Invoice App V2 API Running 🚀");
});

// --- PUBLIC ROUTES ---
// Auth routes (login is public)
app.route("/api/auth", authRoutes);

// --- PROTECTED ROUTES (require auth) ---
// Apply auth middleware to all /api routes except /api/auth
app.use("/api/packages/*", authMiddleware);
app.use("/api/invoices/*", authMiddleware);
app.use("/api/users/*", authMiddleware);
app.use("/api/config/*", authMiddleware);

// Users routes (admin and superadmin only - checked in route)
app.route("/api/users", usersRoutes);

// --- PACKAGES ---
// Get packages (with optional 'all' query param for including archived)
app.get("/api/packages", authMiddleware, async (c) => {
    try {
        const all = c.req.query("all");
        if (all === "true") {
            // Return all packages including archived
            const result = await db.select().from(packages);
            return c.json(result);
        } else {
            // Return only active packages
            const result = await db.select().from(packages).where(eq(packages.isActive, 1));
            return c.json(result);
        }
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

// Create package (admin/superadmin only)
app.post("/api/packages", async (c) => {
    const user = c.get("user") as { role: string } | undefined;
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const body = await c.req.json();
        const { name, price, category, description } = body;

        const result = sqlite.prepare(`
            INSERT INTO packages (name, price, category, description, is_active)
            VALUES (?, ?, ?, ?, 1)
        `).run(name, price, category || 'Utama', description || '');

        return c.json({ id: Number(result.lastInsertRowid), status: "created" });
    } catch (e) {
        console.error("Error creating package:", e);
        return c.json({ error: String(e) }, 500);
    }
});

// Update package (admin/superadmin only)
app.put("/api/packages/:id", async (c) => {
    const user = c.get("user") as { role: string } | undefined;
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const id = c.req.param("id");
        const body = await c.req.json();
        const { name, price, category, description } = body;

        sqlite.prepare(`
            UPDATE packages SET name = ?, price = ?, category = ?, description = ? WHERE id = ?
        `).run(name, price, category, description, Number(id));

        return c.json({ status: "updated" });
    } catch (e) {
        console.error("Error updating package:", e);
        return c.json({ error: String(e) }, 500);
    }
});

// Toggle package status (admin/superadmin only)
app.patch("/api/packages/:id/status", async (c) => {
    const user = c.get("user") as { role: string } | undefined;
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const id = c.req.param("id");
        const body = await c.req.json();
        const isActive = body.isActive ? 1 : 0;

        sqlite.prepare(`UPDATE packages SET is_active = ? WHERE id = ?`).run(isActive, Number(id));

        return c.json({ status: isActive ? "activated" : "archived" });
    } catch (e) {
        console.error("Error toggling package status:", e);
        return c.json({ error: String(e) }, 500);
    }
});

// Delete package (admin/superadmin only)
app.delete("/api/packages/:id", async (c) => {
    const user = c.get("user") as { role: string } | undefined;
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const id = c.req.param("id");
        sqlite.prepare(`DELETE FROM packages WHERE id = ?`).run(Number(id));
        return c.json({ status: "deleted" });
    } catch (e) {
        console.error("Error deleting package:", e);
        return c.json({ error: String(e) }, 500);
    }
});

// --- INVOICES ---
app.get("/api/invoices", authMiddleware, async (c) => {
    try {
        // Basic list for history
        const result = await db.select().from(invoices).orderBy(desc(invoices.id)).limit(100);
        return c.json(result);
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

app.get("/api/invoices/:id", async (c) => {
    try {
        const id = c.req.param("id");
        const result = await db.select().from(invoices).where(eq(invoices.id, Number(id))).limit(1);
        if (result.length === 0) return c.json({ error: "Not found" }, 404);
        return c.json(result[0]);
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

app.post("/api/invoices", async (c) => {
    try {
        const body = await c.req.json();

        // Extract fields
        const {
            clientName,
            invoiceNo,
            venue,
            weddingDate,
            clientPhone,
            eventTitle,
            items,
            paymentTerms,
            cashback,
            totalAmount
        } = body;

        // Store full payload as JSON
        const invoiceData = JSON.stringify({
            items,
            paymentTerms,
            cashback,
            venue,
            weddingDate,
            clientPhone,
            eventTitle
        });

        // Insert
        const result = sqlite.prepare(`
            INSERT INTO invoices (invoice_no, client_name, date, total_amount, invoice_data)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            invoiceNo || `INV/${new Date().getFullYear()}/${Date.now()}`,
            clientName,
            weddingDate || new Date().toISOString().split('T')[0],
            totalAmount,
            invoiceData
        );

        const insertedId = result.lastInsertRowid;

        return c.json({
            id: Number(insertedId),
            invoiceNo,
            clientName,
            totalAmount,
            status: "created"
        });
    } catch (e) {
        console.error("Error creating invoice:", e);
        return c.json({ error: String(e) }, 500);
    }
});

// --- CONFIG ---
app.get("/api/config", authMiddleware, async (c) => {
    try {
        const result = await db.select().from(appConfig);
        const config: Record<string, string | null> = {};
        for (const row of result) {
            if (row.key) config[row.key] = row.value;
        }
        return c.json(config);
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

console.log("Server running on http://localhost:3000");

export default {
    port: 3000,
    fetch: app.fetch,
};