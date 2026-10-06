import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { Hono } from 'hono';

let folderAccess = true;
let empty = false;
let downloadAllowed = true;
let driveFails = false;
let driveReads = 0;
const photo = (id: string) => ({ id, name: `${id}.jpg`, mimeType: 'image/jpeg', webContentLink: `https://drive.google.com/uc?export=download&id=${id}`, canDownload: downloadAllowed, thumbnailLink: `https://lh3.googleusercontent.com/${id}`, width: 1200, height: 900 });
mock.module('../lib/google-drive', () => ({
    getReadonlyDriveToken: async () => ({ accessToken: 'test', expiresAt: Date.now() + 1000 }),
    hasAnyoneViewerFolderAccess: async () => folderAccess,
    listDrivePhotoTree: async () => {
        driveReads++;
        if (driveFails) throw new Error('Drive unavailable');
        return { photos: empty ? [] : [{ ...photo('ceremony'), folderId: 'ceremony-folder' }], folders: [{ id: 'ceremony-folder', parentId: null, name: 'Ceremony' }] };
    },
    listDrivePhotos: async () => [photo('source')],
    getDrivePhotoMetadata: async (id: string) => photo(id),
    fetchDriveFile: async () => new Response('image', { headers: { 'content-type': 'image/jpeg' } }),
}));
const { sqlite: db } = await import('../db/runtime');
db!.exec('CREATE TABLE user_permissions (user_id INTEGER, permission_key TEXT, effect TEXT)');
const { ensureGalleryStorage, galleryRun: run, galleryOne: one } = await import('../db/galleries');
await ensureGalleryStorage();
await run("INSERT INTO galleries (id, title, public_key, drive_folder_id, pin_hash, selection_deadline_at, edit_results_key_hash, edit_results_photo_count, edit_results_expires_at, edit_results_status) VALUES (1, 'Legacy', 'legacy', 'source', 'hash', '2099-01-01', 'edited-hash', 1, '2099-02-01', 'open')");
await run("INSERT INTO gallery_edit_result_photos (gallery_id, drive_file_id, filename, mime_type, web_content_link) VALUES (1, 'legacy-photo', 'legacy.jpg', 'image/jpeg', 'https://drive.google.com/legacy')");
db!.run('ALTER TABLE galleries DROP COLUMN gallery_workflow');
const before = db!.query('SELECT selection_deadline_at, edit_results_expires_at, access_version, edit_results_version FROM galleries WHERE id = 1').get();
const upgraded = await import('../db/galleries.ts' + '?workflow-upgrade');
await upgraded.ensureGalleryStorage();
assert.equal((await one<any>('SELECT gallery_workflow FROM galleries WHERE id = 1'))!.gallery_workflow, 'selection_delivery');
assert.deepEqual(db!.query('SELECT selection_deadline_at, edit_results_expires_at, access_version, edit_results_version FROM galleries WHERE id = 1').get(), before);

const { adminGalleriesRouter, publicGalleriesRouter } = await import('../routes/galleries');
const { default: paymentsRouter } = await import('../routes/payments');
const app = new Hono<any>();
app.use('/admin/*', async (c, next) => { c.set('user', { sub: 1, role: 'superadmin', email: 'test@example.invalid', name: 'Admin' }); await next(); });
app.route('/admin', adminGalleriesRouter);
app.route('/public', publicGalleriesRouter);
app.route('/payments', paymentsRouter);
const request = (path: string, method = 'GET', body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const json = async (response: Response) => response.json() as Promise<any>;

assert.equal((await request('/admin', 'POST', { title: 'Wedding', workflow: 'delivery_only' })).status, 400);
assert.equal((await request('/admin', 'POST', { title: 'Wedding', workflow: 'delivery_only', editResultsFolderId: 'not a folder' })).status, 400);
assert.equal((await request('/admin', 'POST', { title: 'Invalid', workflow: 'unknown' })).status, 400);
assert.equal((await request('/admin/invalid/sync', 'POST')).status, 400);
const creation = await request('/admin', 'POST', { title: 'Wedding', workflow: 'delivery_only', editResultsFolderId: 'https://drive.google.com/drive/folders/wedding-root' });
assert.equal(creation.status, 200, await creation.clone().text());
const wedding = await json(creation);
assert.equal(wedding.workflow, 'delivery_only');
assert.equal(wedding.editResultsFolderId, 'wedding-root');
assert.equal(wedding.editResultsStatus, 'draft');
assert.equal(wedding.editResultsAccessDurationHours, 168);
for (const key of ['pinHash', 'driveFolderId', 'selectionCount', 'maxSelections', 'selectionDeadlineAt', 'status', 'addon']) assert.equal(key in wedding, false);
const id = wedding.id;
const slug = wedding.publicKey;
const raw = await one<any>('SELECT * FROM galleries WHERE id = ?', [id]);
assert.equal(raw.selection_deadline_at, null);
assert.equal(raw.pin_hash, '');
assert.equal(raw.drive_folder_id, '');
const selectionList = await json(await request('/admin?mode=selection&pageSize=1'));
assert.equal(selectionList.total, 1);
assert.equal(selectionList.items[0].workflow, 'selection_delivery');
const editedList = await json(await request('/admin?mode=edited'));
assert.equal(editedList.total, 2);
assert.ok(editedList.items.some((item: any) => item.id === id));
assert.equal((await json(await request('/admin?mode=edited&status=draft'))).total, 1);
assert.deepEqual((await json(await request(`/admin/${id}`))).photos, []);

for (const [path, method] of [['verify', 'POST'], ['photos', 'GET'], ['photo-manifest', 'GET'], ['selections', 'POST'], ['face-search', 'POST'], ['face-search/status', 'GET'], ['photos/photo/thumbnail?pt=standalone', 'GET'], ['photos/photo/preview', 'GET'], ['photos/photo/content', 'GET'], ['tutorial/1/before', 'GET']] as const) {
    const response = await request(`/public/${slug}/${path}`, method, method === 'POST' ? {} : undefined);
    assert.equal(response.status, 403, path);
    assert.equal((await json(response)).code, 'SELECTION_NOT_AVAILABLE', path);
}
for (const path of ['sync', 'reset-pin-lock', 'addon', 'export.csv', 'export.xlsx', 'export-copy.ps1', 'edit-results/pairing', 'edit-results/pairing/before/photo/thumbnail']) {
    const response = await request(`/admin/${id}/${path}`, ['sync', 'reset-pin-lock'].includes(path) ? 'POST' : 'GET');
    assert.equal((await json(response)).code, 'SELECTION_NOT_AVAILABLE', path);
}
assert.equal((await json(await request('/payments/qris/create', 'POST', { galleryId: slug, requestedCount: 10 }))).code, 'SELECTION_NOT_AVAILABLE');
assert.equal((await json(await request(`/admin/${id}`, 'PATCH', { workflow: 'selection_delivery' }))).code, 'GALLERY_WORKFLOW_IMMUTABLE');
assert.equal((await json(await request(`/admin/${id}`, 'PATCH', { status: 'open' }))).code, 'SELECTION_NOT_AVAILABLE');
assert.equal((await json(await request(`/admin/${id}`, 'PATCH', { comparisonEnabled: true }))).code, 'SELECTION_NOT_AVAILABLE');
assert.equal((await request(`/admin/${id}`, 'PATCH', { editResultsStatus: 'open' })).status, 400);
assert.equal((await request(`/admin/${id}`, 'PATCH', { title: 'Updated Wedding', editResultsAccessDurationHours: null })).status, 200);
assert.equal((await one<any>('SELECT title FROM galleries WHERE id = ?', [id]))!.title, 'Updated Wedding');
assert.equal((await one<any>('SELECT selection_deadline_at FROM galleries WHERE id = ?', [id]))!.selection_deadline_at, null);

folderAccess = false;
assert.equal((await request(`/admin/${id}/edit-results/sync`, 'POST')).status, 400);
folderAccess = true;
empty = true;
assert.equal((await request(`/admin/${id}/edit-results/sync`, 'POST')).status, 400);
empty = false;
downloadAllowed = false;
assert.equal((await request(`/admin/${id}/edit-results/sync`, 'POST')).status, 400);
downloadAllowed = true;
driveFails = true;
assert.equal((await request(`/admin/${id}/edit-results/sync`, 'POST')).status, 502);
driveFails = false;
assert.equal((await json(await request(`/admin/${id}/edit-results/sync`, 'POST'))).folderCount, 1);
assert.equal((await request(`/admin/${id}/edit-results/publish`, 'POST', { password: '123' })).status, 400);
assert.equal((await request(`/admin/${id}/edit-results/publish`, 'POST', { password: 'wedding-password' })).status, 201);
const status = await json(await request(`/public/${slug}/edit-results/status`));
assert.equal(status.workflow, 'delivery_only');
assert.equal(status.title, 'Updated Wedding');
assert.equal(status.available, true);
assert.equal((await request(`/public/${slug}/edit-results/verify`, 'POST', { password: 'wrong-password' })).status, 401);
const access = await json(await request(`/public/${slug}/edit-results/verify`, 'POST', { password: 'wedding-password' }));
const listing = await json(await request(`/public/${slug}/edit-results?token=${access.token}`));
assert.equal(listing.expiresAt, null);
assert.equal(listing.photos[0].folderId, 'ceremony-folder');
assert.equal(listing.photos[0].comparison, null);
assert.equal((await request(`/public/${slug}/edit-results/photos/ceremony/before/preview?token=${access.token}`)).status, 404);
assert.equal((await request(`/public/${slug}/edit-results/photos/ceremony/download-url?token=${access.token}`)).status, 200);
assert.equal((await request(`/admin/${id}`, 'PATCH', { editResultsStatus: 'closed' })).status, 200);
assert.equal((await json(await request(`/public/${slug}/edit-results?token=${access.token}`))).code, 'EDIT_RESULTS_CLOSED');
assert.equal((await request(`/admin/${id}`, 'PATCH', { editResultsStatus: 'open' })).status, 200);
assert.equal((await json(await request(`/public/${slug}/edit-results?token=${access.token}`))).code, 'EDIT_RESULTS_TOKEN_INVALID');
await run("UPDATE galleries SET edit_results_expires_at = '2000-01-01' WHERE id = ?", [id]);
assert.equal((await json(await request(`/public/${slug}/edit-results/verify`, 'POST', { password: 'wedding-password' }))).code, 'EDIT_RESULTS_EXPIRED');
assert.equal((await json(await request('/admin?mode=edited&status=closed'))).total, 1);
assert.ok(driveReads > 0);

const prewedCreation = await request('/admin', 'POST', { title: 'New Prewed', driveFolderUrl: 'source-new', pin: '4321', status: 'open', maxSelections: 70, selectionDurationHours: 72 });
assert.equal(prewedCreation.status, 200, await prewedCreation.clone().text());
const prewed = await json(prewedCreation);
assert.equal(prewed.workflow, 'selection_delivery');
assert.equal(prewed.maxSelections, 70);
assert.equal((await request(`/public/${prewed.publicKey}/verify`, 'POST', { pin: 'wrong' })).status, 401);
const unlocked = await json(await request(`/public/${prewed.publicKey}/verify`, 'POST', { pin: '4321' }));
assert.equal(unlocked.gallery.workflow, 'selection_delivery');
assert.equal((await request(`/public/${prewed.publicKey}/photos?token=${unlocked.token}`)).status, 200);
const restart = await import('../db/galleries.ts' + '?workflow-restart');
await restart.ensureGalleryStorage();
assert.equal((await one<any>('SELECT gallery_workflow FROM galleries WHERE id = ?', [id]))!.gallery_workflow, 'delivery_only');
assert.deepEqual(db!.query('SELECT selection_deadline_at, edit_results_expires_at, access_version, edit_results_version FROM galleries WHERE id = 1').get(), before);
assert.equal((await one<any>('SELECT COUNT(*) as n FROM gallery_edit_result_photos WHERE gallery_id = 1'))!.n, 1);
db!.close();
