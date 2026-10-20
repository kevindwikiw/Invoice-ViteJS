import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { Hono } from 'hono';

const drivePhoto = (id: string) => ({ id, name: `${id}.jpg`, mimeType: 'image/jpeg', thumbnailLink: `https://lh3.googleusercontent.com/${id}=s320`, webContentLink: `https://drive.google.com/uc?export=download&id=${id}`, width: 1200, height: 900, size: '1200' });
let edited = [drivePhoto('color'), drivePhoto('bw'), drivePhoto('extra')];
let folderSnapshot: Array<{ id: string; parentId: string | null; name: string }> = [];
let treeFails = false;
const missing = new Set<string>();
const restricted = new Set<string>();
const fetched: Array<{ id: string; width?: number; thumbnail?: string }> = [];
const metadataCalls: string[] = [];
mock.module('../lib/google-drive', () => ({
    getReadonlyDriveToken: async () => ({ accessToken: 'test', expiresAt: Date.now() + 1000 }),
    listDrivePhotos: async () => edited,
    listDrivePhotoTree: async () => {
        if (treeFails) throw new Error('Folder unavailable');
        return { rootName: 'Edited Source', folders: folderSnapshot, photos: edited.map((photo) => ({ ...photo, folderId: folderSnapshot.length ? photo.id === 'nested-photo' ? 'empty' : photo.id === 'bw' ? 'no-watermark' : null : null })) };
    },
    hasAnyoneViewerFolderAccess: async () => true,
    getDrivePhotoMetadata: async (id: string) => { metadataCalls.push(id); if (missing.has(id)) throw new Error('missing'); if (restricted.has(id)) return { ...drivePhoto(id), canDownload: false }; return id === 'archive' ? { ...drivePhoto(id), name: 'backup.zip', mimeType: 'application/zip', canDownload: true } : drivePhoto(id); },
    fetchDriveFile: async (id: string, thumbnail?: string, width?: number) => { assert.ok(thumbnail); fetched.push({ id, width, thumbnail }); if (missing.has(id)) throw new Error('missing'); return new Response('image', { headers: { 'content-type': 'image/jpeg' } }); },
    fetchDriveVideo: async () => new Response('video', { headers: { 'content-type': 'video/mp4' } }),
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
assert.equal(readBeforePhoto(JSON.stringify({ driveFileId: 'before-a', mimeType: 'image/jpeg' })), null);
assert.equal(readBeforePhoto(JSON.stringify({ driveFileId: 'before-a', filename: 'before-a.jpg', mimeType: 'image/jpeg', thumbnailUrl: null, width: '1200', height: 900 })), null);
assert.deepEqual(readBeforePhoto(JSON.stringify({ driveFileId: 'before-a', filename: 'before-a.jpg', mimeType: 'image/jpeg', thumbnailUrl: null, width: 1200, height: 900 })), { driveFileId: 'before-a', filename: 'before-a.jpg', mimeType: 'image/jpeg', thumbnailUrl: null, width: 1200, height: 900 });
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
let workerArchivePayload: any = null;
let workerPrebuildPayload: any = null;
const workerSnapshotUpdates: Array<{ galleryId: number; snapshotVersion: string | null }> = [];
let archiveWorkerOffline = false;
let workerArchiveErrorCode: string | null = null;
let workerArchiveSnapshotStale = false;
const workerArchiveJobId = 'a'.repeat(32);
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (new URL(url).pathname.startsWith('/v1/archive/')) {
        assert.equal(new URL(url).origin, 'https://archive-private.example.test');
        assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer archive-test-token');
        if (archiveWorkerOffline) return Response.json({ error: 'offline' }, { status: 503 });
    }
    if (new URL(url).pathname.endsWith('/snapshot') && init?.method === 'PUT') {
        const match = new URL(url).pathname.match(/\/galleries\/(\d+)\/snapshot$/)!;
        workerSnapshotUpdates.push({ galleryId: Number(match[1]), snapshotVersion: JSON.parse(String(init.body)).snapshotVersion });
        return Response.json({ ok: true, revokedJobs: 0 });
    }
    if (new URL(url).pathname === '/v1/archive/capacity') return Response.json({ availableBytes: 2_000_000_000, diskFreeBytes: 2_100_000_000, cacheUsedBytes: 100_000_000, reservedBytes: 0 });
    if (url.endsWith('/v1/archive/jobs') && init?.method === 'POST') {
        workerArchivePayload = JSON.parse(String(init.body));
        return Response.json({ jobId: workerArchiveJobId, status: 'queued' }, { status: 202 });
    }
    if (url.endsWith('/v1/archive/prebuild') && init?.method === 'POST') {
        workerPrebuildPayload = JSON.parse(String(init.body));
        return Response.json({ jobs: workerPrebuildPayload.jobs.map(() => ({ jobId: workerArchiveJobId, status: 'queued' })) }, { status: 202 });
    }
    if (new URL(url).pathname === '/v1/archive/prebuild/galleries/1') {
        return Response.json({ jobs: (workerPrebuildPayload?.jobs || []).map((job: any) => ({ folderId: job.folderId, scope: job.scope, status: 'completed', processed: job.photos.length, total: job.photos.length })) });
    }
    if (url.endsWith(`/v1/archive/jobs/${workerArchiveJobId}`)) {
        if (workerArchiveErrorCode) return Response.json({ galleryId: 1, status: 'failed', processed: 0, total: 1, errorCode: workerArchiveErrorCode });
        return Response.json({ galleryId: 1, folderId: 'no-watermark', snapshotVersion: workerArchiveSnapshotStale ? 'stale' : workerArchivePayload?.snapshotVersion, status: 'completed', processed: 1, total: 1, filename: 'No Watermark.zip', downloadTicket: 'opaque-ticket', expiresAt: Date.now() / 1000 + 3600 });
    }
    if (url.endsWith('/readyz')) return Response.json({ code: 'worker_not_ready' }, { status: 503 });
    return Response.json({ error: 'not_found' }, { status: 404 });
}) as typeof fetch;
type Archive = { filename: string; downloadUrl: string; downloadResolveUrl: string };
type Payload = { archive: Archive | null; code?: string; downloadUrl?: string; filename?: string; rootFolderName?: string; submitted: Array<{ driveFileId: string }>; edited: Array<{ driveFileId: string; thumbnailUrl: string }>; comparisonEnabled: boolean; comparisonCount: number; token: string; warnings: string[]; photos: Array<{ driveFileId?: string; downloadResolveUrl?: string; comparison: { previewUrl: string } | null }> };
const json = async (response: Response) => await response.json() as Payload;
assert.equal((await request('/admin/1/edit-results/pairing', 'GET', undefined, false)).status, 401);
const candidates = await json(await request('/admin/1/edit-results/pairing'));
assert.deepEqual(candidates.submitted.map((p: any) => p.driveFileId), ['before-b', 'before-a']);
assert.equal(candidates.edited.length, 3);
assert.equal(candidates.edited[0]!.thumbnailUrl, '/api/galleries/1/edit-results/pairing/edited/color/thumbnail');
assert.equal((await request('/admin/1/edit-results/pairing/edited/color/thumbnail')).status, 200);
assert.equal((await request('/admin/1/edit-results/pairing/edited/not-in-folder/thumbnail')).status, 404);
assert.equal(candidates.comparisonEnabled, false);
assert.equal((await request('/admin/2/edit-results/pairing/before/before-a/thumbnail')).status, 404);
assert.equal((await request('/admin/1', 'PATCH', { comparisonEnabled: 'true' })).status, 400);
assert.equal((await request('/admin/1', 'PATCH', { comparisonPairs: [{ editedDriveFileId: 'color', beforeDriveFileId: 'unsubmitted' }] })).status, 400);
const pairs = [{ editedDriveFileId: 'color', beforeDriveFileId: 'before-a' }, { editedDriveFileId: 'bw', beforeDriveFileId: 'before-a' }];
assert.equal(validComparisonPairs(pairs, new Set(['color', 'bw']), new Set(['before-a'])).length, 2);
assert.equal((await request('/admin/1', 'PATCH', { comparisonEnabled: true, comparisonPairs: pairs })).status, 200);
assert.equal((await one<{ n: number }>('SELECT COUNT(*) as n FROM gallery_edit_result_photos'))!.n, 0);
const publish = await request('/admin/1/edit-results/publish', 'POST', { password: 'edit' });
assert.equal(publish.status, 201, await publish.clone().text());
assert.equal((await json(publish)).comparisonCount, 2);
assert.deepEqual(metadataCalls, ['before-a']);
assert.equal((await request('/admin/1/edit-results/password', 'POST', { password: 'next' }, false)).status, 401);
const tokenBeforePasswordChange = (await json(await request('/public/gallery/edit-results/verify', 'POST', { password: 'edit' }))).token;
const snapshotUpdatesBeforePasswordChange = workerSnapshotUpdates.length;
const publishedAtBeforePasswordChange = (await one<{ publishedAt: string }>('SELECT edit_results_published_at as "publishedAt" FROM galleries WHERE id = 1'))!.publishedAt;
archiveWorkerOffline = true;
assert.equal((await request('/admin/1/edit-results/password', 'POST', { password: 'next' })).status, 200);
assert.equal(workerSnapshotUpdates.length, snapshotUpdatesBeforePasswordChange);
assert.equal((await one<{ publishedAt: string }>('SELECT edit_results_published_at as "publishedAt" FROM galleries WHERE id = 1'))!.publishedAt, publishedAtBeforePasswordChange);
assert.equal((await request('/public/gallery/edit-results/verify', 'POST', { password: 'edit' })).status, 401);
assert.equal((await request(`/public/gallery/edit-results?token=${tokenBeforePasswordChange}`)).status, 401);
assert.equal((await request('/public/gallery/edit-results/verify', 'POST', { password: 'next' })).status, 200);
assert.equal((await request('/admin/1/edit-results/password', 'POST', { password: 'edit' })).status, 200);
archiveWorkerOffline = false;
const login = async () => (await json(await request('/public/gallery/edit-results/verify', 'POST', { password: 'edit' }))).token;
let token = await login();
const listing = () => request(`/public/gallery/edit-results?token=${token}`);
assert.equal((await request('/public/gallery/edit-results?token=bad')).status, 401);
const list = await json(await listing());
assert.equal(list.rootFolderName, 'Edited Source');
assert.equal((await json(await request('/public/gallery/edit-results?token=bad'))).archive, undefined);
assert.equal((await json(await request('/public/gallery/edit-results?token=bad'))).code, 'EDIT_RESULTS_TOKEN_INVALID');
assert.equal(list.archive, null);
assert.equal(list.photos.length, 3);
assert.equal(list.photos[2]!.comparison, null);
assert.ok(list.photos[0]!.comparison!.previewUrl.includes('/color/before/preview'));
assert.equal((list.photos[0] as any).driveFileId, 'color');
assert.equal((list.photos[0] as any).downloadUrl, drivePhoto('color').webContentLink);
assert.ok((list.photos[0] as any).downloadResolveUrl.includes('/photos/color/download-url?token='));
const resolvedPhoto = await json(await request(`/public/gallery/edit-results/photos/color/download-url?token=${token}`));
assert.equal(resolvedPhoto.downloadUrl, drivePhoto('color').webContentLink);
assert.equal(resolvedPhoto.filename, 'color.jpg');
assert.equal((await request(`/public/gallery/edit-results/photos/not-published/download-url?token=${token}`)).status, 404);
assert.equal((await json(await request(`/public/gallery/edit-results/photos/not-published/download-url?token=${token}`))).code, 'EDIT_RESULT_NOT_FOUND');
missing.add('color');
const previousWarn = console.warn;
console.warn = () => {};
try { assert.equal((await request(`/public/gallery/edit-results/photos/color/download-url?token=${token}`)).status, 502); }
finally { console.warn = previousWarn; }
missing.delete('color');
restricted.add('color');
const restrictedPhoto = await request(`/public/gallery/edit-results/photos/color/download-url?token=${token}`);
assert.equal(restrictedPhoto.status, 502);
assert.equal((await json(restrictedPhoto)).code, 'DRIVE_DOWNLOAD_UNAVAILABLE');
restricted.delete('color');
assert.equal((await json(await request('/public/gallery/edit-results/photos/color/download-url?token=bad'))).code, 'EDIT_RESULTS_TOKEN_INVALID');

// Publish a ZIP snapshot. Later draft changes must not affect its resolver.
await request('/admin/1', 'PATCH', { editResultsZipFileId: 'archive' });
assert.equal((await request('/admin/1/edit-results/publish', 'POST', { password: 'edit' })).status, 201);
assert.equal((await listing()).status, 401);
token = await login();
const withArchive = await json(await listing());
assert.ok(withArchive.archive?.downloadResolveUrl.includes('/archive/download-url?token='));
const resolvedArchive = await json(await request(`/public/gallery/edit-results/archive/download-url?token=${token}`));
assert.equal(resolvedArchive.downloadUrl, drivePhoto('archive').webContentLink);
assert.equal(resolvedArchive.filename, 'backup.zip');
await request('/admin/1', 'PATCH', { editResultsZipFileId: 'not-a-zip' });
assert.equal((await json(await request(`/public/gallery/edit-results/archive/download-url?token=${token}`))).downloadUrl, drivePhoto('archive').webContentLink);
await run('UPDATE galleries SET edit_results_published_zip_file_id = NULL WHERE id = 1');
assert.equal((await json(await request(`/public/gallery/edit-results/archive/download-url?token=${token}`))).downloadUrl, drivePhoto('archive').webContentLink);
await run("UPDATE galleries SET edit_results_published_zip_file_id = 'archive' WHERE id = 1");
await request('/admin/1', 'PATCH', { editResultsZipFileId: 'archive' });
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
// Saving comparison pairs updates the active snapshot without rotating Edited access.
const clearedComparisons = await json(await request('/admin/1', 'PATCH', { comparisonPairs: [] }));
assert.equal(clearedComparisons.comparisonCount, 0);
assert.equal((await request(beforePath)).status, 404);
await run('DELETE FROM gallery_selections WHERE gallery_id = 1');
await request('/admin/1/edit-results/publish', 'POST', { password: 'edit' });
assert.equal((await request(beforePath)).status, 401);
token = await login();
assert.equal((await json(await listing())).photos[0]!.comparison, null);
await run("INSERT INTO gallery_selections (gallery_id, selected_drive_file_id, selected_filename) VALUES (1, 'before-a', 'before-a.jpg')");
await request('/admin/1', 'PATCH', { comparisonPairs: pairs });
missing.add('before-a');
const omitted = await json(await request('/admin/1/edit-results/publish', 'POST', { password: 'edit' }));
assert.equal(omitted.comparisonCount, 0);
assert.equal(omitted.warnings.length, 1);
missing.clear();
edited = [drivePhoto('bw'), drivePhoto('color')];
await request('/admin/1/edit-results/publish', 'POST', { password: 'edit' });
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
edited.push(drivePhoto('nested-photo'));
const nestedCandidates = await json(await request('/admin/1/edit-results/pairing'));
assert.deepEqual(nestedCandidates.edited.map((photo) => photo.driveFileId), ['color']);
assert.equal((await request('/admin/1/edit-results/pairing/edited/bw/thumbnail')).status, 404);
const nestedPairResponse = await request('/admin/1', 'PATCH', { comparisonPairs: [{ editedDriveFileId: 'bw', beforeDriveFileId: 'before-a' }] });
assert.equal(nestedPairResponse.status, 400);
assert.match((await nestedPairResponse.json() as any).error, /root folder/);
const nestedPublish = await request('/admin/1/edit-results/publish', 'POST', { password: 'edit' });
assert.equal(nestedPublish.status, 201);
assert.equal((await json(nestedPublish)).comparisonCount, 1);
if (process.env.FACE_ARCHIVE_WORKER_URL) {
    assert.equal(workerPrebuildPayload.jobs.length, 3);
    assert.deepEqual(workerPrebuildPayload.jobs.map((job: any) => [job.folderId, job.scope]), [
        ['__all__', 'direct'], ['empty', 'direct'], ['no-watermark', 'direct'],
    ]);
    const prebuildStatus = await json(await request('/admin/1/edit-results/archive/status'));
    assert.equal((prebuildStatus as any).ready, true);
    assert.equal((prebuildStatus as any).completed, 3);
    assert.equal((await request('/admin/1/edit-results/archive/status', 'GET', undefined, false)).status, 401);
    assert.equal((await request('/admin/1/edit-results/archive/rebuild', 'POST')).status, 202);
}
assert.equal((await listing()).status, 401);
token = await login();
const nested = await (await listing()).json() as any;
assert.deepEqual(nested.folders, [...folderSnapshot].sort((a, b) => a.name.localeCompare(b.name)));
assert.equal(nested.photos.find((photo: any) => photo.driveFileId === 'bw').folderId, 'no-watermark');
assert.equal(nested.photos.find((photo: any) => photo.driveFileId === 'bw').comparison, null);
assert.equal(nested.photos.find((photo: any) => photo.driveFileId === 'color').folderId, null);
const archiveStart = await request(`/public/gallery/edit-results/folders/no-watermark/archive/jobs?token=${token}`, 'POST');
if (process.env.FACE_ARCHIVE_WORKER_URL) {
    assert.equal(archiveStart.status, 202, await archiveStart.clone().text());
    assert.deepEqual(workerArchivePayload.photos, [
        { driveFileId: 'bw', filename: 'bw.jpg', archivePath: 'No Watermark/bw.jpg' },
        { driveFileId: 'nested-photo', filename: 'nested-photo.jpg', archivePath: 'No Watermark/Empty/nested-photo.jpg' },
    ]);
    assert.equal(workerArchivePayload.scope, 'subtree');
    const directArchiveStart = await request(`/public/gallery/edit-results/folders/no-watermark/archive/jobs?token=${token}&scope=direct`, 'POST');
    assert.equal(directArchiveStart.status, 202, await directArchiveStart.clone().text());
    assert.equal(workerArchivePayload.scope, 'direct');
    assert.equal(workerArchivePayload.folderName, 'No Watermark');
    assert.deepEqual(workerArchivePayload.photos, [
        { driveFileId: 'bw', filename: 'bw.jpg', archivePath: 'bw.jpg' },
    ]);
    const nestedDirectStart = await request(`/public/gallery/edit-results/folders/empty/archive/jobs?token=${token}&scope=direct`, 'POST');
    assert.equal(nestedDirectStart.status, 202, await nestedDirectStart.clone().text());
    assert.deepEqual(workerArchivePayload.photos, [
        { driveFileId: 'nested-photo', filename: 'nested-photo.jpg', archivePath: 'nested-photo.jpg' },
    ]);
    const galleryArchiveStart = await request(`/public/gallery/edit-results/archive/jobs?token=${token}`, 'POST');
    assert.equal(galleryArchiveStart.status, 202, await galleryArchiveStart.clone().text());
    assert.equal(workerArchivePayload.folderId, '__all__');
    assert.deepEqual(Object.fromEntries(workerArchivePayload.photos.map((photo: any) => [photo.driveFileId, photo.archivePath])), {
        color: 'color.jpg',
        bw: 'No Watermark/bw.jpg',
        'nested-photo': 'No Watermark/Empty/nested-photo.jpg',
    });
    const rootArchiveStart = await request(`/public/gallery/edit-results/archive/jobs?token=${token}&scope=direct`, 'POST');
    assert.equal(rootArchiveStart.status, 202, await rootArchiveStart.clone().text());
    assert.equal(workerArchivePayload.folderId, '__all__');
    assert.equal(workerArchivePayload.scope, 'direct');
    assert.deepEqual(workerArchivePayload.photos, [
        { driveFileId: 'color', filename: 'color.jpg', archivePath: 'color.jpg' },
    ]);
    assert.equal((await request(`/public/gallery/edit-results/archive/jobs?token=${token}&scope=invalid`, 'POST')).status, 400);
    assert.equal((await request(`/public/gallery/edit-results/folders/not-published/archive/jobs?token=${token}`, 'POST')).status, 404);
    assert.equal((await request(`/public/gallery/edit-results/folders/no-watermark/archive/jobs?token=${token}&scope=invalid`, 'POST')).status, 400);
    assert.equal((await request(`/public/gallery/edit-results/folders/no-watermark/archive/jobs?token=bad`, 'POST')).status, 401);
    const archiveJob = await json(await request(`/public/gallery/edit-results/archive/jobs/${workerArchiveJobId}?token=${token}`));
    assert.equal((archiveJob as any).status, 'completed');
    assert.equal((archiveJob as any).downloadUrl, `https://archive.example.test/v1/archive/download/${workerArchiveJobId}?ticket=opaque-ticket`);
    workerArchiveSnapshotStale = true;
    assert.equal((await request(`/public/gallery/edit-results/archive/jobs/${workerArchiveJobId}?token=${token}`)).status, 409);
    workerArchiveSnapshotStale = false;
    workerArchiveErrorCode = 'drive_token_unavailable';
    const failedArchiveJob = await json(await request(`/public/gallery/edit-results/archive/jobs/${workerArchiveJobId}?token=${token}`));
    assert.equal((failedArchiveJob as any).status, 'failed');
    assert.match((failedArchiveJob as any).error, /photo source is unavailable/);
    workerArchiveErrorCode = null;
    archiveWorkerOffline = true;
    assert.equal((await request(`/public/gallery/edit-results/folders/no-watermark/archive/jobs?token=${token}`, 'POST')).status, 503);
    assert.equal((await request(`/public/gallery/edit-results/archive/jobs/${workerArchiveJobId}?token=${token}`)).status, 503);
    assert.equal((await request(`/public/gallery/edit-results?token=${token}`)).status, 200);
    archiveWorkerOffline = false;
} else {
    assert.equal(archiveStart.status, 503);
    assert.equal((await archiveStart.json() as { code: string }).code, 'ARCHIVE_WORKER_UNAVAILABLE');
    assert.equal(workerArchivePayload, null);
    assert.equal((await request(`/public/gallery/edit-results/archive/jobs/${workerArchiveJobId}?token=${token}`)).status, 503);
}
treeFails = true;
const previousError = console.error;
console.error = () => {};
try {
    assert.equal((await request('/admin/1/edit-results/publish', 'POST', { password: 'edit' })).status, 502);
} finally { console.error = previousError; }
const afterFailure = await (await listing()).json() as any;
assert.deepEqual(afterFailure.photos, nested.photos);
assert.deepEqual(afterFailure.folders, nested.folders);
assert.equal(afterFailure.publishedAt, nested.publishedAt);
assert.deepEqual(afterFailure.archive, nested.archive);
treeFails = false;
// Edited access changes preserve the snapshot and never rotate selection access.
const selectionBefore = await one('SELECT status, access_version, selection_deadline_at, pin_hash FROM galleries WHERE id = 1');
const snapshotBefore = await all('SELECT * FROM gallery_edit_result_photos WHERE gallery_id = 1');
assert.equal((await request('/admin/2', 'PATCH', { editResultsStatus: 'open' })).status, 400);
assert.equal((await request('/admin/1', 'PATCH', { editResultsStatus: 'invalid' })).status, 400);
for (const status of ['closed', 'draft']) {
    assert.equal((await request('/admin/1', 'PATCH', { editResultsStatus: status })).status, 200);
    assert.equal((await listing()).status, 403);
    assert.equal((await json(await listing())).archive, undefined);
    assert.equal((await request(`/public/gallery/edit-results/photos/color/download-url?token=${token}`)).status, 403);
    assert.equal((await request('/public/gallery/edit-results/verify', 'POST', { password: 'edit' })).status, 403);
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
assert.equal((await request(`/public/gallery/edit-results/archive/download-url?token=${token}`)).status, 403);
filtered = await (await request('/admin?mode=edited&status=closed')).json() as any;
assert.equal((await json(await listing())).archive, undefined);
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
if (process.env.FACE_ARCHIVE_WORKER_URL) {
    assert.equal(workerSnapshotUpdates.at(-1)?.galleryId, 1);
    assert.equal(workerSnapshotUpdates.at(-1)?.snapshotVersion, null);
}
assert.equal((await listing()).status, 404);
assert.equal((await one<{ n: number }>('SELECT COUNT(*) as n FROM gallery_edit_result_photos'))!.n, 0);
assert.equal((await one<{ n: number }>('SELECT COUNT(*) as n FROM gallery_edit_result_folders'))!.n, 0);
assert.equal((await one<any>('SELECT edit_results_status FROM galleries WHERE id = 1')).edit_results_status, 'draft');
await run("UPDATE galleries SET tutorial_before_drive_file_id = 'legacy-before', tutorial_after_drive_file_id = 'legacy-after', pin_hash = ? WHERE id = 1", [await Bun.password.hash('1234')]);
const contactInput = { contactWhatsappUrl: '081234567890', message: 'Access {{gallery_title}}', requestMoreMessage: 'More photos' };
const globalPreview = async (pairs: Array<[string, string]>) => {
    const fields = ['tutorialBeforeDriveFileId', 'tutorialAfterDriveFileId', 'tutorialBefore2DriveFileId', 'tutorialAfter2DriveFileId', 'tutorialBefore3DriveFileId', 'tutorialAfter3DriveFileId'];
    const values = Object.fromEntries(fields.map((field, index) => [field, pairs[Math.floor(index / 2)]?.[index % 2] || '']));
    const response = await request('/admin/settings/contact', 'PATCH', { ...contactInput, ...values });
    assert.equal(response.status, 200, await response.clone().text());
};
const selectionToken = (await json(await request('/public/gallery/verify', 'POST', { pin: '1234' }))).token;
const manifest = async () => (await (await request(`/public/gallery/photo-manifest?token=${selectionToken}`)).json() as any).gallery.tutorialSampleSlots as number[];
const previewVersion = async () => (await (await request(`/public/gallery/photo-manifest?token=${selectionToken}`)).json() as any).gallery.tutorialSampleVersion as string | null;
assert.deepEqual(await manifest(), []);
await globalPreview([['global-before', 'global-after']]);
assert.deepEqual(await manifest(), [1]);
const firstPreviewVersion = await previewVersion();
assert.ok(firstPreviewVersion);
const previewOnly = await request('/admin/settings/contact', 'PATCH', { tutorialBeforeDriveFileId: 'preview-only-before', tutorialAfterDriveFileId: 'preview-only-after' });
assert.equal(previewOnly.status, 200, await previewOnly.clone().text());
const previewOnlySettings = await (await request('/admin/settings/contact')).json() as any;
assert.equal(previewOnlySettings.tutorialBeforeDriveFileId, 'preview-only-before');
assert.equal(previewOnlySettings.contactWhatsappUrl, '6281234567890');
assert.equal(previewOnlySettings.message, contactInput.message);
assert.equal(previewOnlySettings.requestMoreMessage, contactInput.requestMoreMessage);
assert.notEqual(await previewVersion(), firstPreviewVersion);
await globalPreview([['global-before', 'global-after']]);
await run("UPDATE galleries SET status = 'open', pin_hash = ? WHERE id = 2", [await Bun.password.hash('5678')]);
const otherToken = (await json(await request('/public/other/verify', 'POST', { pin: '5678' }))).token;
assert.deepEqual((await (await request(`/public/other/photo-manifest?token=${otherToken}`)).json() as any).gallery.tutorialSampleSlots, [1]);
assert.deepEqual((await (await request('/admin/settings/contact')).json() as any).tutorialBeforeDriveFileId, 'global-before');
assert.equal((await request('/admin/settings/contact', 'PATCH', { ...contactInput, message: 'Updated access message' })).status, 200);
assert.deepEqual(await manifest(), [1]);
assert.equal((await (await request('/admin/settings/contact')).json() as any).message, 'Updated access message');
const versionBeforeContactOnly = await previewVersion();
assert.equal((await request('/admin/settings/contact', 'PATCH', { message: 'Contact only update' })).status, 200);
assert.equal((await (await request('/admin/settings/contact')).json() as any).tutorialBeforeDriveFileId, 'global-before');
assert.equal(await previewVersion(), versionBeforeContactOnly);
assert.equal((await request(`/public/gallery/tutorial/1/before?token=${selectionToken}`)).status, 200);
assert.equal(fetched.at(-1)?.id, 'global-before');
const incomplete = await request('/admin/settings/contact', 'PATCH', { ...contactInput, tutorialBeforeDriveFileId: 'only-before', tutorialAfterDriveFileId: '' });
assert.equal(incomplete.status, 400);
assert.deepEqual(await manifest(), [1]);
await run("UPDATE gallery_settings SET value = 'legacy-incomplete' WHERE key = 'tutorial_before_drive_file_id'");
await run("UPDATE gallery_settings SET value = '' WHERE key = 'tutorial_after_drive_file_id'");
assert.equal((await request('/admin/settings/contact', 'PATCH', { message: 'Independent contact update' })).status, 200);
assert.equal((await (await request('/admin/settings/contact')).json() as any).tutorialBeforeDriveFileId, 'legacy-incomplete');
await globalPreview([['first-before', 'first-after'], ['second-before', 'second-after'], ['third-before', 'third-after']]);
assert.deepEqual(await manifest(), [1, 2, 3]);
assert.notEqual(await previewVersion(), firstPreviewVersion);
await globalPreview([['first-before', 'first-after'], ['second-before', 'second-after']]);
assert.deepEqual(await manifest(), [1, 2]);
await globalPreview([]);
assert.deepEqual(await manifest(), []);
assert.equal((await one<any>('SELECT tutorial_before_drive_file_id FROM galleries WHERE id = 1')).tutorial_before_drive_file_id, 'legacy-before');
assert.equal((await request(`/public/gallery/tutorial/1/before?token=${selectionToken}`)).status, 404);

// Sync updates an existing delivery without restarting its password or access window.
await run("INSERT INTO galleries (id, title, public_key, drive_folder_id, edit_results_folder_id, pin_hash, status, gallery_workflow) VALUES (3, 'Sync Test', 'sync-test', 'source', 'old-edited', 'hash', 'closed', 'delivery_only')");
edited = [drivePhoto('old-edited-photo')];
folderSnapshot = [];
const initialSync = await request('/admin/3/edit-results/sync', 'POST');
assert.equal(initialSync.status, 200);
assert.equal((await initialSync.json() as any).published, false);
assert.equal((await one<{ n: number }>('SELECT COUNT(*) as n FROM gallery_edit_result_photos WHERE gallery_id = 3'))!.n, 0);
assert.equal((await request('/admin/3/edit-results/publish', 'POST', { password: 'same' })).status, 201);
const syncToken = (await json(await request('/public/sync-test/edit-results/verify', 'POST', { password: 'same' }))).token;
const syncListing = () => request(`/public/sync-test/edit-results?token=${syncToken}`);
const beforeSync = await one<any>('SELECT edit_results_key_hash, edit_results_published_at, edit_results_expires_at, edit_results_version FROM galleries WHERE id = 3');
const saveNewFolder = await request('/admin/3', 'PATCH', { editResultsFolderId: 'new-edited', editResultsZipFileId: 'not-a-zip' });
assert.equal(saveNewFolder.status, 200);
assert.equal((await saveNewFolder.json() as any).editedSourceChanged, true);
assert.deepEqual((await json(await syncListing())).photos.map((photo) => photo.driveFileId), ['old-edited-photo']);
edited = [drivePhoto('new-edited-photo'), drivePhoto('another-edited-photo')];
folderSnapshot = [{ id: 'new-subfolder', parentId: null, name: 'No Watermark' }];
treeFails = true;
assert.equal((await request('/admin/3/edit-results/sync', 'POST')).status, 502);
assert.deepEqual((await json(await syncListing())).photos.map((photo) => photo.driveFileId), ['old-edited-photo']);
treeFails = false;
assert.equal((await request('/admin/3/edit-results/sync', 'POST')).status, 400);
assert.deepEqual((await json(await syncListing())).photos.map((photo) => photo.driveFileId), ['old-edited-photo']);
assert.equal((await request('/admin/3', 'PATCH', { editResultsZipFileId: 'archive' })).status, 200);
const updatedSync = await request('/admin/3/edit-results/sync', 'POST');
assert.equal(updatedSync.status, 200, await updatedSync.clone().text());
assert.equal((await updatedSync.json() as any).published, true);
if (process.env.FACE_ARCHIVE_WORKER_URL) {
    assert.equal(workerSnapshotUpdates.at(-2)?.galleryId, 3);
    assert.equal(workerSnapshotUpdates.at(-2)?.snapshotVersion, null);
    assert.equal(workerSnapshotUpdates.at(-1)?.galleryId, 3);
    assert.equal(typeof workerSnapshotUpdates.at(-1)?.snapshotVersion, 'string');
}
assert.deepEqual(await one('SELECT edit_results_key_hash, edit_results_published_at, edit_results_expires_at, edit_results_version FROM galleries WHERE id = 3'), beforeSync);
const afterSync = await json(await syncListing());
assert.deepEqual(afterSync.photos.map((photo) => photo.driveFileId), ['new-edited-photo', 'another-edited-photo']);
assert.equal((afterSync as any).folders.length, 1);
assert.equal(afterSync.archive?.filename, 'backup.zip');
assert.equal((await request(`/public/sync-test/edit-results/photos/old-edited-photo/download-url?token=${syncToken}`)).status, 404);
assert.equal((await request('/public/sync-test/edit-results/verify', 'POST', { password: 'same' })).status, 200);
sqlite!.close();
