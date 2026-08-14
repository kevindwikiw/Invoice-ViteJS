import { Hono } from "hono";
import { all, run } from "../db/runtime";
import { hasFeaturePermission } from "../permissions";

const analyticsRouter = new Hono();

type AuthUser = { sub: number; email: string; name: string; role: string };

analyticsRouter.get("/", async (c) => {
    const user = c.get("user" as any) as AuthUser | undefined;
    if (!user || !await hasFeaturePermission(user, "view_market_insights")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        let monthlyTarget = 50000000;
        const targetRow = await all<{ value: string | null }>(
            "SELECT value FROM app_config WHERE key = 'monthly_target' LIMIT 1"
        );
        if (targetRow[0]?.value) monthlyTarget = parseFloat(targetRow[0].value);

        const rawInvoices = await all<{
            id: number;
            invoiceData: string | null;
            date: string | null;
            totalAmount: number | null;
            clientName: string | null;
        }>(`
            SELECT id, invoice_data as "invoiceData", date,
                   total_amount as "totalAmount", client_name as "clientName"
            FROM invoices ORDER BY id DESC LIMIT 2000
        `);

        const bookings: any[] = [];
        const allItems: any[] = [];
        const stats = { total_loaded: rawInvoices.length, skipped_rows: 0, items_skipped: 0 };

        for (const inv of rawInvoices) {
            try {
                let data: any = {};
                try { data = inv.invoiceData ? JSON.parse(inv.invoiceData) : {}; } catch { /* ignore */ }
                const dateStr = inv.date || data.weddingDate || data.date;
                if (!dateStr) { stats.skipped_rows++; continue; }
                const d = new Date(dateStr);
                if (Number.isNaN(d.getTime())) { stats.skipped_rows++; continue; }
                const amount = inv.totalAmount || data.totalAmount || 0;
                bookings.push({
                    id: inv.id,
                    amount: amount < 0 ? 0 : amount,
                    venue: data.venue || "Unknown",
                    client_name: inv.clientName || data.clientName || "Unknown",
                    date_obj: d.toISOString(),
                    year: d.getFullYear(),
                    month: d.getMonth() + 1,
                    day: d.getDate(),
                    month_name: d.toLocaleString("default", { month: "long" }),
                    date_str: d.toISOString().split("T")[0],
                });
                if (Array.isArray(data.items)) {
                    for (const item of data.items) {
                        try {
                            let qty = Number(item.Qty || item.qty || item.quantity || 1);
                            if (Number.isNaN(qty) || qty < 0) qty = 1;
                            const rawName = item.desc || item.Description || item.description || item.packageName || item.name || item.title || item.details || "Custom Package";
                            allItems.push({ name: String(rawName).trim(), qty, year: d.getFullYear(), month: d.getMonth() + 1 });
                        } catch { stats.items_skipped++; }
                    }
                }
            } catch (e) {
                stats.skipped_rows++;
                console.error(`Error processing invoice ${inv.id} for analytics:`, e);
            }
        }

        return c.json({
            bookings,
            items: allItems,
            meta: {
                ...stats,
                monthly_target: monthlyTarget,
                unique_clients: [...new Set(bookings.map((b) => b.client_name))],
                unique_venues: [...new Set(bookings.map((b) => b.venue))],
            },
        });
    } catch (e) {
        console.error("Analytics Error:", e);
        return c.json({ error: String(e) }, 500);
    }
});

analyticsRouter.put("/target", async (c) => {
    const user = c.get("user" as any) as AuthUser | undefined;
    if (!user || (user.role !== "admin" && user.role !== "superadmin") || !await hasFeaturePermission(user, "view_market_insights")) {
        return c.json({ error: "Permission denied" }, 403);
    }
    try {
        const { target } = await c.req.json();
        const value = String(target);
        await run(`
            INSERT INTO app_config (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `, ["monthly_target", value]);
        return c.json({ success: true, target: parseFloat(value) });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

export default analyticsRouter;
