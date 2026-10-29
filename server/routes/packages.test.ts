import { beforeAll, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";

process.env.DATABASE_DRIVER = "sqlite";
process.env.SQLITE_PATH = ":memory:";
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_DB_URL;

const { sqlite } = await import("../db/runtime");
const { default: packagesRouter } = await import("./packages");
const app = new Hono<{ Variables: { user: { sub: number; role: string } } }>();
app.use("/*", async (c, next) => { c.set("user", { sub: 1, role: "admin" }); await next(); });
app.route("/packages", packagesRouter);

beforeAll(() => {
    sqlite!.exec(`CREATE TABLE IF NOT EXISTS packages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, price REAL NOT NULL, category TEXT, description TEXT, is_active INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS package_prices (package_id INTEGER NOT NULL, city TEXT NOT NULL, year INTEGER NOT NULL, price INTEGER NOT NULL, PRIMARY KEY (package_id, city, year));
        CREATE TABLE IF NOT EXISTS user_permissions (user_id INTEGER, permission_key TEXT, effect TEXT);`);
});

beforeEach(() => sqlite!.exec("DELETE FROM package_prices; DELETE FROM packages"));

const request = (method: string, path: string, body?: unknown) => app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
});

test("one package carries all four city/year prices while legacy price remains a reference", async () => {
    sqlite!.exec("INSERT INTO packages (id, name, price, category, description) VALUES (7, 'Best Offer 1', 14500000, 'Bundling Package', 'Coverage')");
    const prices = [
        { city: "Bandung", year: 2026, price: 14_500_000 },
        { city: "Bandung", year: 2027, price: 16_000_000 },
        { city: "Jakarta", year: 2026, price: 15_500_000 },
        { city: "Jakarta", year: 2027, price: 17_000_000 },
    ];
    expect((await request("PUT", "/packages/7", { name: "Best Offer 1", category: "Bundling Package", description: "Coverage", prices })).status).toBe(200);
    const rows = await (await request("GET", "/packages")).json() as Array<{ id: number; price: number; prices: typeof prices }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.price).toBe(14_500_000);
    expect(rows[0]!.prices).toEqual([prices[0]!, prices[2]!, prices[1]!, prices[3]!]);
});

test("missing prices stay missing and invalid updates do not erase previous prices", async () => {
    const created = await request("POST", "/packages", {
        name: "Wedding", category: "Wedding", description: "Photo",
        prices: [{ city: "Bandung", year: 2027, price: 10_000_000 }],
    });
    const { id } = await created.json() as { id: number };
    expect(created.status).toBe(200);
    const bad = await request("PUT", `/packages/${id}`, {
        name: "Changed", category: "Wedding", description: "Photo",
        prices: [{ city: "Bandung", year: 2027, price: 1 }, { city: "Bandung", year: 2027, price: 2 }],
    });
    expect(bad.status).toBe(400);
    const rows = await (await request("GET", "/packages")).json() as Array<{ name: string; price: number; prices: unknown[] }>;
    expect(rows[0]!.name).toBe("Wedding");
    expect(rows[0]!.price).toBe(0);
    expect(rows[0]!.prices).toEqual([{ city: "Bandung", year: 2027, price: 10_000_000 }]);
});

test("setting one city tariff keeps other prices and updates the existing year safely", async () => {
    sqlite!.exec("INSERT INTO packages (id, name, price, category, description) VALUES (7, 'Best Offer', 9200000, 'Wedding', 'Coverage')");
    sqlite!.exec("INSERT INTO package_prices (package_id, city, year, price) VALUES (7, 'Jakarta', 2027, 12000000)");
    expect((await request("PATCH", "/packages/7/price", { city: "Bandung", year: 2027, price: 11_000_000 })).status).toBe(200);
    expect((await request("PATCH", "/packages/7/price", { city: "bandung", year: 2027, price: 11_500_000 })).status).toBe(200);
    const rows = await (await request("GET", "/packages")).json() as Array<{ price: number; prices: Array<{ city: string; year: number; price: number }> }>;
    expect(rows[0]!.price).toBe(9_200_000);
    expect(rows[0]!.prices).toEqual([
        { city: "Bandung", year: 2027, price: 11_500_000 },
        { city: "Jakarta", year: 2027, price: 12_000_000 },
    ]);
    expect((await request("PATCH", "/packages/7/price", { city: "Bandung", year: 2026, price: 0 })).status).toBe(400);
    expect((await request("PATCH", "/packages/7/price", { city: "Bandung", year: 2026, price: 10_000_000 })).status).toBe(200);
    const updated = await (await request("GET", "/packages")).json() as Array<{ price: number; prices: unknown[] }>;
    expect(updated[0]!.price).toBe(10_000_000);
    expect(updated[0]!.prices).toHaveLength(2);
    expect((await request("PATCH", "/packages/999/price", { city: "Bandung", year: 2027, price: 1 })).status).toBe(404);
});

test("setting a package price requires package management permission", async () => {
    const employeeApp = new Hono<{ Variables: { user: { sub: number; role: string } } }>();
    employeeApp.use("/*", async (c, next) => { c.set("user", { sub: 2, role: "employee" }); await next(); });
    employeeApp.route("/packages", packagesRouter);
    const response = await employeeApp.request("/packages/7/price", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ city: "Bandung", year: 2027, price: 11_000_000 }),
    });
    expect(response.status).toBe(403);
});
