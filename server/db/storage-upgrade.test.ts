import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

// Separate processes exercise real initialization without sharing cached storage
// modules or opening the developer's database/environment.
for (const legacy of [true, false]) {
    test(`storage initializes ${legacy ? "legacy" : "fresh"} schemas without losing data`, async () => {
        const env: Record<string, string | undefined> = { ...process.env, DATABASE_DRIVER: "sqlite", SQLITE_PATH: ":memory:", RATE_LIMIT_SQLITE_PATH: ":memory:" };
        for (const key of ["GALLERY_DATABASE_URL", "GALLERY_AUTH_TOKEN", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "DATABASE_URL", "SUPABASE_DB_URL"]) delete env[key];
        const script = `
            import assert from 'node:assert/strict';
            const { sqlite: db } = await import('./db/runtime');
            if (${legacy}) {
                db.exec(\`CREATE TABLE rate_limits ("key" TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)\`);
                db.exec(\`INSERT INTO rate_limits ("key", count, reset_at) VALUES ('login:test', 2, 2000)\`);
                db.exec(\`CREATE TABLE face_index_jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, gallery_id INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued', model_version TEXT NOT NULL,
                    total INTEGER NOT NULL DEFAULT 0, processed INTEGER NOT NULL DEFAULT 0, error TEXT,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, started_at TEXT, completed_at TEXT,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )\`);
                db.exec(\`INSERT INTO face_index_jobs (gallery_id, model_version, status, total, processed) VALUES (1, 'old-model', 'completed', 3, 3)\`);
            }
            const { ensureGalleryStorage, galleryRun } = await import('./db/galleries');
            const { remainingRateLimit, hitRateLimit, resetRateLimitKey, resetRateLimitSuffixes } = await import('./db/rate-limit');
            await Promise.all([ensureGalleryStorage(), ensureGalleryStorage(), remainingRateLimit('login:test', 2, 1000)]);
            assert(db.query('PRAGMA table_info(face_index_jobs)').all().some(c => c.name === 'source_version'));
            assert(db.query('PRAGMA table_info(gallery_photos)').all().some(c => c.name === 'source_version'));
            assert(db.query('PRAGMA table_info(rate_limits)').all().some(c => c.name === 'rate_key'));
            assert(db.query('PRAGMA table_info(galleries)').all().some(c => c.name === 'face_source_version'));
            assert(db.query('PRAGMA table_info(galleries)').all().some(c => c.name === 'face_source_revision'));
            assert.equal(db.query("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name IN ('face_source_insert', 'face_source_delete', 'face_source_update')").get().n, 3);
            if (${legacy}) {
                assert.deepEqual(db.query('SELECT status, total, processed, source_version FROM face_index_jobs').get(),
                    { status: 'completed', total: 3, processed: 3, source_version: '' });
                assert.equal(await remainingRateLimit('login:test', 2, 1000), 0);
                assert.equal((await hitRateLimit('login:test', 1000, 2, 1000)).allowed, false);
                assert.equal((await hitRateLimit('login:test', 1000, 2, 2000)).count, 1);
            } else {
                assert.equal((await hitRateLimit('login:test', 1000, 2, 1000)).count, 1);
            }
            await resetRateLimitKey('login:test');
            assert.equal(await remainingRateLimit('login:test', 2, 1000), 2);
            await hitRateLimit('gallery_pin:ip:gallery', 1000, 2, 1000);
            await resetRateLimitSuffixes('gallery_pin', ['gallery']);
            assert.equal(await remainingRateLimit('gallery_pin:ip:gallery', 2, 1000), 2);
            await galleryRun("INSERT INTO galleries (id, title, drive_folder_id, pin_hash) VALUES (1, 'test', 'folder', 'hash')");
            await galleryRun("INSERT INTO gallery_photos (gallery_id, drive_file_id, filename, mime_type) VALUES (1, 'photo', 'photo.jpg', 'image/jpeg')");
            await galleryRun("INSERT INTO gallery_selections (gallery_id, selected_drive_file_id, selected_filename) VALUES (1, 'photo', 'photo.jpg')");
            process.env.FACE_WORKER_URL = 'http://worker.test';
            process.env.FACE_WORKER_TOKEN = 'test';
            const { FACE_MODEL_VERSION } = await import('./lib/face-model');
            globalThis.fetch = async () => Response.json({ model: FACE_MODEL_VERSION, capabilities: ['embedding-cache-v1', 'drive-direct-v1'] });
            const { publicFaceSearchStatus } = await import('./routes/face-index');
            const status = await publicFaceSearchStatus(1);
            assert.equal(status.available, true);
            assert.equal(status.status, 'not_indexed');
            await ensureGalleryStorage();
            assert.equal(db.query('SELECT COUNT(*) AS n FROM gallery_selections').get().n, 1);
            assert.equal(db.query('SELECT COUNT(*) AS n FROM gallery_photos').get().n, 1);
            db.close();
        `;
        const child = Bun.spawn([process.execPath, "--no-env-file", "-e", script], {
            cwd: fileURLToPath(new URL("../", import.meta.url)),
            env,
            stdout: "pipe",
            stderr: "pipe",
        });
        const output = await new Response(child.stdout).text();
        const errors = await new Response(child.stderr).text();
        expect({ code: await child.exited, output, errors }).toEqual({ code: 0, output: "", errors: "" });
    });
}
