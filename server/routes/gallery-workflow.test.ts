import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('gallery workflows isolate Wedding delivery and preserve legacy selection', async () => {
    const env: Record<string, string | undefined> = { ...process.env, DATABASE_DRIVER: 'sqlite', SQLITE_PATH: ':memory:', JWT_SECRET: 'test-workflow-secret', RATE_LIMIT_SQLITE_PATH: ':memory:' };
    for (const key of ['GALLERY_DATABASE_URL', 'GALLERY_AUTH_TOKEN', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'DATABASE_URL', 'SUPABASE_DB_URL', 'FACE_WORKER_URL', 'FACE_WORKER_TOKEN', 'FACE_WORKER_INTERNAL_TOKEN']) delete env[key];
    const child = Bun.spawn([process.execPath, '--no-env-file', 'tests/gallery-workflow-scenario.ts'], { cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdout: 'pipe', stderr: 'pipe' });
    const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, output, errors }).toEqual({ code: 0, output: '', errors: '' });
}, 30000);
