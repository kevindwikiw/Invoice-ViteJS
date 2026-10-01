import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { Hono } from 'hono';

const drivePhoto = (id: string) => ({ id, name: `${id}.jpg`, mimeType: 'image/jpeg', thumbnailLink: `https://lh3.googleusercontent.com/${id}=s320`, webContentLink: `https://drive.google.com/uc?export=download&id=${id}`, width: 1200, height: 900 });
let edited = [drivePhoto('color'), drivePhoto('bw'), drivePhoto('extra')];
const missing = new Set<string>();
const fetched: Array<{ id: string; width?: number; thumbnail?: string }> = [];
const metadataCalls: string[] = [];
mock.module('../lib/google-drive', () => ({
    getReadonlyDriveToken: async () => ({ accessToken: 'test', expiresAt: Date.now() + 1000 }),
    listDrivePhotos: async () => edited,
    hasAnyoneViewerFolderAccess: async () => true,
    getDrivePhotoMetadata: async (id: string) => { metadataCalls.push(id); if (missing.has(id)) throw new Error('missing'); return drivePhoto(id); },
    fetchDriveFile: async (id: string, thumbnail?: string, width?: number) => { assert.ok(thumbnail); fetched.push({ id, width, thumbnail }); if (missing.has(id)) throw new Error('missing'); return new Response('image', { headers: { 'content-type': 'image/jpeg' } }); },
}));
const { sqlite } = await import('../db/runtime');
sqlite!.exec('CREATE TABLE user_permissions (user_id INTEGER, permission_key TEXT, effect TEXT)');
// A real legacy snapshot table must be upgraded, not recreated.
sqlite!.exec('CREATE TABLE gallery_edit_result_photos (gallery_id INTEGER NOT NULL, drive_file_id TEXT NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL, thumbnail_url TEXT, web_content_link TEXT NOT NULL, resource_key TEXT, width INTEGER, height INTEGER, display_order INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (gallery_id, drive_file_id))');
const { galleryRun: run, galleryOne: one, galleryAll: all, ensureGalleryStorage } = await import('../db/galleries');
const { parseComparisonPairs, validComparisonPairs, readBeforePhoto } = await import('../lib/edit-result-pairs');
const { adminGalleriesRouter, publicGalleriesRouter } = await import('../routes/galleries');
await ensureGalleryStorage();
assert.ok((await all<{ name: string }>('PRAGMA table_info(gallery_edit_result_photos)')).some((c) => c.name === 'before_photo'));
await ensureGalleryStorage();
assert.throws(() => parseComparisonPairs({}));
assert.throws(() => parseComparisonPairs([{ editedDriveFileId: 'x', beforeDriveFileId: 'b' }, { editedDriveFileId: 'x', beforeDriveFileId: 'c' }]));
assert.throws(() => parseComparisonPairs([{ editedDriveFileId: 'https://evil.test', beforeDriveFileId: 'b' }]));
assert.equal(readBeforePhoto('bad-json'), null);
await run("INSERT INTO galleries (id, title, public_key, drive_folder_id, edit_results_folder_id, pin_hash, status) VALUES (1, 'Gallery', 'gallery', 'source', 'edited', 'hash', 'closed')");
await run("INSERT INTO galleries (id, title, public_key, drive_folder_id, pin_hash) VALUES (2, 'Other', 'other', 'other-source', 'hash')");
for (const [file, order] of [['before-a', 1], ['before-b', 0], ['unsubmitted', 2]] as const) {
    await run('INSERT INTO gallery_photos (gallery_id, drive_file_id, filename, mime_type, display_order) VALUES (1, ?, ?, ?, ?)', [file, `${file}.jpg`, 'image/jpeg', order]);
}
await run("INSERT INTO gallery_selections (gallery_id, selected_drive_file_id, selected_filename) VALUES (1, 'before-a', 'before-a.jpg'), (1, 'before-b', 'before-b.jpg')");
const app = new Hono<any>();
app.use('/admin/*', async (c, next) => { if (c.req.header('x-test-admin')) c.set('user', { sub: 1, role: 'superadmin', email: 'test@example.invalid', name: 'Admin' }); await next(); });
app.route('/admin', adminGalleriesRouter);
app.route('/public', publicGalleriesRouter);
const request = (path: string, method = 'GET', body?: unknown, authenticated = true) => app.request(path, { method, headers: { 'content-type': 'application/json', ...(authenticated ? { 'x-test-admin': '1' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
type Payload = { submitted: Array<{ driveFileId: string }>; edited: unknown[]; comparisonEnabled: boolean; comparisonCount: number; token: string; warnings: string[]; photos: Array<{ comparison: { previewUrl: string } | null }> };
const json = async (response: Response) => await response.json() as Payload;
assert.equal((await request('/admin/1/edit-results/pairing', 'GET', undefined, false)).status, 401);
const candidates = await json(await request('/admin/1/edit-results/pairing'));
assert.deepEqual(candidates.submitted.map((p: any) => p.driveFileId), ['before-b', 'before-a']);
assert.equal(candidates.edited.length, 3);
assert.equal(candidates.comparisonEnabled, false);
assert.equal((await request('/admin/2/edit-results/pairing/before/before-a/thumbnail')).status, 404);
assert.equal((await request('/admin/1', 'PATCH', { comparisonEnabled: 'true' })).status, 400);
assert.equal((await request('/admin/1', 'PATCH', { comparisonPairs: [{ editedDriveFileId: 'color', beforeDriveFileId: 'unsubmitted' }] })).status, 400);
const pairs = [{ editedDriveFileId: 'color', beforeDriveFileId: 'before-a' }, { editedDriveFileId: 'bw', beforeDriveFileId: 'before-a' }];
assert.equal(validComparisonPairs(pairs, new Set(['color', 'bw']), new Set(['before-a'])).length, 2);
assert.equal((await request('/admin/1', 'PATCH', { comparisonEnabled: true, comparisonPairs: pairs })).status, 200);
assert.equal((await one<{ n: number }>('SELECT COUNT(*) as n FROM gallery_edit_result_photos'))!.n, 0);
const publish = await request('/admin/1/edit-results/publish', 'POST', { password: 'delivery-pass' });
assert.equal(publish.status, 201, await publish.clone().text());
assert.equal((await json(publish)).comparisonCount, 2);
assert.deepEqual(metadataCalls, ['before-a']);
const login = async () => (await json(await request('/public/gallery/edit-results/verify', 'POST', { password: 'delivery-pass' }))).token;
let token = await login();
const listing = () => request(`/public/gallery/edit-results?token=${token}`);
assert.equal((await request('/public/gallery/edit-results?token=bad')).status, 401);
const list = await json(await listing());
assert.equal(list.photos.length, 3);
assert.equal(list.photos[2]!.comparison, null);
assert.ok(list.photos[0]!.comparison!.previewUrl.includes('/color/before/preview'));
assert.equal(JSON.stringify(list).includes('before-a'), false);
const beforePath = `/public/gallery/edit-results/photos/color/before/preview?token=${token}`;
assert.equal((await request(beforePath)).status, 200);
assert.equal(fetched.at(-1)!.width, 1600);
assert.equal(fetched.at(-1)!.id, 'before-a');
assert.equal((await request(`/public/gallery/edit-results/photos/color/before/thumbnail?token=${token}`)).status, 200);
assert.equal(fetched.at(-1)!.width, 320);
assert.equal((await request(`/public/gallery/edit-results/photos/unsubmitted/before/preview?token=${token}`)).status, 404);
assert.equal((await request('/public/gallery/edit-results/photos/color/before/preview?token=bad')).status, 401);
// Change drafts and selections without changing the published comparison.
await request('/admin/1', 'PATCH', { comparisonPairs: [] });
await run('DELETE FROM gallery_selections WHERE gallery_id = 1');
assert.equal((await request(beforePath)).status, 200);
await request('/admin/1/edit-results/publish', 'POST', { password: 'delivery-pass' });
assert.equal((await request(beforePath)).status, 401);
token = await login();
assert.equal((await json(await listing())).photos[0]!.comparison, null);
await run("INSERT INTO gallery_selections (gallery_id, selected_drive_file_id, selected_filename) VALUES (1, 'before-a', 'before-a.jpg')");
await request('/admin/1', 'PATCH', { comparisonPairs: pairs });
missing.add('before-a');
const omitted = await json(await request('/admin/1/edit-results/publish', 'POST', { password: 'delivery-pass' }));
assert.equal(omitted.comparisonCount, 0);
assert.equal(omitted.warnings.length, 1);
missing.clear();
edited = [drivePhoto('bw'), drivePhoto('color')];
await request('/admin/1/edit-results/publish', 'POST', { password: 'delivery-pass' });
token = await login();
assert.ok((await json(await listing())).photos.every((p) => p.comparison));
// Gallery tokens must not grant edited access, even when signed by the same key.
const { createHmac } = await import('node:crypto');
const payload = Buffer.from(JSON.stringify({ gid: 1, av: 1, exp: Math.floor(Date.now() / 1000) + 1000 })).toString('base64url');
const signature = createHmac('sha256', process.env.JWT_SECRET!).update(payload).digest('base64url');
assert.equal((await request(`/public/gallery/edit-results?token=${payload}.${signature}`)).status, 401);
const editedClaims = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString());
for (const claims of [{ ...editedClaims, exp: 1 }, { ...editedClaims, gid: 2 }]) {
    const invalidPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const validSignature = createHmac('sha256', process.env.JWT_SECRET!).update(invalidPayload).digest('base64url');
    assert.equal((await request(`/public/gallery/edit-results/photos/color/before/preview?token=${invalidPayload}.${validSignature}`)).status, 401);
}
await request('/admin/1/edit-results/unpublish', 'POST');
assert.equal((await listing()).status, 404);
assert.equal((await one<{ n: number }>('SELECT COUNT(*) as n FROM gallery_edit_result_photos'))!.n, 0);
sqlite!.close();
