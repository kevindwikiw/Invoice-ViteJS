import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { appConfig } from "../db/schema";

const configRouter = new Hono();
const sqlite = new Database("db/sqlite.db");
const db = drizzle(sqlite);

try {
    sqlite.run(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)`);
} catch (e) {
    console.error("Failed to ensure app_config table:", e);
}

configRouter.get("/", async (c) => {
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

configRouter.put("/", async (c) => {
    const user = c.get("user" as any) as { role: string } | undefined;
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const body = await c.req.json();
        const entries = Object.entries(body);

        const transaction = sqlite.transaction((data: [string, any][]) => {
            for (const [key, value] of data) {
                if (typeof value === 'string') {
                    sqlite.prepare(`
                        INSERT INTO app_config (key, value) VALUES (?, ?)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value
                    `).run(key, value);
                }
            }
        });

        transaction(entries);
        return c.json({ status: "updated", count: entries.length });
    } catch (e) {
        console.error("Error saving config:", e);
        return c.json({ error: String(e) }, 500);
    }
});

export default configRouter;
