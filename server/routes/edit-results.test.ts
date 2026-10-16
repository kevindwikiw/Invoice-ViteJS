import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

for (const archiveConfigured of [true, false]) test(`edited lifecycle and independent archive configuration (archive=${archiveConfigured})`, async () => {
    const env: Record<string, string | undefined> = { ...process.env, DATABASE_DRIVER: 'sqlite', SQLITE_PATH: ':memory:', JWT_SECRET: 'test-only-secret', RATE_LIMIT_SQLITE_PATH: ':memory:' };
    for (const key of ['GALLERY_DATABASE_URL', 'GALLERY_AUTH_TOKEN', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'DATABASE_URL', 'SUPABASE_DB_URL', 'FACE_WORKER_URL', 'FACE_WORKER_TOKEN', 'FACE_WORKER_INTERNAL_TOKEN']) delete env[key];
    Object.assign(env, { FACE_WORKER_URL: 'https://worker.example.test', FACE_WORKER_TOKEN: 'worker-test-token', FACE_WORKER_INTERNAL_TOKEN: 'worker-internal-test-token', FACE_WORKER_CALLBACK_ORIGIN: 'https://api.example.test', FACE_ARCHIVE_WORKER_URL: 'https://archive-private.example.test', FACE_ARCHIVE_WORKER_PUBLIC_URL: 'https://archive.example.test', FACE_ARCHIVE_WORKER_TOKEN: 'archive-test-token' });
    if (!archiveConfigured) delete env.FACE_ARCHIVE_WORKER_URL;
    const child = Bun.spawn([process.execPath, '--no-env-file', 'tests/edit-results-scenario.ts'], { cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(child.stdout).text();
    const errors = await new Response(child.stderr).text();
    expect({ code: await child.exited, output, errors }).toEqual({ code: 0, output: '', errors: '' });
}, 30000);
