import { Hono } from "hono";
import { cors } from "hono/cors";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { packages, invoices, appConfig, users } from "./db/schema";
import { eq, desc } from "drizzle-orm";
import authRoutes from "./routes/auth";
import usersRoutes from "./routes/users";
import { authMiddleware } from "./middleware/auth";
import { loginRateLimiter } from "./middleware/rate-limit";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

// Ensure uploads directory exists
const PROOF_DIR = "uploads/proofs";
await mkdir(PROOF_DIR, { recursive: true });



// ============ SECURITY: Validate JWT_SECRET ============
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error("❌ FATAL: JWT_SECRET must be set and at least 32 characters long!");
    console.error("   Please set JWT_SECRET in your .env file.");
    process.exit(1);
}

const app = new Hono();

// CORS Configuration
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:3000").split(",");

app.use("/*", cors({
    origin: (origin) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return null;
        // Check if origin is in allowed list
        if (allowedOrigins.includes(origin)) return origin;
        // In development, allow all localhost ports
        if (process.env.NODE_ENV !== "production" && origin.includes("localhost")) return origin;
        return null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
}));

const sqlite = new Database("db/sqlite.db");
const db = drizzle(sqlite);

// Auto-migration for payment_proofs
try {
    const tableInfo = sqlite.prepare("PRAGMA table_info(invoices)").all() as any[];
    const hasCol = tableInfo.some(c => c.name === 'payment_proofs');
    if (!hasCol) {
        console.log("Migrating: Adding payment_proofs column to invoices...");
        sqlite.prepare("ALTER TABLE invoices ADD COLUMN payment_proofs TEXT").run();
        console.log("Migration successful.");
    }
} catch (e) {
    console.error("Migration check failed:", e);
}

app.get("/", (c) => {
    return c.text("Invoice App V2 API Running 🚀");
});

// Serve Static Uploads
app.get("/uploads/proofs/:filename", async (c) => {
    const filename = c.req.param("filename");
    const path = join(PROOF_DIR, filename);
    const file = Bun.file(path);
    if (await file.exists()) {
        return c.newResponse(file);
    }
    return c.text("File not found", 404);
});

// --- PUBLIC ROUTES ---
// Auth routes - login has rate limiting
app.post("/api/auth/login", loginRateLimiter);
app.route("/api/auth", authRoutes);

// --- PROTECTED ROUTES (require auth) ---
app.use("/api/packages/*", authMiddleware);
app.use("/api/invoices/*", authMiddleware);
app.use("/api/users/*", authMiddleware);
app.use("/api/config/*", authMiddleware);

// Users routes
app.route("/api/users", usersRoutes);

// --- PACKAGES ---
app.get("/api/packages", authMiddleware, async (c) => {
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

// Stats endpoint (MUST be before /:id to avoid capturing "stats" as an id)
app.get("/api/invoices/stats", authMiddleware, async (c) => {
    try {
        const allInvoices = await db.select().from(invoices).orderBy(desc(invoices.id));

        let totalRevenue = 0;
        let cntLunas = 0;
        let cntDp = 0;
        let cntUnpaid = 0;

        for (const inv of allInvoices) {
            totalRevenue += inv.totalAmount || 0;

            // Derive status from paymentTerms inside invoiceData
            let paymentTerms: any[] = [];
            try {
                if (inv.invoiceData) {
                    const data = JSON.parse(inv.invoiceData as string);
                    paymentTerms = data.paymentTerms || [];
                }
            } catch { /* ignore parse errors */ }

            if (Array.isArray(paymentTerms) && paymentTerms.length > 0) {
                const pelunasan = paymentTerms.find((t: any) =>
                    t.id === "full" || (t.label && t.label.toLowerCase().includes("pelunasan"))
                );
                const isLunas = pelunasan && Number(pelunasan.amount || 0) > 0;

                if (isLunas) {
                    cntLunas++;
                } else {
                    const hasDp = paymentTerms.some((t: any) =>
                        t.id !== "full" && Number(t.amount || 0) > 0
                    );
                    if (hasDp) cntDp++;
                    else cntUnpaid++;
                }
            } else {
                cntUnpaid++;
            }
        }

        return c.json({
            total: allInvoices.length,
            totalRevenue,
            lunas: cntLunas,
            dp: cntDp,
            unpaid: cntUnpaid,
        });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

app.get("/api/invoices", authMiddleware, async (c) => {
    try {
        const search = c.req.query("search") || "";
        const limitParam = parseInt(c.req.query("limit") || "50");
        const safeLimit = Math.min(Math.max(limitParam, 1), 200);

        let result;
        if (search) {
            const pattern = `%${search}%`;
            result = sqlite.prepare(
                `SELECT * FROM invoices WHERE invoice_no LIKE ? OR client_name LIKE ? ORDER BY id DESC LIMIT ?`
            ).all(pattern, pattern, safeLimit);
        } else {
            result = await db.select().from(invoices).orderBy(desc(invoices.id)).limit(safeLimit);
        }

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

app.post("/api/invoices/batch-delete", async (c) => {
    const user = c.get("user") as { role: string } | undefined;
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const { ids } = await c.req.json();
        if (!Array.isArray(ids) || ids.length === 0) {
            return c.json({ error: "No IDs provided" }, 400);
        }

        const placeholders = ids.map(() => "?").join(",");
        const result = sqlite.prepare(`DELETE FROM invoices WHERE id IN (${placeholders})`).run(...ids);

        // Auto-reset sequence if no invoices remain
        const remaining = sqlite.query("SELECT COUNT(*) as cnt FROM invoices").get() as { cnt: number };
        if (remaining.cnt === 0) {
            sqlite.prepare("UPDATE sequences SET last_value = 0 WHERE name = 'invoice'").run();
        }

        return c.json({ status: "deleted", count: result.changes });
    } catch (e) {
        console.error("Error batch deleting invoices:", e);
        return c.json({ error: String(e) }, 500);
    }
});

app.delete("/api/invoices/:id", async (c) => {
    const user = c.get("user") as { role: string } | undefined;
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const id = parseInt(c.req.param("id"));
        if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

        await db.delete(invoices).where(eq(invoices.id, id));

        // Auto-reset sequence if no invoices remain
        const remaining = sqlite.query("SELECT COUNT(*) as cnt FROM invoices").get() as { cnt: number };
        if (remaining.cnt === 0) {
            sqlite.prepare("UPDATE sequences SET last_value = 0 WHERE name = 'invoice'").run();
        }

        return c.json({ status: "deleted" });
    } catch (e) {
        console.error("Error deleting invoice:", e);
        return c.json({ error: String(e) }, 500);
    }
});

app.put("/api/invoices/:id", async (c) => {
    try {
        const id = parseInt(c.req.param("id"));
        if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

        const body = await c.req.json();
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
            totalAmount,
            bankName,
            bankAcc,
            bankHolder,
            terms,
            footerAddress,
            footerEmail,
            footerIG,
            footerPhone,
            waTemplate,
            hours // New Optional Field
        } = body;

        const invoiceData = JSON.stringify({
            items,
            paymentTerms,
            cashback,
            venue,
            weddingDate,
            clientPhone,
            eventTitle,
            bankName,
            bankAcc,
            bankHolder,
            terms,
            footerAddress,
            footerEmail,
            footerIG,
            footerPhone,
            waTemplate,
            hours // New Optional Field
        });

        sqlite.prepare(`
            UPDATE invoices 
            SET invoice_no = ?, client_name = ?, date = ?, total_amount = ?, invoice_data = ?
            WHERE id = ?
        `).run(
            invoiceNo,
            clientName,
            weddingDate || new Date().toISOString().split('T')[0],
            totalAmount,
            invoiceData,
            id
        );

        return c.json({ id, invoiceNo, clientName, totalAmount, status: "updated" });
    } catch (e) {
        console.error("Error updating invoice:", e);
        return c.json({ error: String(e) }, 500);
    }
});

app.post("/api/invoices", async (c) => {
    try {
        const body = await c.req.json();

        const {
            clientName,
            invoiceNo, // If empty, we generate it
            venue,
            weddingDate,
            clientPhone,
            eventTitle,
            items,
            paymentTerms,
            cashback,
            totalAmount,
            // Config fields
            bankName,
            bankAcc,
            bankHolder,
            terms,
            footerAddress,
            footerEmail,
            footerIG,
            footerPhone,
            waTemplate,
            hours // New Optional Field
        } = body;

        const invoiceData = JSON.stringify({
            items,
            paymentTerms,
            cashback,
            venue,
            weddingDate,
            clientPhone,
            eventTitle,
            // Config
            bankName,
            bankAcc,
            bankHolder,
            terms,
            footerAddress,
            footerEmail,
            footerIG,
            footerPhone,
            waTemplate,
            hours // New Optional Field
        });

        // Use transaction for atomic sequence generation
        const transaction = sqlite.transaction(() => {
            let finalInvoiceNo = invoiceNo;

            // Get sequence info
            const seq = sqlite.query("SELECT * FROM sequences WHERE name = 'invoice'").get() as { prefix: string, padding: number, last_value: number } | null;

            if (seq) {
                const nextVal = seq.last_value + 1;

                // Generate Invoice No if not provided
                if (!finalInvoiceNo) {
                    const paddedSeq = String(nextVal).padStart(seq.padding, '0');
                    finalInvoiceNo = `${seq.prefix}${paddedSeq}_${clientName.replace(/\s+/g, '_')}`;
                }

                // Always increment sequence on new invoice creation
                sqlite.prepare("UPDATE sequences SET last_value = ? WHERE name = 'invoice'").run(nextVal);
            } else if (!finalInvoiceNo) {
                throw new Error("Invoice sequence configuration missing");
            }

            const result = sqlite.prepare(`
                INSERT INTO invoices (invoice_no, client_name, date, total_amount, invoice_data)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                finalInvoiceNo,
                clientName,
                weddingDate || new Date().toISOString().split('T')[0],
                totalAmount,
                invoiceData
            );

            return { id: result.lastInsertRowid, invoiceNo: finalInvoiceNo };
        });

        const { id: insertedId, invoiceNo: generatedNo } = transaction();

        return c.json({
            id: Number(insertedId),
            invoiceNo: generatedNo,
            clientName,
            totalAmount,
            status: "created"
        });
    } catch (e) {
        console.error("Error creating invoice:", e);
        return c.json({ error: String(e) }, 500);
    }
});

// --- INVOICE PROOFS ---
app.post("/api/invoices/:id/proofs", async (c) => {
    try {
        const id = parseInt(c.req.param("id"));
        if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

        const body = await c.req.parseBody({ all: true }); // Parse all fields, including arrays
        let files = body['file'];

        // Normalize to array
        if (!files) {
            return c.json({ error: "No files uploaded" }, 400);
        }
        if (!Array.isArray(files)) {
            files = [files];
        }

        // Filter valid files
        const validFiles = (files as File[]).filter(f => f instanceof File && f.size > 0);
        if (validFiles.length === 0) {
            return c.json({ error: "No valid files uploaded" }, 400);
        }

        const newFilenames: string[] = [];

        // Process files
        for (const file of validFiles) {
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}_${file.name.replace(/\s+/g, '_')}`;
            const filePath = join(PROOF_DIR, fileName);
            await Bun.write(filePath, file);
            newFilenames.push(fileName);
            console.log(`[Upload] Invoice ${id}: Saved ${fileName}`);
        }

        // Update DB (Atomic Update)
        const inv = await db.select().from(invoices).where(eq(invoices.id, id)).get();
        if (!inv) return c.json({ error: "Invoice not found" }, 404);

        let currentProofs: string[] = [];
        try {
            currentProofs = inv.paymentProofs ? JSON.parse(inv.paymentProofs) : [];
        } catch (e) {
            console.error("[Upload] JSON Parse Error:", e);
        }

        const updatedProofs = [...currentProofs, ...newFilenames];
        console.log(`[Upload] Updated Proofs List:`, updatedProofs);

        await db.update(invoices)
            .set({ paymentProofs: JSON.stringify(updatedProofs) })
            .where(eq(invoices.id, id));

        return c.json({ status: "success", filenames: newFilenames, proofs: updatedProofs });
    } catch (e) {
        console.error("Upload error:", e);
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

app.put("/api/config", authMiddleware, async (c) => {
    const user = c.get("user") as { role: string } | undefined;
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



// --- ANALYTICS ---

// Ensure app_config table exists (Auto-migration)
try {
    sqlite.run(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)`);
} catch (e) {
    console.error("Failed to ensure app_config table:", e);
}
app.get("/api/analytics", authMiddleware, async (c) => {
    try {
        // 1. Config (Fetch from DB with fallback)
        let monthlyTarget = 50000000;
        try {
            const targetRow = await db.select().from(appConfig).where(eq(appConfig.key, 'monthly_target')).get();
            if (targetRow && targetRow.value) {
                monthlyTarget = parseFloat(targetRow.value);
            }
        } catch (e) {
            console.warn("Could not fetch monthly_target from DB, using default.", e);
        }

        // 2. Fetch Invoices (Limit 2000)
        // We select invoiceData and columns. 
        // Note: We don't need to select invoiceData twice.
        const rawInvoices = await db.select({
            id: invoices.id,
            invoiceData: invoices.invoiceData, // This contains venue, items, etc.
            date: invoices.date,
            totalAmount: invoices.totalAmount, // Use column val
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
                    // Ignore JSON parse error, use available columns
                }

                // Date Parsing
                const dateStr = inv.date || data.weddingDate || data.date;
                if (!dateStr) {
                    stats.skipped_rows++;
                    continue;
                }

                // Try parse date
                const d = new Date(dateStr);
                if (isNaN(d.getTime())) {
                    stats.skipped_rows++;
                    continue;
                }

                const amount = inv.totalAmount || data.totalAmount || 0;

                // Booking Entry
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

                // Items Processing
                if (Array.isArray(data.items)) {
                    for (const item of data.items) {
                        try {
                            let qty = Number(item.Qty || item.qty || 1);
                            if (isNaN(qty) || qty < 0) qty = 1;

                            allItems.push({
                                name: item.Description || item.description || "Unknown Package",
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

// Update Target
app.put("/api/analytics/target", authMiddleware, async (c) => {
    const user = c.get("user") as { role: string } | undefined;
    if (user?.role !== 'admin' && user?.role !== 'superadmin') {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const { target } = await c.req.json();
        const value = String(target);

        // Upsert
        await db.insert(appConfig).values({ key: 'monthly_target', value })
            .onConflictDoUpdate({ target: appConfig.key, set: { value } });

        return c.json({ success: true, target: parseFloat(value) });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

// --- SEQUENCES ---
app.get("/api/sequences/invoice", authMiddleware, async (c) => {
    try {
        const seq = sqlite.query("SELECT * FROM sequences WHERE name = 'invoice'").get() as { prefix: string, padding: number, last_value: number };
        if (!seq) {
            // Default if missing
            return c.json({ prefix: "INV", padding: 5, last_value: 0, next_value: 1 });
        }
        return c.json({ ...seq, next_value: seq.last_value + 1 });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

app.put("/api/sequences/invoice", async (c) => {
    const user = c.get("user") as { role: string } | undefined;
    if (!user || (user.role !== "admin" && user.role !== "superadmin")) {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const { last_value } = await c.req.json();
        sqlite.prepare("UPDATE sequences SET last_value = ? WHERE name = 'invoice'").run(last_value);
        return c.json({ status: "updated", last_value });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

console.log("Server running on http://localhost:3000");
console.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);

export default {
    port: 3000,
    fetch: app.fetch,
};