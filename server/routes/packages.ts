import { Hono } from "hono";
import { all, insertReturningId, run } from "../db/runtime";

const packagesRouter = new Hono();

packagesRouter.get("/", async (c) => {
    try {
        const where = c.req.query("all") === "true" ? "" : " WHERE is_active = 1";
        const result = await all(`
            SELECT id, name, price, category, description, is_active as "isActive"
            FROM packages${where}
            ORDER BY id DESC
        `);
        return c.json(result);
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

function canManagePackages(c: any): boolean {
    const user = c.get("user") as { role: string } | undefined;
    return Boolean(user && (user.role === "admin" || user.role === "superadmin"));
}

packagesRouter.post("/", async (c) => {
    if (!canManagePackages(c)) return c.json({ error: "Permission denied" }, 403);
    try {
        const body = await c.req.json();
        const { name, price, category, description } = body;
        const id = await insertReturningId(`
            INSERT INTO packages (name, price, category, description, is_active)
            VALUES (?, ?, ?, ?, 1)
        `, [name, price, category || "Utama", description || ""]);
        return c.json({ id, status: "created" });
    } catch (e) {
        console.error("Error creating package:", e);
        return c.json({ error: String(e) }, 500);
    }
});

packagesRouter.put("/:id", async (c) => {
    if (!canManagePackages(c)) return c.json({ error: "Permission denied" }, 403);
    try {
        const body = await c.req.json();
        const { name, price, category, description } = body;
        await run(
            "UPDATE packages SET name = ?, price = ?, category = ?, description = ? WHERE id = ?",
            [name, price, category, description, Number(c.req.param("id"))]
        );
        return c.json({ status: "updated" });
    } catch (e) {
        console.error("Error updating package:", e);
        return c.json({ error: String(e) }, 500);
    }
});

packagesRouter.patch("/:id/status", async (c) => {
    if (!canManagePackages(c)) return c.json({ error: "Permission denied" }, 403);
    try {
        const body = await c.req.json();
        const isActive = body.isActive ? 1 : 0;
        await run("UPDATE packages SET is_active = ? WHERE id = ?", [isActive, Number(c.req.param("id"))]);
        return c.json({ status: isActive ? "activated" : "archived" });
    } catch (e) {
        console.error("Error toggling package status:", e);
        return c.json({ error: String(e) }, 500);
    }
});

packagesRouter.delete("/:id", async (c) => {
    if (!canManagePackages(c)) return c.json({ error: "Permission denied" }, 403);
    try {
        await run("DELETE FROM packages WHERE id = ?", [Number(c.req.param("id"))]);
        return c.json({ status: "deleted" });
    } catch (e) {
        console.error("Error deleting package:", e);
        return c.json({ error: String(e) }, 500);
    }
});

export default packagesRouter;
