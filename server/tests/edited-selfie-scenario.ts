import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { Hono } from 'hono';

let revision = 'v1';
const drivePhoto = (id: string, folderId: string | null = null) => ({ id, folderId, name: `${id}.jpg`, mimeType: 'image/jpeg', thumbnailLink: `https://images.test/${id}`, webContentLink: `https://drive.google.com/uc?export=download&id=${id}`, canDownload: true, md5Checksum: revision, width: 1200, height: 900 });
mock.module('../lib/google-drive', () => ({
    getReadonlyDriveToken: async () => ({ accessToken: 'test', expiresAt: Date.now() + 1000 }),
    hasAnyoneViewerFolderAccess: async () => true,
    listDrivePhotoTree: async () => ({ photos: [drivePhoto('edited-a', 'portraits'), drivePhoto('edited-b', 'nested')], folders: [{ id: 'portraits', parentId: null, name: 'Portraits' }, { id: 'nested', parentId: 'portraits', name: 'Family' }] }),
    listDrivePhotos: async () => [drivePhoto('raw-a')],
    getDrivePhotoMetadata: async (id: string) => drivePhoto(id),
    fetchDriveFile: async () => new Response('image', { headers: { 'content-type': 'image/jpeg' } }),
    fetchDriveVideo: async (_id: string, range?: string) => {
        if (range === 'bytes=99-100') return new Response(null, { status: 416, headers: { 'accept-ranges': 'bytes', 'content-range': 'bytes */10' } });
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } }), {
            status: range ? 206 : 200,
            headers: { 'accept-ranges': 'bytes', 'content-type': 'video/mp4', ...(range ? { 'content-range': 'bytes 0-2/10' } : {}), 'content-length': '3' },
        });
    },
}));
const { sqlite } = await import('../db/runtime');
sqlite!.exec('CREATE TABLE user_permissions (user_id INTEGER, permission_key TEXT, effect TEXT)');
const { galleryRun: run, galleryAll: all, ensureGalleryStorage } = await import('../db/galleries');
await ensureGalleryStorage();
const { FACE_MODEL_VERSION } = await import('../lib/face-model');
const dispatched: any[] = [];
let lastSearch: FormData | null = null;
globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith('/readyz')) return Response.json({ model: FACE_MODEL_VERSION, capabilities: ['embedding-cache-v1', 'drive-direct-v1', 'solo-filter-v1', 'solo-person-filter-v1'] });
    if (String(input).endsWith('/v1/index/jobs')) dispatched.push(JSON.parse(String(init?.body)));
    if (String(input).endsWith('/v1/search')) {
        lastSearch = init!.body as FormData;
        return Response.json({ matches: [{ driveFileId: 'edited-a' }, { driveFileId: 'edited-b' }, { driveFileId: 'raw-a' }] });
    }
    return Response.json({ accepted: true });
}, { preconnect: globalThis.fetch.preconnect });
const { publicGalleriesRouter, adminGalleriesRouter } = await import('../routes/galleries');
const { faceIndexRouter, prepareGalleryFaceIndex, currentJob } = await import('../routes/face-index');
const app = new Hono<any>();
app.use('/admin/*', async (c, next) => { c.set('user', { sub: 1, role: 'superadmin', email: 'test@example.test', name: 'Admin' }); await next(); });
app.route('/admin', adminGalleriesRouter);
app.route('/public', publicGalleriesRouter);
const request = (path: string, method = 'GET', body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const json = async (response: Response) => response.json() as Promise<any>;
const complete = async (jobId: number) => {
    const job = dispatched.find((job) => job.jobId === jobId)!;
    return faceIndexRouter.request(`/callbacks/jobs/${jobId}/complete`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-face-worker-token': 'internal' }, body: JSON.stringify({ galleryId: job.galleryId, modelVersion: job.modelVersion, sourceVersion: job.sourceVersion, embeddings: [], indexedPhotos: job.photos.map((photo: any) => ({ driveFileId: photo.driveFileId, sourceVersion: photo.sourceVersion, isSolo: false })) }) });
};
await run("INSERT INTO galleries (id, title, public_key, drive_folder_id, edit_results_folder_id, pin_hash, status, photo_count, selection_deadline_at) VALUES (1, 'Mixed', 'mixed', 'raw', 'edited', ?, 'open', 1, '2099-01-01')", [await Bun.password.hash('selection-pass')]);
await run("INSERT INTO gallery_photos (gallery_id, drive_file_id, filename, mime_type, source_version) VALUES (1, 'raw-a', 'raw-a.jpg', 'image/jpeg', 'raw-v1')");
const selectionToken = (await json(await request('/public/mixed/verify', 'POST', { pin: 'selection-pass' }))).token;
await prepareGalleryFaceIndex(1);
const selectionJob = (await currentJob(1))!;
assert.equal((await complete(selectionJob.id)).status, 200);
assert.equal((await request('/admin/1/edit-results/publish', 'POST', { password: 'edit' })).status, 201);
await prepareGalleryFaceIndex(1, 'edited');
const editedJob = (await currentJob(1, 'edited'))!;
assert.equal((await complete(editedJob.id)).status, 200);
const editedToken = (await json(await request('/public/mixed/edit-results/verify', 'POST', { password: 'edit' }))).token;
await run("INSERT INTO gallery_edit_result_photos (gallery_id, drive_file_id, filename, mime_type, web_content_link, display_order, source_version) VALUES (1, 'edited-video', 'clip.mp4', 'video/mp4', 'https://drive.google.com/clip', 10, 'video-v1')");
const videoPath = `/public/mixed/edit-results/photos/edited-video/video`;
assert.equal((await app.request(videoPath)).status, 401);
assert.equal((await app.request(`${videoPath}?token=${selectionToken}`)).status, 401);
assert.equal((await app.request(`${videoPath}?token=${editedToken}`, { headers: { range: 'bytes=-' } })).status, 400);
const videoResponse = await app.request(`${videoPath}?token=${editedToken}`, { headers: { range: 'bytes=0-2' } });
assert.equal(videoResponse.status, 206);
assert.equal(videoResponse.headers.get('content-range'), 'bytes 0-2/10');
assert.equal(videoResponse.headers.get('accept-ranges'), 'bytes');
assert.deepEqual([...new Uint8Array(await videoResponse.arrayBuffer())], [1, 2, 3]);
const unsatisfiableRange = await app.request(`${videoPath}?token=${editedToken}`, { headers: { range: 'bytes=99-100' } });
assert.equal(unsatisfiableRange.status, 416);
assert.equal(unsatisfiableRange.headers.get('content-range'), 'bytes */10');
const statusPath = '/public/mixed/edit-results/face-search/status';
assert.equal((await request(statusPath)).status, 401);
assert.equal((await request(`${statusPath}?token=${selectionToken}`)).status, 401);
assert.equal((await request(`/public/mixed/face-search/status?token=${editedToken}`)).status, 401);
assert.equal((await json(await request(`${statusPath}?token=${editedToken}`))).status, 'ready');
const search = async (token: string, prefix = 'mixed') => {
    const form = new FormData();
    form.set('selfie', new File(['test'], 'selfie.jpg', { type: 'image/jpeg' }));
    form.set('sensitivity', 'wide');
    form.set('soloOnly', 'true');
    return app.request(`/public/${prefix}/edit-results/face-search`, { method: 'POST', headers: { 'x-edit-results-token': token }, body: form });
};
assert.equal((await search(selectionToken)).status, 401);
const found = await json(await search(editedToken));
assert.deepEqual(found.matches.map((photo: any) => photo.driveFileId), ['edited-a', 'edited-b']);
assert.deepEqual(found.matches.map((photo: any) => photo.folderId), ['portraits', 'nested']);
assert.equal(found.total, 2);
assert.ok(found.matches.every((photo: any) => photo.sourceVersion === 'md5:v1'));
assert.ok(found.matches.every((photo: any) => photo.thumbnailUrl.includes('/edit-results/') && photo.downloadResolveUrl.includes('/download-url')));
assert.equal((lastSearch as FormData | null)?.get('soloOnly'), 'true');
assert.equal((await currentJob(1))!.id, selectionJob.id);
revision = 'v2';
assert.equal((await request('/admin/1/edit-results/sync', 'POST')).status, 200);
await prepareGalleryFaceIndex(1, 'edited');
const syncedJob = (await currentJob(1, 'edited'))!;
assert.notEqual(syncedJob.id, editedJob.id);
assert.equal((await complete(editedJob.id)).status, 409);
assert.equal((await complete(syncedJob.id)).status, 200);
assert.equal((await currentJob(1))!.id, selectionJob.id);
await run("UPDATE galleries SET edit_results_status = 'closed' WHERE id = 1");
assert.equal((await request(`${statusPath}?token=${editedToken}`)).status, 403);
assert.equal((await search(editedToken)).status, 403);
await run("UPDATE galleries SET edit_results_status = 'open', edit_results_expires_at = '2000-01-01' WHERE id = 1");
assert.equal((await request(`${statusPath}?token=${editedToken}`)).status, 403);
assert.equal((await request('/admin/1/edit-results/unpublish', 'POST')).status, 200);
assert.equal((await all("SELECT id FROM face_index_jobs WHERE source_scope = 'edited'")).length, 0);
assert.equal((await currentJob(1))!.id, selectionJob.id);

await run("INSERT INTO galleries (id, title, public_key, gallery_workflow, drive_folder_id, edit_results_folder_id, pin_hash) VALUES (2, 'Wedding', 'wedding', 'delivery_only', '', 'edited', '')");
assert.equal((await request('/admin/2/edit-results/publish', 'POST', { password: 'wed1' })).status, 201);
await prepareGalleryFaceIndex(2, 'edited');
assert.equal((await complete((await currentJob(2, 'edited'))!.id)).status, 200);
const weddingToken = (await json(await request('/public/wedding/edit-results/verify', 'POST', { password: 'wed1' }))).token;
assert.equal((await search(weddingToken, 'wedding')).status, 200);
assert.equal((await request(`/public/wedding/face-search/status?token=${weddingToken}`)).status, 403);
