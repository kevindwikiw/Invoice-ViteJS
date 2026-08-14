import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { packages } from "../db/schema";
import { eq } from "drizzle-orm";

const packagesRouter = new Hono();
const sqlite = new Database("db/sqlite.db");
const db = drizzle(sqlite);

packagesRouter.get("/", async (c) => {
    try {
        const all = c.req.query("all");
        if (all === "true") {
            const result = await db.select().from(packages);
            return c.json(result);
        } else {
            const result = await db.select().from(packages).where(eq(packages.isActive, 1));
            return c.json(result);
        }
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

packagesRouter.post("/", async (c) => {
    const user = c.get("user" as any) as { role: string } | undefined;
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

packagesRouter.put("/:id", async (c) => {
    const user = c.get("user" as any) as { role: string } | undefined;
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

packagesRouter.patch("/:id/status", async (c) => {
    const user = c.get("user" as any) as { role: string } | undefined;
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

packagesRouter.delete("/:id", async (c) => {
    const user = c.get("user" as any) as { role: string } | undefined;
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

export default packagesRouter;
