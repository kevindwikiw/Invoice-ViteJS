import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { Hono } from 'hono';

const drivePhoto = (id: string) => ({ id, name: `${id}.jpg`, mimeType: 'image/jpeg', thumbnailLink: `https://lh3.googleusercontent.com/${id}=s320`, webContentLink: `https://drive.google.com/uc?export=download&id=${id}`, width: 1200, height: 900 });
let edited = [drivePhoto('color'), drivePhoto('bw'), drivePhoto('extra')];
let folderSnapshot: Array<{ id: string; parentId: string | null; name: string }> = [];
let treeFails = false;
const missing = new Set<string>();
const fetched: Array<{ id: string; width?: number; thumbnail?: string }> = [];
const metadataCalls: string[] = [];
mock.module('../lib/google-drive', () => ({
    getReadonlyDriveToken: async () => ({ accessToken: 'test', expiresAt: Date.now() + 1000 }),
    listDrivePhotos: async () => edited,
    listDrivePhotoTree: async () => {
        if (treeFails) throw new Error('Folder unavailable');
        return { folders: folderSnapshot, photos: edited.map((photo) => ({ ...photo, folderId: folderSnapshot.length && photo.id === 'bw' ? 'no-watermark' : null })) };
    },
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
assert.equal((list.photos[0] as any).driveFileId, 'color');
assert.equal((list.photos[0] as any).downloadUrl, drivePhoto('color').webContentLink);
assert.equal((await request(`/public/gallery/edit-results/photos/color/thumbnail?token=${token}`)).status, 200);
assert.equal((await request(`/public/gallery/edit-results/photos/color/preview?token=${token}`)).status, 200);
assert.equal((await request(`/public/gallery/edit-results/photos/undefined/thumbnail?token=${token}`)).status, 404);
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
folderSnapshot = [{ id: 'no-watermark', parentId: null, name: 'No Watermark' }, { id: 'empty', parentId: 'no-watermark', name: 'Empty' }];
assert.equal((await request('/admin/1/edit-results/publish', 'POST', { password: 'delivery-pass' })).status, 201);
assert.equal((await listing()).status, 401);
token = await login();
const nested = await (await listing()).json() as any;
assert.deepEqual(nested.folders, [...folderSnapshot].sort((a, b) => a.name.localeCompare(b.name)));
assert.equal(nested.photos.find((photo: any) => photo.driveFileId === 'bw').folderId, 'no-watermark');
assert.equal(nested.photos.find((photo: any) => photo.driveFileId === 'color').folderId, null);
treeFails = true;
const previousError = console.error;
console.error = () => {};
try {
    assert.equal((await request('/admin/1/edit-results/publish', 'POST', { password: 'delivery-pass' })).status, 502);
} finally { console.error = previousError; }
const afterFailure = await (await listing()).json() as any;
assert.deepEqual(afterFailure.photos, nested.photos);
assert.deepEqual(afterFailure.folders, nested.folders);
assert.equal(afterFailure.publishedAt, nested.publishedAt);
treeFails = false;
// Edited access changes preserve the snapshot and never rotate selection access.
const selectionBefore = await one('SELECT status, access_version, selection_deadline_at, pin_hash FROM galleries WHERE id = 1');
const snapshotBefore = await all('SELECT * FROM gallery_edit_result_photos WHERE gallery_id = 1');
assert.equal((await request('/admin/2', 'PATCH', { editResultsStatus: 'open' })).status, 400);
assert.equal((await request('/admin/1', 'PATCH', { editResultsStatus: 'invalid' })).status, 400);
for (const status of ['closed', 'draft']) {
    assert.equal((await request('/admin/1', 'PATCH', { editResultsStatus: status })).status, 200);
    assert.equal((await listing()).status, 403);
    assert.equal((await request('/public/gallery/edit-results/verify', 'POST', { password: 'delivery-pass' })).status, 403);
    for (const variant of ['thumbnail', 'preview', 'before/thumbnail', 'before/preview']) {
        assert.equal((await request(`/public/gallery/edit-results/photos/color/${variant}?token=${token}`)).status, 403);
    }
    const availability = await (await request('/public/gallery/edit-results/status')).json() as any;
    assert.equal(availability.available, false);
    assert.equal(availability.status, status);
}
assert.deepEqual(await all('SELECT * FROM gallery_edit_result_photos WHERE gallery_id = 1'), snapshotBefore);
assert.deepEqual(await one('SELECT status, access_version, selection_deadline_at, pin_hash FROM galleries WHERE id = 1'), selectionBefore);
await run("UPDATE galleries SET edit_results_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = 1");
assert.equal((await request('/admin/1', 'PATCH', { editResultsStatus: 'open', editResultsAccessDurationHours: 24 })).status, 200);
assert.equal((await listing()).status, 401);
token = await login();
assert.equal((await listing()).status, 200);
const reopened = await one<any>('SELECT edit_results_expires_at, edit_results_version FROM galleries WHERE id = 1');
assert.ok(Math.abs(Date.parse(reopened.edit_results_expires_at) - Date.now() - 86_400_000) < 5000);
await request('/admin/1', 'PATCH', { editResultsStatus: 'open' });
assert.deepEqual(await one('SELECT edit_results_expires_at, edit_results_version FROM galleries WHERE id = 1'), reopened);
const detail = await (await request('/admin/1')).json() as any;
assert.equal(detail.gallery.editResultsAccessDurationHours, 24);
assert.equal(detail.gallery.editResultsExpiresAt, reopened.edit_results_expires_at);
assert.equal(detail.gallery.editResultsStatus, 'open');
assert.equal(detail.gallery.status, 'closed');
let filtered = await (await request('/admin?mode=edited&status=open')).json() as any;
assert.equal(filtered.total, 1);
filtered = await (await request('/admin?mode=selection&status=open')).json() as any;
assert.equal(filtered.total, 0);
await run("UPDATE galleries SET edit_results_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = 1");
assert.equal((await listing()).status, 403);
filtered = await (await request('/admin?mode=edited&status=closed')).json() as any;
assert.equal(filtered.total, 1);
assert.equal(filtered.items[0].editResultsIsExpired, true);
await request('/admin/1', 'PATCH', { editResultsStatus: 'open', editResultsAccessDurationHours: null });
token = await login();
assert.equal((await one<any>('SELECT edit_results_expires_at FROM galleries WHERE id = 1')).edit_results_expires_at, null);
await request('/admin/1', 'PATCH', { title: 'Renamed selection' });
assert.equal((await one<any>('SELECT edit_results_access_duration_hours FROM galleries WHERE id = 1')).edit_results_access_duration_hours, null);
assert.equal((await listing()).status, 200);
// Selection can remain open while edited delivery is closed.
await request('/admin/1', 'PATCH', { status: 'open', selectionDurationHours: 72 });
const selectionOpen = await one('SELECT status, access_version, selection_deadline_at FROM galleries WHERE id = 1');
await request('/admin/1', 'PATCH', { editResultsStatus: 'closed' });
assert.deepEqual(await one('SELECT status, access_version, selection_deadline_at FROM galleries WHERE id = 1'), selectionOpen);
assert.equal((await one<any>('SELECT status FROM galleries WHERE id = 1')).status, 'open');
assert.equal((await listing()).status, 403);
await request('/admin/1/edit-results/unpublish', 'POST');
assert.equal((await listing()).status, 404);
assert.equal((await one<{ n: number }>('SELECT COUNT(*) as n FROM gallery_edit_result_photos'))!.n, 0);
assert.equal((await one<{ n: number }>('SELECT COUNT(*) as n FROM gallery_edit_result_folders'))!.n, 0);
assert.equal((await one<any>('SELECT edit_results_status FROM galleries WHERE id = 1')).edit_results_status, 'draft');
sqlite!.close();
