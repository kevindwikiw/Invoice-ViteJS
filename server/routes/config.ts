import { Hono } from "hono";
import { all, run } from "../db/runtime";

const configRouter = new Hono();

configRouter.get("/", async (c) => {
    try {
        const rows = await all<{ key: string | null; value: string | null }>("SELECT key, value FROM app_config");
        const config: Record<string, string | null> = {};
        for (const row of rows) if (row.key) config[row.key] = row.value;
        return c.json(config);
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

configRouter.put("/", async (c) => {
    const user = c.get("user" as any) as { role: string } | undefined;
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
        return c.json({ error: "Permission denied" }, 403);
    }
    try {
        const body = await c.req.json();
        let count = 0;
        for (const [key, value] of Object.entries(body)) {
            if (typeof value !== "string") continue;
            await run(`
                INSERT INTO app_config (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
            `, [key, value]);
            count++;
        }
        return c.json({ status: "updated", count });
    } catch (e) {
        console.error("Error saving config:", e);
        return c.json({ error: String(e) }, 500);
    }
});

export default configRouter;
