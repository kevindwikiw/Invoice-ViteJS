import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('Edited/Wedding Selfie enforces delivery access and isolates publication lifecycle from Selection', async () => {
    const env: Record<string, string | undefined> = { ...process.env, DATABASE_DRIVER: 'sqlite', SQLITE_PATH: ':memory:', JWT_SECRET: 'test-edited-selfie-secret', RATE_LIMIT_SQLITE_PATH: ':memory:', FACE_WORKER_URL: 'http://worker.test', FACE_WORKER_TOKEN: 'worker', FACE_WORKER_INTERNAL_TOKEN: 'internal', FACE_WORKER_CALLBACK_ORIGIN: 'http://api.test' };
    for (const key of ['GALLERY_DATABASE_URL', 'GALLERY_AUTH_TOKEN', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'DATABASE_URL', 'SUPABASE_DB_URL']) delete env[key];
    const child = Bun.spawn([process.execPath, '--no-env-file', 'tests/edited-selfie-scenario.ts'], { cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdout: 'pipe', stderr: 'pipe' });
    const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, output, errors }).toEqual({ code: 0, output: '', errors: '' });
}, 30000);
