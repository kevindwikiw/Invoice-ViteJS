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
        edit_addon_package_id INTEGER,
        drive_folder_id TEXT NOT NULL,
        pin_hash TEXT NOT NULL,
        access_version INTEGER NOT NULL DEFAULT 1,
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
    `CREATE TABLE IF NOT EXISTS gallery_edit_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, gallery_id INTEGER NOT NULL REFERENCES galleries(id) ON DELETE CASCADE, requested_additional_count INTEGER NOT NULL, pricing_mode TEXT NOT NULL, package_id INTEGER, unit_price INTEGER, quoted_total INTEGER, status TEXT NOT NULL DEFAULT 'pending', client_note TEXT, admin_note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    "CREATE INDEX IF NOT EXISTS idx_gallery_selections_gallery ON gallery_selections(gallery_id, selected_filename)",
];

async function initializeGalleryStorage(): Promise<void> {
    if (hasPartialGalleryTursoConfig) {
        throw new Error("Gallery storage requires both GALLERY_DATABASE_URL and GALLERY_AUTH_TOKEN, or both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
    }

    if (galleryTurso) {
        await galleryTurso.batch(GALLERY_SCHEMA, "write");
        try { await galleryTurso.execute("ALTER TABLE galleries ADD COLUMN public_key TEXT"); } catch (error) {
            if (!String(error).toLowerCase().includes("duplicate column")) throw error;
        }
    await galleryTurso.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_galleries_public_key ON galleries(public_key)");
        try { await galleryTurso.execute("ALTER TABLE galleries ADD COLUMN max_selections INTEGER NOT NULL DEFAULT 0"); } catch (error) { if (!String(error).toLowerCase().includes("duplicate column")) throw error; }
        for (const column of ["additional_selection_limit INTEGER NOT NULL DEFAULT 0", "edit_addon_status TEXT NOT NULL DEFAULT 'none'", "edit_addon_pricing_mode TEXT NOT NULL DEFAULT 'per_photo'", "edit_addon_price INTEGER NOT NULL DEFAULT 10000", "edit_addon_package_id INTEGER"]) { try { await galleryTurso.execute(`ALTER TABLE galleries ADD COLUMN ${column}`); } catch (error) { if (!String(error).toLowerCase().includes("duplicate column")) throw error; } }
        try { await galleryTurso.execute("ALTER TABLE galleries ADD COLUMN contact_whatsapp_url TEXT"); } catch (error) {
            if (!String(error).toLowerCase().includes("duplicate column")) throw error;
        }
        const rows = await galleryTurso.execute("SELECT id FROM galleries WHERE public_key IS NULL OR public_key = ''");
        for (const row of rows.rows as unknown as Array<{ id: number }>) {
            await galleryTurso.execute({ sql: "UPDATE galleries SET public_key = ? WHERE id = ?", args: [crypto.randomUUID().replaceAll("-", ""), row.id] });
        }
        try { await galleryTurso.execute("ALTER TABLE galleries ADD COLUMN access_version INTEGER NOT NULL DEFAULT 1"); } catch (error) {
            if (!String(error).toLowerCase().includes("duplicate column")) throw error;
        }
        try {
            await galleryTurso.execute("ALTER TABLE gallery_selections ADD COLUMN note TEXT");
        } catch (error) {
            if (!String(error).toLowerCase().includes("duplicate column")) throw error;
        }
        return;
    }

    if (databaseDriver !== "sqlite") {
        throw new Error("Gallery storage is not configured. Set GALLERY_DATABASE_URL/GALLERY_AUTH_TOKEN or TURSO_DATABASE_URL/TURSO_AUTH_TOKEN.");
    }

    for (const query of GALLERY_SCHEMA) {
        await run(query);
    }
    try { await run("ALTER TABLE galleries ADD COLUMN public_key TEXT"); } catch (error) {
        if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
    await run("CREATE UNIQUE INDEX IF NOT EXISTS idx_galleries_public_key ON galleries(public_key)");
    try { await run("ALTER TABLE galleries ADD COLUMN max_selections INTEGER NOT NULL DEFAULT 0"); } catch (error) { if (!String(error).toLowerCase().includes("duplicate column")) throw error; }
    for (const column of ["additional_selection_limit INTEGER NOT NULL DEFAULT 0", "edit_addon_status TEXT NOT NULL DEFAULT 'none'", "edit_addon_pricing_mode TEXT NOT NULL DEFAULT 'per_photo'", "edit_addon_price INTEGER NOT NULL DEFAULT 10000", "edit_addon_package_id INTEGER"]) { try { await run(`ALTER TABLE galleries ADD COLUMN ${column}`); } catch (error) { if (!String(error).toLowerCase().includes("duplicate column")) throw error; } }
    try { await run("ALTER TABLE galleries ADD COLUMN contact_whatsapp_url TEXT"); } catch (error) {
        if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
    const rows = await all<{ id: number }>("SELECT id FROM galleries WHERE public_key IS NULL OR public_key = ''");
    for (const row of rows) await run("UPDATE galleries SET public_key = ? WHERE id = ?", [crypto.randomUUID().replaceAll("-", ""), row.id]);
    try {
        await run("ALTER TABLE galleries ADD COLUMN access_version INTEGER NOT NULL DEFAULT 1");
    } catch (error) {
        if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
    try {
        await run("ALTER TABLE gallery_selections ADD COLUMN note TEXT");
    } catch (error) {
        if (!String(error).toLowerCase().includes("duplicate column")) throw error;
    }
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
