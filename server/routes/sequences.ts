import { Hono } from "hono";
import { one, run } from "../db/runtime";

const sequencesRouter = new Hono();

sequencesRouter.get("/invoice", async (c) => {
    try {
        const seq = await one<{ prefix: string; padding: number; last_value: number }>(
            "SELECT prefix, padding, last_value FROM sequences WHERE name = 'invoice'"
        );
        if (!seq) return c.json({ prefix: "INV", padding: 5, last_value: 0, next_value: 1 });
        return c.json({ ...seq, next_value: Number(seq.last_value) + 1 });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

sequencesRouter.put("/invoice", async (c) => {
    const user = c.get("user" as any) as { role: string } | undefined;
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
        return c.json({ error: "Permission denied" }, 403);
    }
    try {
        const { last_value } = await c.req.json();
        await run("UPDATE sequences SET last_value = ? WHERE name = 'invoice'", [last_value]);
        return c.json({ status: "updated", last_value });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

export default sequencesRouter;
