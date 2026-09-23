import { createClient, type InValue } from "@tursodatabase/serverless/compat";
import { all, databaseDriver, insertReturningId, one, run, sqlite, type RunResult } from "./runtime";

const galleryDatabaseUrl = process.env.GALLERY_DATABASE_URL?.trim() || process.env.TURSO_DATABASE_URL?.trim();
const galleryAuthToken = process.env.GALLERY_AUTH_TOKEN?.trim() || process.env.TURSO_AUTH_TOKEN?.trim();
const hasCompleteGalleryTursoConfig = Boolean(galleryDatabaseUrl && galleryAuthToken);
const hasPartialGalleryTursoConfig = Boolean(galleryDatabaseUrl || galleryAuthToken) && !hasCompleteGalleryTursoConfig;

const galleryTurso = hasCompleteGalleryTursoConfig
    ? createClient({ url: galleryDatabaseUrl!, authToken: galleryAuthToken! })
    : null;

let schemaPromise: Promise<void> | null = null;
const GALLERY_COUNTER_BACKFILL_KEY = "gallery_counter_backfill_v1";
const GALLERY_DURATION_HOURS_BACKFILL_KEY = "gallery_duration_hours_backfill_v1";
const GALLERY_COUNTER_BACKFILL_SQL = `
    UPDATE galleries
    SET photo_count = (SELECT COUNT(*) FROM gallery_photos WHERE gallery_id = galleries.id),
        selection_count = (SELECT COUNT(*) FROM gallery_selections WHERE gallery_id = galleries.id)
`;
const GALLERY_DURATION_HOURS_BACKFILL_SQL = `
    UPDATE galleries
    SET selection_duration_hours = selection_duration_days * 24
    WHERE selection_duration_days IS NOT NULL
`;

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

const GALLERY_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS gallery_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS edit_packages (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, included_photo_count INTEGER NOT NULL, price INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS galleries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        public_key TEXT,
        contact_whatsapp_url TEXT,
        max_selections INTEGER NOT NULL DEFAULT 0,
        additional_selection_limit INTEGER NOT NULL DEFAULT 0,
        edit_addon_status TEXT NOT NULL DEFAULT 'none',
        edit_addon_pricing_mode TEXT NOT NULL DEFAULT 'per_photo',
        edit_addon_price INTEGER NOT NULL DEFAULT 10000,
        qris_enabled INTEGER NOT NULL DEFAULT 0,
         edit_addon_package_id INTEGER,
         drive_folder_id TEXT NOT NULL,
         tutorial_before_drive_file_id TEXT,
         tutorial_after_drive_file_id TEXT,
         tutorial_before_2_drive_file_id TEXT,
         tutorial_after_2_drive_file_id TEXT,
         tutorial_before_3_drive_file_id TEXT,
         tutorial_after_3_drive_file_id TEXT,
         pin_hash TEXT NOT NULL,
        access_version INTEGER NOT NULL DEFAULT 1,
        photo_count INTEGER NOT NULL DEFAULT 0,
        selection_count INTEGER NOT NULL DEFAULT 0,
        selection_duration_days INTEGER NOT NULL DEFAULT 3,
        selection_duration_hours INTEGER NOT NULL DEFAULT 72,
        selection_deadline_at TEXT,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'open', 'closed')),
        synced_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS gallery_photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gallery_id INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
        drive_file_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        thumbnail_url TEXT,
        web_view_url TEXT,
        width INTEGER,
        height INTEGER,
        display_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(gallery_id, drive_file_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_gallery_photos_gallery_order ON gallery_photos(gallery_id, display_order)",
    `CREATE TABLE IF NOT EXISTS gallery_selections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gallery_id INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
        selected_drive_file_id TEXT NOT NULL,
        selected_filename TEXT NOT NULL,
        note TEXT,
        submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(gallery_id, selected_drive_file_id)
    )`,
    `CREATE TABLE IF NOT EXISTS face_index_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gallery_id INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        model_version TEXT NOT NULL,
        source_version TEXT NOT NULL DEFAULT '',
        total INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    "CREATE INDEX IF NOT EXISTS idx_face_index_jobs_gallery_status ON face_index_jobs(gallery_id, status, created_at DESC)",
    `CREATE TABLE IF NOT EXISTS face_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gallery_id INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
        drive_file_id TEXT NOT NULL,
        face_index INTEGER NOT NULL DEFAULT 0,
        embedding TEXT NOT NULL,
        bounding_box TEXT,
        source_version TEXT NOT NULL,
        model_version TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(gallery_id, drive_file_id, face_index, model_version)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_face_embeddings_gallery_file ON face_embeddings(gallery_id, drive_file_id)",
    `CREATE TABLE IF NOT EXISTS face_index_photos (
        gallery_id INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
        drive_file_id TEXT NOT NULL,
        source_version TEXT NOT NULL,
        model_version TEXT NOT NULL,
        PRIMARY KEY (gallery_id, drive_file_id, model_version)
    )`,
    `CREATE TABLE IF NOT EXISTS gallery_edit_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, gallery_id INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE, requested_additional_count INTEGER NOT NULL, pricing_mode TEXT NOT NULL, package_id INTEGER, unit_price INTEGER, quoted_total INTEGER, status TEXT NOT NULL DEFAULT 'pending', client_note TEXT, admin_note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    "CREATE INDEX IF NOT EXISTS idx_gallery_selections_gallery ON gallery_selections(gallery_id, selected_filename)",
    `CREATE TABLE IF NOT EXISTS payment_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT UNIQUE NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        gross_amount INTEGER NOT NULL,
        payment_type TEXT NOT NULL DEFAULT 'qris',
        transaction_status TEXT NOT NULL DEFAULT 'pending',
        qr_string TEXT,
        qr_url TEXT,
        expiry_time TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    "CREATE INDEX IF NOT EXISTS idx_payment_transactions_order ON payment_transactions(order_id)",
];

const GALLERY_REQUIRED_COLUMNS: Array<readonly [string, string]> = [
    ["public_key", "TEXT"],
    ["max_selections", "INTEGER NOT NULL DEFAULT 0"],
    ["additional_selection_limit", "INTEGER NOT NULL DEFAULT 0"],
    ["edit_addon_status", "TEXT NOT NULL DEFAULT 'none'"],
    ["edit_addon_pricing_mode", "TEXT NOT NULL DEFAULT 'per_photo'"],
    ["edit_addon_price", "INTEGER NOT NULL DEFAULT 10000"],
    ["qris_enabled", "INTEGER NOT NULL DEFAULT 0"],
    ["edit_addon_package_id", "INTEGER"],
    ["contact_whatsapp_url", "TEXT"],
    ["tutorial_before_drive_file_id", "TEXT"],
    ["tutorial_after_drive_file_id", "TEXT"],
    ["tutorial_before_2_drive_file_id", "TEXT"],
    ["tutorial_after_2_drive_file_id", "TEXT"],
    ["tutorial_before_3_drive_file_id", "TEXT"],
    ["tutorial_after_3_drive_file_id", "TEXT"],
    ["photo_count", "INTEGER NOT NULL DEFAULT 0"],
    ["selection_count", "INTEGER NOT NULL DEFAULT 0"],
    ["selection_duration_days", "INTEGER NOT NULL DEFAULT 3"],
    ["selection_duration_hours", "INTEGER NOT NULL DEFAULT 72"],
    ["selection_deadline_at", "TEXT"],
    ["access_version", "INTEGER NOT NULL DEFAULT 1"],
    ["face_source_version", "TEXT"],
    ["face_source_revision", "INTEGER NOT NULL DEFAULT 0"],
];

const FACE_SOURCE_SCHEMA = [
    "CREATE INDEX IF NOT EXISTS idx_face_jobs_source ON face_index_jobs(gallery_id, model_version, source_version, id)",
    `CREATE TRIGGER IF NOT EXISTS face_source_insert AFTER INSERT ON gallery_photos BEGIN
        UPDATE galleries SET face_source_revision = face_source_revision + 1, face_source_version = NULL WHERE id = NEW.gallery_id;
    END`,
    `CREATE TRIGGER IF NOT EXISTS face_source_delete AFTER DELETE ON gallery_photos BEGIN
        UPDATE galleries SET face_source_revision = face_source_revision + 1, face_source_version = NULL WHERE id = OLD.gallery_id;
    END`,
    `CREATE TRIGGER IF NOT EXISTS face_source_update AFTER UPDATE ON gallery_photos
    WHEN OLD.gallery_id IS NOT NEW.gallery_id OR OLD.drive_file_id IS NOT NEW.drive_file_id
        OR OLD.source_version IS NOT NEW.source_version
        OR (COALESCE(NEW.source_version, '') = '' AND (OLD.created_at IS NOT NEW.created_at OR OLD.width IS NOT NEW.width OR OLD.height IS NOT NEW.height))
    BEGIN
        UPDATE galleries SET face_source_revision = face_source_revision + 1, face_source_version = NULL WHERE id IN (OLD.gallery_id, NEW.gallery_id);
    END`,
];

const GALLERY_SELECTION_REQUIRED_COLUMNS: Array<readonly [string, string]> = [
    ["note", "TEXT"],
];

const GALLERY_PHOTO_REQUIRED_COLUMNS: Array<readonly [string, string]> = [
    ["source_version", "TEXT NOT NULL DEFAULT ''"],
];

const FACE_INDEX_JOB_REQUIRED_COLUMNS: Array<readonly [string, string]> = [
    ["source_version", "TEXT NOT NULL DEFAULT ''"],
];

type GalleryTableWithMigrations = "galleries" | "gallery_selections" | "gallery_photos" | "face_index_jobs";

async function ensureTursoColumns(tableName: GalleryTableWithMigrations, columns: Array<readonly [string, string]>): Promise<void> {
    if (!galleryTurso) return;
    const tableInfo = await galleryTurso.execute(`PRAGMA table_info(${tableName})`);
    const existingColumns = new Set(tableInfo.rows.map((row) => String((row as Record<string, unknown>).name)));
    for (const [columnName, columnDefinition] of columns) {
        if (!existingColumns.has(columnName)) {
            await galleryTurso.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
        }
    }
}

async function ensureSqliteColumns(tableName: GalleryTableWithMigrations, columns: Array<readonly [string, string]>): Promise<void> {
    const tableInfo = await all<{ name: string }>(`PRAGMA table_info(${tableName})`);
    const existingColumns = new Set(tableInfo.map((row) => row.name));
    for (const [columnName, columnDefinition] of columns) {
        if (!existingColumns.has(columnName)) {
            await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
        }
    }
}

async function initializeGalleryStorage(): Promise<void> {
    if (hasPartialGalleryTursoConfig) {
        throw new Error("Gallery storage requires both GALLERY_DATABASE_URL and GALLERY_AUTH_TOKEN, or both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
    }

    if (galleryTurso) {
        await galleryTurso.batch(GALLERY_SCHEMA, "write");
        await ensureTursoColumns("galleries", GALLERY_REQUIRED_COLUMNS);
        await galleryTurso.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_galleries_public_key ON galleries(public_key)");
        await ensureTursoColumns("gallery_selections", GALLERY_SELECTION_REQUIRED_COLUMNS);
        await ensureTursoColumns("gallery_photos", GALLERY_PHOTO_REQUIRED_COLUMNS);
        await ensureTursoColumns("face_index_jobs", FACE_INDEX_JOB_REQUIRED_COLUMNS);
        await galleryTurso.batch(FACE_SOURCE_SCHEMA, "write");
        const counterBackfill = await galleryTurso.execute({
            sql: "SELECT value FROM gallery_settings WHERE key = ?",
            args: [GALLERY_COUNTER_BACKFILL_KEY],
        });
        if (counterBackfill.rows.length === 0) {
            await galleryTurso.batch([
                { sql: GALLERY_COUNTER_BACKFILL_SQL, args: [] },
                {
                    sql: "INSERT INTO gallery_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
                    args: [GALLERY_COUNTER_BACKFILL_KEY, new Date().toISOString()],
                },
            ], "write");
        }
        const durationHoursBackfill = await galleryTurso.execute({
            sql: "SELECT value FROM gallery_settings WHERE key = ?",
            args: [GALLERY_DURATION_HOURS_BACKFILL_KEY],
        });
        if (durationHoursBackfill.rows.length === 0) {
            await galleryTurso.batch([
                { sql: GALLERY_DURATION_HOURS_BACKFILL_SQL, args: [] },
                {
                    sql: "INSERT INTO gallery_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
                    args: [GALLERY_DURATION_HOURS_BACKFILL_KEY, new Date().toISOString()],
                },
            ], "write");
        }
        const rows = await galleryTurso.execute("SELECT id FROM galleries WHERE public_key IS NULL OR public_key = ''");
        for (const row of rows.rows as unknown as Array<{ id: number }>) {
            await galleryTurso.execute({ sql: "UPDATE galleries SET public_key = ? WHERE id = ?", args: [crypto.randomUUID().replaceAll("-", ""), row.id] });
        }
        return;
    }

    if (databaseDriver !== "sqlite") {
        throw new Error("Gallery storage is not configured. Set GALLERY_DATABASE_URL/GALLERY_AUTH_TOKEN or TURSO_DATABASE_URL/TURSO_AUTH_TOKEN.");
    }

    for (const query of GALLERY_SCHEMA) {
        await run(query);
    }
    await ensureSqliteColumns("galleries", GALLERY_REQUIRED_COLUMNS);
    await run("CREATE UNIQUE INDEX IF NOT EXISTS idx_galleries_public_key ON galleries(public_key)");
    await ensureSqliteColumns("gallery_selections", GALLERY_SELECTION_REQUIRED_COLUMNS);
    await ensureSqliteColumns("gallery_photos", GALLERY_PHOTO_REQUIRED_COLUMNS);
    await ensureSqliteColumns("face_index_jobs", FACE_INDEX_JOB_REQUIRED_COLUMNS);
    for (const query of FACE_SOURCE_SCHEMA) await run(query);
    const counterBackfill = await one<{ value: string }>("SELECT value FROM gallery_settings WHERE key = ?", [GALLERY_COUNTER_BACKFILL_KEY]);
    if (!counterBackfill) {
        await run(GALLERY_COUNTER_BACKFILL_SQL);
        await run("INSERT INTO gallery_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING", [GALLERY_COUNTER_BACKFILL_KEY, new Date().toISOString()]);
    }
    const durationHoursBackfill = await one<{ value: string }>("SELECT value FROM gallery_settings WHERE key = ?", [GALLERY_DURATION_HOURS_BACKFILL_KEY]);
    if (!durationHoursBackfill) {
        await run(GALLERY_DURATION_HOURS_BACKFILL_SQL);
        await run("INSERT INTO gallery_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING", [GALLERY_DURATION_HOURS_BACKFILL_KEY, new Date().toISOString()]);
    }
    const rows = await all<{ id: number }>("SELECT id FROM galleries WHERE public_key IS NULL OR public_key = ''");
    for (const row of rows) await run("UPDATE galleries SET public_key = ? WHERE id = ?", [crypto.randomUUID().replaceAll("-", ""), row.id]);
}

export function ensureGalleryStorage(): Promise<void> {
    schemaPromise ??= initializeGalleryStorage().catch((error) => {
        schemaPromise = null;
        throw error;
    });
    return schemaPromise;
}

export async function galleryAll<T = Record<string, unknown>>(
    query: string,
    params: unknown[] = [],
): Promise<T[]> {
    await ensureGalleryStorage();
    if (!galleryTurso) return all<T>(query, params);
    const result = await galleryTurso.execute({ sql: query, args: tursoArgs(params) });
    return result.rows as unknown as T[];
}

export async function galleryOne<T = Record<string, unknown>>(
    query: string,
    params: unknown[] = [],
): Promise<T | null> {
    const rows = await galleryAll<T>(query, params);
    return rows[0] ?? null;
}

export async function galleryRun(query: string, params: unknown[] = []): Promise<RunResult> {
    await ensureGalleryStorage();
    if (!galleryTurso) return run(query, params);
    const result = await galleryTurso.execute({ sql: query, args: tursoArgs(params) });
    return {
        changes: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid?.toString(),
    };
}

export async function galleryInsertReturningId(query: string, params: unknown[] = []): Promise<number> {
    await ensureGalleryStorage();
    if (!galleryTurso) return insertReturningId(query, params);
    const result = await galleryTurso.execute({ sql: query, args: tursoArgs(params) });
    const id = Number(result.lastInsertRowid);
    if (!Number.isInteger(id)) throw new Error("Gallery insert did not return an id.");
    return id;
}

export async function galleryBatch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    await ensureGalleryStorage();
    if (galleryTurso) {
        await galleryTurso.batch(statements.map((statement) => ({
            sql: statement.sql,
            args: tursoArgs(statement.params || []),
        })), "write");
        return;
    }
    const gallerySqlite = sqlite;
    if (gallerySqlite) {
        const transaction = gallerySqlite.transaction(() => {
            for (const statement of statements) {
                gallerySqlite.prepare(statement.sql).run(...(statement.params || []) as any[]);
            }
        });
        transaction();
        return;
    }
    for (const statement of statements) await galleryRun(statement.sql, statement.params || []);
}

export const galleryStorageDriver = galleryTurso
    ? "turso"
    : databaseDriver === "sqlite"
        ? "local-sqlite"
        : "unconfigured";
