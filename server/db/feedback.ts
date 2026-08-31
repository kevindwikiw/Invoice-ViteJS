import { createClient, type InValue } from "@tursodatabase/serverless/compat";
import { databaseDriver, all, one, run, type RunResult } from "./runtime";

const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN?.trim();
const hasCompleteTursoConfig = Boolean(tursoUrl && tursoAuthToken);
const hasPartialTursoConfig = Boolean(tursoUrl || tursoAuthToken) && !hasCompleteTursoConfig;

const turso = hasCompleteTursoConfig
    ? createClient({ url: tursoUrl!, authToken: tursoAuthToken! })
    : null;

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

async function initializeFeedbackStorage(): Promise<void> {
    if (hasPartialTursoConfig) {
        throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must both be configured");
    }

    if (turso) {
        await turso.batch([
            `CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_id INTEGER,
                invoice_no TEXT NOT NULL,
                client_name TEXT,
                rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
                tags TEXT NOT NULL DEFAULT '[]',
                message TEXT NOT NULL,
                photo_data BLOB,
                photo_drive_file_id TEXT,
                photo_mime TEXT,
                photo_size INTEGER,
                status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewed')),
                reviewed_by INTEGER,
                reviewed_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`,
            "CREATE INDEX IF NOT EXISTS idx_feedback_status_created_at ON feedback(status, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_feedback_invoice_no ON feedback(invoice_no)",
        ], "write");

        const tableInfo = await turso.execute("PRAGMA table_info(feedback)");
        const columns = new Set(tableInfo.rows.map((row) => String(row.name)));
        const additions = [
            ["client_name", "ALTER TABLE feedback ADD COLUMN client_name TEXT"],
            ["tags", "ALTER TABLE feedback ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'"],
            ["photo_data", "ALTER TABLE feedback ADD COLUMN photo_data BLOB"],
            ["photo_drive_file_id", "ALTER TABLE feedback ADD COLUMN photo_drive_file_id TEXT"],
            ["photo_mime", "ALTER TABLE feedback ADD COLUMN photo_mime TEXT"],
            ["photo_size", "ALTER TABLE feedback ADD COLUMN photo_size INTEGER"],
        ] as const;
        const missing = additions.filter(([name]) => !columns.has(name)).map(([, query]) => query);
        if (missing.length) await turso.batch(missing, "write");
        return;
    }

    if (databaseDriver !== "sqlite") {
        throw new Error("Turso feedback storage is not configured");
    }

    await run(`CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
        invoice_no TEXT NOT NULL,
        client_name TEXT,
        rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
        tags TEXT NOT NULL DEFAULT '[]',
        message TEXT NOT NULL,
        photo_data BLOB,
        photo_drive_file_id TEXT,
        photo_mime TEXT,
        photo_size INTEGER,
        status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'reviewed')),
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await run("CREATE INDEX IF NOT EXISTS idx_feedback_status_created_at ON feedback(status, created_at DESC)");
    await run("CREATE INDEX IF NOT EXISTS idx_feedback_invoice_no ON feedback(invoice_no)");

    const tableInfo = await all<{ name: string }>("PRAGMA table_info(feedback)");
    const columns = new Set(tableInfo.map((column) => column.name));
    const additions = [
        ["client_name", "ALTER TABLE feedback ADD COLUMN client_name TEXT"],
        ["tags", "ALTER TABLE feedback ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'"],
        ["photo_data", "ALTER TABLE feedback ADD COLUMN photo_data BLOB"],
        ["photo_drive_file_id", "ALTER TABLE feedback ADD COLUMN photo_drive_file_id TEXT"],
        ["photo_mime", "ALTER TABLE feedback ADD COLUMN photo_mime TEXT"],
        ["photo_size", "ALTER TABLE feedback ADD COLUMN photo_size INTEGER"],
    ] as const;
    for (const [name, query] of additions) {
        if (!columns.has(name)) await run(query);
    }
}

export function ensureFeedbackStorage(): Promise<void> {
    schemaPromise ??= initializeFeedbackStorage().catch((error) => {
        schemaPromise = null;
        throw error;
    });
    return schemaPromise;
}

export async function feedbackAll<T = Record<string, unknown>>(
    query: string,
    params: unknown[] = [],
): Promise<T[]> {
    await ensureFeedbackStorage();
    if (!turso) return all<T>(query, params);
    const result = await turso.execute({ sql: query, args: tursoArgs(params) });
    return result.rows as unknown as T[];
}

export async function feedbackOne<T = Record<string, unknown>>(
    query: string,
    params: unknown[] = [],
): Promise<T | null> {
    const rows = await feedbackAll<T>(query, params);
    return rows[0] ?? null;
}

export async function feedbackRun(query: string, params: unknown[] = []): Promise<RunResult> {
    await ensureFeedbackStorage();
    if (!turso) return run(query, params);
    const result = await turso.execute({ sql: query, args: tursoArgs(params) });
    return {
        changes: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid?.toString(),
    };
}

export const feedbackStorageDriver = turso
    ? "turso"
    : databaseDriver === "sqlite"
        ? "local-sqlite"
        : "unconfigured";
