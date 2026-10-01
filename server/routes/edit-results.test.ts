import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('edited comparison lifecycle, membership, snapshot isolation and auth', async () => {
    const env: Record<string, string | undefined> = { ...process.env, DATABASE_DRIVER: 'sqlite', SQLITE_PATH: ':memory:', JWT_SECRET: 'test-only-secret', RATE_LIMIT_SQLITE_PATH: ':memory:' };
    for (const key of ['GALLERY_DATABASE_URL', 'GALLERY_AUTH_TOKEN', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'DATABASE_URL', 'SUPABASE_DB_URL']) delete env[key];
    const child = Bun.spawn([process.execPath, '--no-env-file', 'tests/edit-results-scenario.ts'], { cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdout: 'pipe', stderr: 'pipe' });
    const output = await new Response(child.stdout).text();
    const errors = await new Response(child.stderr).text();
    expect({ code: await child.exited, output, errors }).toEqual({ code: 0, output: '', errors: '' });
}, 30000);
