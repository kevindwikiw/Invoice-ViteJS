import { Database } from "bun:sqlite";
import postgres, { type Sql } from "postgres";

export type DatabaseDriver = "sqlite" | "postgres";

const configuredDriver = process.env.DATABASE_DRIVER?.toLowerCase();
const postgresEnvSource = process.env.SUPABASE_DB_URL
    ? "SUPABASE_DB_URL"
    : process.env.DATABASE_URL
        ? "DATABASE_URL"
        : null;
const postgresUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
export const databaseDriver: DatabaseDriver = configuredDriver === "postgres"
    ? "postgres"
    : configuredDriver === "sqlite"
        ? "sqlite"
        : postgresUrl
            ? "postgres"
            : "sqlite";

if (databaseDriver === "postgres" && !postgresUrl) {
    throw new Error("DATABASE_URL (or SUPABASE_DB_URL) is required when DATABASE_DRIVER=postgres");
}

if (databaseDriver === "postgres" && postgresUrl) {
    try {
        const parsedUrl = new URL(postgresUrl);
        console.info(
            `Using postgres database from ${postgresEnvSource}: ${parsedUrl.username}@${parsedUrl.hostname}:${parsedUrl.port || "5432"}`,
        );
    } catch {
        console.info(`Using postgres database from ${postgresEnvSource}: unable to parse redacted database URL`);
    }
}

export const sqlite = databaseDriver === "sqlite"
    ? new Database(process.env.SQLITE_PATH || "db/sqlite.db")
    : null;

export const pg: Sql | null = databaseDriver === "postgres"
    ? postgres(postgresUrl!, {
        // Supabase transaction poolers do not support prepared statements.
        prepare: false,
        ssl: process.env.DATABASE_SSL === "false" ? false : "require",
        max: Number(process.env.DATABASE_POOL_MAX || 5),
    })
    : null;

function toPostgresPlaceholders(query: string): string {
    let index = 0;
    return query.replace(/\?/g, () => `$${++index}`);
}

function requireSqlite(): Database {
    if (!sqlite) throw new Error("SQLite driver is not active");
    return sqlite;
}

function requirePostgres(): Sql {
    if (!pg) throw new Error("Postgres driver is not active");
    return pg;
}

export async function all<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
    if (databaseDriver === "sqlite") {
        return requireSqlite().prepare(query).all(...params as any[]) as T[];
    }
    return await requirePostgres().unsafe<T[]>(toPostgresPlaceholders(query), params as any);
}

export async function one<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T | null> {
    const rows = await all<T>(query, params);
    return rows[0] || null;
}

export type RunResult = {
    changes: number;
    lastInsertRowid?: number | string;
};

export async function run(query: string, params: unknown[] = []): Promise<RunResult> {
    if (databaseDriver === "sqlite") {
        const result = requireSqlite().prepare(query).run(...params as any[]);
        return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
    }
    const result = await requirePostgres().unsafe(toPostgresPlaceholders(query), params as any);
    return { changes: Number(result.count) };
}

export async function insertReturningId(query: string, params: unknown[] = []): Promise<number> {
    if (databaseDriver === "sqlite") {
        const result = requireSqlite().prepare(query).run(...params as any[]);
        return Number(result.lastInsertRowid);
    }
    const rows = await requirePostgres().unsafe<Array<{ id: number }>>(
        `${toPostgresPlaceholders(query)} RETURNING id`,
        params as any,
    );
    if (!rows[0]?.id) throw new Error("Insert did not return an id");
    return Number(rows[0].id);
}

export async function closeDatabase(): Promise<void> {
    if (pg) await pg.end({ timeout: 5 });
    sqlite?.close();
}
