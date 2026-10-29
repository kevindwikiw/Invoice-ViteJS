import { Hono } from "hono";
import { all, databaseDriver, pg, run, sqlite } from "../db/runtime";
import { hasFeaturePermission } from "../permissions";

const packagesRouter = new Hono();
type PackagePrice = { city: string; year: number; price: number };
type PackageInput = { name: string; category: string; description: string; prices?: PackagePrice[]; price?: number };

function parseInput(value: unknown): PackageInput {
    if (!value || typeof value !== "object") throw new Error("Invalid package data");
    const input = value as Record<string, unknown>;
    const name = String(input.name ?? "").trim();
    const category = String(input.category ?? "").trim();
    const description = String(input.description ?? "");
    if (!name || name.length > 200 || !category) throw new Error("Name and category are required");
    if (input.prices !== undefined && !Array.isArray(input.prices)) throw new Error("Invalid price list");
    const seen = new Set<string>();
    const prices = (input.prices as unknown[] | undefined)?.map((value) => {
        if (!value || typeof value !== "object") throw new Error("Invalid price entry");
        const entry = value as Record<string, unknown>;
        const city = String(entry.city ?? "").trim();
        const year = Number(entry.year);
        const price = Number(entry.price);
        if (!city || city.length > 64 || !Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isSafeInteger(price) || price < 0) {
            throw new Error("Each price needs a city, year, and non-negative whole IDR amount");
        }
        const key = `${city.toLocaleLowerCase("id-ID")}:${year}`;
        if (seen.has(key)) throw new Error("Duplicate city and year price");
        seen.add(key);
        return { city, year, price };
    });
    const legacyPrice = input.price === undefined ? undefined : Number(input.price);
    if (legacyPrice !== undefined && (!Number.isSafeInteger(legacyPrice) || legacyPrice < 0)) throw new Error("Invalid legacy price");
    return { name, category, description, prices, price: legacyPrice };
}

async function savePackage(input: PackageInput, id?: number): Promise<number> {
    if (databaseDriver === "sqlite") {
        const db = sqlite!;
        return db.transaction(() => {
            let packageId = id;
            if (packageId !== undefined) {
                const result = db.prepare("UPDATE packages SET name = ?, category = ?, description = ?, price = COALESCE(?, price) WHERE id = ?")
                    .run(input.name, input.category, input.description, input.price ?? null, packageId);
                if (!result.changes) throw new Error("Package not found");
            } else {
                packageId = Number(db.prepare("INSERT INTO packages (name, price, category, description, is_active) VALUES (?, ?, ?, ?, 1)")
                    .run(input.name, input.price ?? 0, input.category, input.description).lastInsertRowid);
            }
            if (input.prices !== undefined) {
                db.prepare("DELETE FROM package_prices WHERE package_id = ?").run(packageId);
                const insert = db.prepare("INSERT INTO package_prices (package_id, city, year, price) VALUES (?, ?, ?, ?)");
                for (const entry of input.prices) insert.run(packageId, entry.city, entry.year, entry.price);
            }
            return packageId;
        })();
    }
    return pg!.begin(async (tx) => {
        let packageId = id;
        if (packageId !== undefined) {
            const rows = await tx.unsafe<Array<{ id: number }>>(
                "UPDATE packages SET name = $1, category = $2, description = $3, price = COALESCE($4, price) WHERE id = $5 RETURNING id",
                [input.name, input.category, input.description, input.price ?? null, packageId],
            );
            if (!rows.length) throw new Error("Package not found");
        } else {
            const rows = await tx.unsafe<Array<{ id: number }>>(
                "INSERT INTO packages (name, price, category, description, is_active) VALUES ($1, $2, $3, $4, 1) RETURNING id",
                [input.name, input.price ?? 0, input.category, input.description],
            );
            if (!rows[0]) throw new Error("Package insert failed");
            packageId = Number(rows[0].id);
        }
        if (input.prices !== undefined) {
            await tx.unsafe("DELETE FROM package_prices WHERE package_id = $1", [packageId]);
            for (const entry of input.prices) {
                await tx.unsafe(
                    "INSERT INTO package_prices (package_id, city, year, price) VALUES ($1, $2, $3, $4)",
                    [packageId, entry.city, entry.year, entry.price],
                );
            }
        }
        return packageId!;
    });
}

packagesRouter.get("/", async (c) => {
    try {
        const includeAll = c.req.query("all") === "true";
        if (includeAll && !await canManagePackages(c)) return c.json({ error: "Permission denied" }, 403);
        const where = includeAll ? "" : " WHERE is_active = 1";
        const [packages, prices] = await Promise.all([
            all<{ id: number; name: string; price: number; category: string; description: string; isActive: number }>(
                `SELECT id, name, price, category, description, is_active as "isActive" FROM packages${where} ORDER BY id DESC`,
            ),
            all<{ packageId: number; city: string; year: number; price: number }>(
                `SELECT pp.package_id as "packageId", pp.city, pp.year, pp.price FROM package_prices pp JOIN packages p ON p.id = pp.package_id${includeAll ? "" : " WHERE p.is_active = 1"} ORDER BY pp.year, pp.city`,
            ),
        ]);
        const byPackage = new Map<number, PackagePrice[]>();
        for (const { packageId, city, year, price } of prices) {
            const entries = byPackage.get(packageId) ?? [];
            entries.push({ city, year: Number(year), price: Number(price) });
            byPackage.set(packageId, entries);
        }
        return c.json(packages.map((pkg) => ({ ...pkg, price: Number(pkg.price), prices: byPackage.get(pkg.id) ?? [] })));
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

async function canManagePackages(c: any): Promise<boolean> {
    const user = c.get("user") as { sub: number; role: string } | undefined;
    return Boolean(user && await hasFeaturePermission(user, "manage_packages"));
}

async function canDeletePackages(c: any): Promise<boolean> {
    const user = c.get("user") as { sub: number; role: string } | undefined;
    return Boolean(user && await hasFeaturePermission(user, "delete_packages"));
}

packagesRouter.post("/", async (c) => {
    if (!await canManagePackages(c)) return c.json({ error: "Permission denied" }, 403);
    try {
        const id = await savePackage(parseInput(await c.req.json()));
        return c.json({ id, status: "created" });
    } catch (e) {
        return c.json({ error: String(e) }, 400);
    }
});

packagesRouter.put("/:id", async (c) => {
    if (!await canManagePackages(c)) return c.json({ error: "Permission denied" }, 403);
    try {
        const id = Number(c.req.param("id"));
        if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: "Invalid package id" }, 400);
        await savePackage(parseInput(await c.req.json()), id);
        return c.json({ status: "updated" });
    } catch (e) {
        return c.json({ error: String(e) }, e instanceof Error && e.message === "Package not found" ? 404 : 400);
    }
});

packagesRouter.patch("/:id/price", async (c) => {
    if (!await canManagePackages(c)) return c.json({ error: "Permission denied" }, 403);
    try {
        const id = Number(c.req.param("id"));
        const body = await c.req.json() as Record<string, unknown>;
        const city = String(body.city ?? "").trim();
        const year = Number(body.year);
        const price = Number(body.price);
        if (!Number.isSafeInteger(id) || id < 1 || !city || city.length > 64 || !Number.isInteger(year) || year < 2026 || year > 2100 || !Number.isSafeInteger(price) || price < 0) {
            return c.json({ error: "Invalid package price" }, 400);
        }
        const packageRows = await all<{ id: number; category: string }>("SELECT id, category FROM packages WHERE id = ? AND is_active = 1", [id]);
        if (!packageRows[0]) return c.json({ error: "Active package not found" }, 404);
        if (year === 2026 && price === 0 && packageRows[0].category !== "Free / Complimentary") {
            return c.json({ error: "Only complimentary packages can have a zero 2026 price" }, 400);
        }
        if (year === 2026) {
            await run("UPDATE packages SET price = ? WHERE id = ?", [price, id]);
        } else {
            const existing = await all<{ city: string }>(
                "SELECT city FROM package_prices WHERE package_id = ? AND year = ? AND lower(city) = lower(?) LIMIT 1",
                [id, year, city],
            );
            await run(
                "INSERT INTO package_prices (package_id, city, year, price) VALUES (?, ?, ?, ?) ON CONFLICT (package_id, city, year) DO UPDATE SET price = excluded.price",
                [id, existing[0]?.city ?? city, year, price],
            );
        }
        return c.json({ price, city, year, status: "updated" });
    } catch (e) {
        return c.json({ error: String(e) }, 400);
    }
});

packagesRouter.patch("/:id/status", async (c) => {
    if (!await canManagePackages(c)) return c.json({ error: "Permission denied" }, 403);
    try {
        const body = await c.req.json();
        const isActive = body.isActive ? 1 : 0;
        await run("UPDATE packages SET is_active = ? WHERE id = ?", [isActive, Number(c.req.param("id"))]);
        return c.json({ status: isActive ? "activated" : "archived" });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

packagesRouter.delete("/:id", async (c) => {
    if (!await canDeletePackages(c)) return c.json({ error: "Permission denied" }, 403);
    try {
        const id = Number(c.req.param("id"));
        if (!Number.isSafeInteger(id) || id < 1) return c.json({ error: "Invalid package id" }, 400);
        if (databaseDriver === "sqlite") {
            sqlite!.transaction(() => {
                sqlite!.prepare("DELETE FROM package_prices WHERE package_id = ?").run(id);
                sqlite!.prepare("DELETE FROM packages WHERE id = ?").run(id);
            })();
        } else {
            await pg!.begin(async (tx) => {
                await tx.unsafe("DELETE FROM package_prices WHERE package_id = $1", [id]);
                await tx.unsafe("DELETE FROM packages WHERE id = $1", [id]);
            });
        }
        return c.json({ status: "deleted" });
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

export default packagesRouter;
