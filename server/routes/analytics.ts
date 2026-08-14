import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { invoices, appConfig } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { hasFeaturePermission } from "../permissions";

const analyticsRouter = new Hono();
const sqlite = new Database(process.env.SQLITE_PATH || "db/sqlite.db");
const db = drizzle(sqlite);

type AuthUser = {
    sub: number;
    email: string;
    name: string;
    role: string;
};

analyticsRouter.get("/", async (c) => {
    const user = c.get("user" as any) as AuthUser | undefined;
    if (!user || !hasFeaturePermission(sqlite, user, "view_market_insights")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        let monthlyTarget = 50000000;
        try {
            const targetRow = await db.select().from(appConfig).where(eq(appConfig.key, 'monthly_target')).get();
            if (targetRow && targetRow.value) {
                monthlyTarget = parseFloat(targetRow.value);
            }
        } catch (e) {
            console.warn("Could not fetch monthly_target from DB, using default.", e);
        }

        const rawInvoices = await db.select({
            id: invoices.id,
            invoiceData: invoices.invoiceData,
            date: invoices.date,
            totalAmount: invoices.totalAmount,
            clientName: invoices.clientName
        })
            .from(invoices)
            .orderBy(desc(invoices.id))
            .limit(2000);

        const bookings: any[] = [];
        const allItems: any[] = [];
        const stats = {
            total_loaded: rawInvoices.length,
            skipped_rows: 0,
            items_skipped: 0
        };

        for (const inv of rawInvoices) {
            try {
                let data: any = {};
                try {
                    data = inv.invoiceData ? JSON.parse(inv.invoiceData) : {};
                } catch (e) {
                    /* ignore JSON parse error */
                }

                const dateStr = inv.date || data.weddingDate || data.date;
                if (!dateStr) {
                    stats.skipped_rows++;
                    continue;
                }

                const d = new Date(dateStr);
                if (isNaN(d.getTime())) {
                    stats.skipped_rows++;
                    continue;
                }

                const amount = inv.totalAmount || data.totalAmount || 0;

                const booking = {
                    id: inv.id,
                    amount: amount < 0 ? 0 : amount,
                    venue: data.venue || "Unknown",
                    client_name: inv.clientName || data.clientName || "Unknown",
                    date_obj: d.toISOString(),
                    year: d.getFullYear(),
                    month: d.getMonth() + 1,
                    day: d.getDate(),
                    month_name: d.toLocaleString('default', { month: 'long' }),
                    date_str: d.toISOString().split('T')[0]
                };
                bookings.push(booking);

                if (Array.isArray(data.items)) {
                    for (const item of data.items) {
                        try {
                            let qty = Number(item.Qty || item.qty || item.quantity || 1);
                            if (isNaN(qty) || qty < 0) qty = 1;

                            const rawName = item.desc || item.Description || item.description || item.packageName || item.name || item.title || item.details || "Custom Package";

                            allItems.push({
                                name: String(rawName).trim(),
                                qty: qty,
                                year: d.getFullYear(),
                                month: d.getMonth() + 1
                            });
                        } catch (e) {
                            stats.items_skipped++;
                        }
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
                unique_clients: [...new Set(bookings.map(b => b.client_name))],
                unique_venues: [...new Set(bookings.map(b => b.venue))]
            }
        });

    } catch (e) {
        console.error("Analytics Error:", e);
        return c.json({ error: String(e) }, 500);
    }
});

analyticsRouter.put("/target", async (c) => {
    const user = c.get("user" as any) as AuthUser | undefined;
    if (user?.role !== 'admin' && user?.role !== 'superadmin') {
        return c.json({ error: "Permission denied" }, 403);
    }
    if (!user || !hasFeaturePermission(sqlite, user, "view_market_insights")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const { target } = await c.req.json();
        const value = String(target);

        await db.insert(appConfig).values({ key: 'monthly_target', value })
            .onConflictDoUpdate({ target: appConfig.key, set: { value } });

        return c.json({ success: true, target: parseFloat(value) });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

export default analyticsRouter;
