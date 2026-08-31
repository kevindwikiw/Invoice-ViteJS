import { createClient, type InValue } from "@tursodatabase/serverless/compat";
import { Database } from "bun:sqlite";
import { databaseDriver, sqlite } from "./runtime";

type RateLimitRow = {
    key: string;
    count: number;
    resetAt: number;
};

const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN?.trim();
const hasCompleteTursoConfig = Boolean(tursoUrl && tursoAuthToken);
const hasPartialTursoConfig = Boolean(tursoUrl || tursoAuthToken) && !hasCompleteTursoConfig;
const turso = hasCompleteTursoConfig ? createClient({ url: tursoUrl!, authToken: tursoAuthToken! }) : null;
const fallbackSqlite = sqlite || new Database(process.env.RATE_LIMIT_SQLITE_PATH || "db/rate-limit.db");

let schemaPromise: Promise<void> | null = null;

function tursoArgs(params: unknown[]): InValue[] {
    return params.map((value) => {
        if (
            value === null
            || typeof value === "string"
            || typeof value === "number"
            || typeof value === "bigint"
            || typeof value === "boolean"
            || value instanceof ArrayBuffer
            || value instanceof Uint8Array
            || value instanceof Date
        ) {
            return value;
        }
        throw new TypeError(`Unsupported Turso parameter type: ${typeof value}`);
    });
}

async function ensureRateLimitStorage(): Promise<void> {
    if (hasPartialTursoConfig) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must both be configured for shared rate limits.");
    const schema = `CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`;
    const index = "CREATE INDEX IF NOT EXISTS idx_rate_limits_reset_at ON rate_limits(reset_at)";
    if (turso) {
        await turso.execute(schema);
        await turso.execute(index);
        return;
    }
    fallbackSqlite.prepare(schema).run();
    fallbackSqlite.prepare(index).run();
}

function ensureStorage(): Promise<void> {
    schemaPromise ??= ensureRateLimitStorage().catch((error) => {
        schemaPromise = null;
        throw error;
    });
    return schemaPromise;
}

export type RateLimitCheck = {
    allowed: boolean;
    count: number;
    resetAt: number;
    retryAfter?: number;
};

export async function hitRateLimit(key: string, windowMs: number, maxAttempts: number, now = Date.now()): Promise<RateLimitCheck> {
    await ensureStorage();
    const resetAt = now + windowMs;
    const sql = `
        INSERT INTO rate_limits (key, count, reset_at, updated_at)
        VALUES (?, 1, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
            reset_at = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.reset_at END,
            updated_at = CURRENT_TIMESTAMP
        RETURNING key, count, reset_at as "resetAt"
    `;
    const params = [key, resetAt, now, now, resetAt];
    let row: RateLimitRow | null = null;
    if (turso) {
        const result = await turso.execute({ sql, args: tursoArgs(params) });
        row = (result.rows[0] as unknown as RateLimitRow | undefined) || null;
    } else {
        row = fallbackSqlite.prepare(sql).get(...params as any[]) as RateLimitRow | null;
    }
    if (!row) throw new Error("Rate limit write did not return a row.");
    const allowed = row.count <= maxAttempts;
    return {
        allowed,
        count: row.count,
        resetAt: Number(row.resetAt),
        retryAfter: allowed ? undefined : Math.ceil((Number(row.resetAt) - now) / 1000),
    };
}

export async function resetRateLimitKey(key: string): Promise<void> {
    await ensureStorage();
    if (turso) {
        await turso.execute({ sql: "DELETE FROM rate_limits WHERE key = ?", args: [key] });
        return;
    }
    fallbackSqlite.prepare("DELETE FROM rate_limits WHERE key = ?").run(key);
}

export async function resetRateLimitSuffixes(scope: string, suffixes: string[]): Promise<void> {
    await ensureStorage();
    if (!suffixes.length) return;
    const keys = suffixes.map((suffix) => `${scope}:%:${suffix}`);
    if (turso) {
        for (const key of keys) {
            await turso.execute({ sql: "DELETE FROM rate_limits WHERE key LIKE ?", args: [key] });
        }
        return;
    }
    const statement = fallbackSqlite.prepare("DELETE FROM rate_limits WHERE key LIKE ?");
    for (const key of keys) statement.run(key);
}

export async function remainingRateLimit(key: string, maxAttempts: number, now = Date.now()): Promise<number> {
    await ensureStorage();
    let row: { count: number; resetAt: number } | null = null;
    if (turso) {
        const result = await turso.execute({ sql: "SELECT count, reset_at as resetAt FROM rate_limits WHERE key = ?", args: [key] });
        row = (result.rows[0] as unknown as { count: number; resetAt: number } | undefined) || null;
    } else {
        row = fallbackSqlite.prepare("SELECT count, reset_at as resetAt FROM rate_limits WHERE key = ?").get(key) as { count: number; resetAt: number } | null;
    }
    if (!row || Number(row.resetAt) < now) return maxAttempts;
    return Math.max(0, maxAttempts - Number(row.count));
}

if (databaseDriver === "sqlite" && !sqlite) {
    process.on("exit", () => fallbackSqlite.close());
}

export const rateLimitStorageDriver = turso ? "turso" : "local-sqlite";
