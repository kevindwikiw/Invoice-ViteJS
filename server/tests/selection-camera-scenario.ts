import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { Hono } from 'hono';

const { sqlite: db } = await import('../db/runtime');
db!.exec('CREATE TABLE user_permissions (user_id INTEGER, permission_key TEXT, effect TEXT)');
const storage = await import('../db/galleries');
await storage.ensureGalleryStorage();
const { galleryRun, galleryOne } = storage;
const photo = (id: string, folderId: string | null) => ({ id, name: `${id}.jpg`, mimeType: 'image/jpeg', folderId, thumbnailLink: `https://images.test/${id}`, md5Checksum: id, width: 1200, height: 800 });
let rejectedThumbnail = false;
let source = {
    rootName: 'Selection',
    folders: [{ id: 'camera-b', parentId: null, name: 'Fotografi 2' }, { id: 'camera-a', parentId: null, name: 'Fotografi 1' }, { id: 'nested', parentId: 'camera-b', name: 'Second card' }],
    photos: [photo('a', 'camera-a'), photo('b', 'camera-a'), photo('c', 'nested'), photo('stray', null)],
};
mock.module('../lib/google-drive', () => ({
    getReadonlyDriveToken: async () => ({ accessToken: 'test', expiresAt: Date.now() + 1000 }),
    listDrivePhotoTree: async () => source,
    listDrivePhotos: async () => source.photos,
    getDrivePhotoMetadata: async (id: string) => photo(id, null),
    hasAnyoneViewerFolderAccess: async () => true,
    fetchDriveFile: async (id: string, thumbnail?: string) => {
        if (id === 'a' && thumbnail && !rejectedThumbnail) {
            rejectedThumbnail = true;
            throw Object.assign(new Error('Drive thumbnail expired'), { status: 403 });
        }
        return new Response('image', { headers: { 'content-type': 'image/jpeg' } });
    },
    fetchDriveVideo: async () => new Response('video', { headers: { 'content-type': 'video/mp4' } }),
}));

const { adminGalleriesRouter, publicGalleriesRouter } = await import('../routes/galleries');
const app = new Hono<any>();
app.use('/admin/*', async (c, next) => { c.set('user', { sub: 1, role: 'superadmin', email: 'admin@test.invalid', name: 'Admin' }); await next(); });
app.route('/admin', adminGalleriesRouter);
app.route('/public', publicGalleriesRouter);
const password = 'selection-password';
await galleryRun("INSERT INTO galleries (id, title, public_key, drive_folder_id, pin_hash, status, max_selections, selection_deadline_at) VALUES (1, 'Selection', 'selection', 'root', ?, 'open', 2, '2099-01-01')", [await Bun.password.hash(password)]);
const request = (path: string, method = 'GET', body?: unknown) => app.request(path, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
assert.equal((await request('/admin/1', 'PATCH', { camera1FolderId: 'camera-a' })).status, 400, 'camera folders are assigned by sync');
assert.equal((await request('/admin/1/sync', 'POST')).status, 400, 'unmapped root photo must block sync');
assert.equal((await galleryOne<{ count: number }>('SELECT COUNT(*) as count FROM gallery_photos WHERE gallery_id = 1'))?.count, 0);
source = { ...source, photos: source.photos.filter((item) => item.id !== 'stray') };
assert.equal((await request('/admin/1/sync', 'POST')).status, 200);
assert.deepEqual(await galleryOne<{ camera1FolderId: string; camera2FolderId: string }>('SELECT camera_1_folder_id as "camera1FolderId", camera_2_folder_id as "camera2FolderId" FROM galleries WHERE id = 1'), { camera1FolderId: 'camera-a', camera2FolderId: 'camera-b' });
const referenceImage = await request('/admin/1/reference-photo/a');
assert.equal(referenceImage.status, 200);
assert.equal(referenceImage.headers.get('Content-Type'), 'image/jpeg');
assert.equal(rejectedThumbnail, true, 'the server refreshes a 403 Drive thumbnail before serving the admin preview');
const verify = await request('/public/selection/verify', 'POST', { pin: password });
assert.equal(verify.status, 200);
const { token } = await verify.json() as { token: string };
const list = async (filter?: string) => (await request(`/public/selection/photos?token=${token}&pageSize=2${filter ? `&filter=${filter}` : ''}`)).json() as Promise<{ total: number; totalPages: number; photos: Array<{ driveFileId: string }>; gallery: { camerasAvailable: boolean; cameraFolderCount: number } }>;
assert.equal((await list()).total, 3);
assert.equal((await list()).totalPages, 2);
assert.deepEqual((await list('camera1')).photos.map((item) => item.driveFileId), ['a', 'b']);
assert.deepEqual((await list('camera2')).photos.map((item) => item.driveFileId), ['c']);
assert.equal((await list()).gallery.camerasAvailable, true);
assert.equal((await list()).gallery.cameraFolderCount, 2);
const submit = (ids: string[]) => request(`/public/selection/selections?token=${token}`, 'POST', { selections: ids.map((driveFileId) => ({ driveFileId, note: '' })) });
assert.equal((await submit(['a', 'c'])).status, 200, 'cross-camera selections share one limit');
assert.equal((await submit(['a', 'b', 'c'])).status, 400, 'the same limit applies to the whole gallery');
const submitted = await request(`/public/selection/photos?token=${token}&includeSelectedPhotos=1`);
assert.deepEqual(((await submitted.json()) as { selectedPhotos: Array<{ driveFileId: string }> }).selectedPhotos.map((item) => item.driveFileId), ['a', 'c']);

const { getFaceSourceVersion } = await import('../lib/face-source');
const { FACE_MODEL_VERSION } = await import('../lib/face-model');
const { rebuildOwnPhotoResults } = await import('../routes/face-index');
const version = await getFaceSourceVersion(1);
await galleryRun("INSERT INTO face_index_jobs (gallery_id, source_scope, status, model_version, source_version, total) VALUES (1, 'selection', 'completed', ?, ?, 3)", [FACE_MODEL_VERSION, version]);
const axis = (index: number) => Array.from({ length: 128 }, (_, item) => item === index ? 1 : 0);
for (const [id, index, vector] of [['a', 0, axis(0)], ['a', 1, axis(1)], ['b', 0, axis(0)], ['c', 0, axis(1)]] as const) {
    const photoVersion = (await galleryOne<{ sourceVersion: string }>('SELECT source_version as "sourceVersion" FROM gallery_photos WHERE gallery_id = 1 AND drive_file_id = ?', [id]))!.sourceVersion;
    await galleryRun("INSERT INTO face_embeddings (gallery_id, source_scope, drive_file_id, face_index, embedding, source_version, model_version) VALUES (1, 'selection', ?, ?, ?, ?, ?)", [id, index, JSON.stringify(vector), photoVersion, FACE_MODEL_VERSION]);
}
for (const [id, isSolo] of [['a', 0], ['b', 1], ['c', 1]] as const) {
    const photoVersion = (await galleryOne<{ sourceVersion: string }>('SELECT source_version as "sourceVersion" FROM gallery_photos WHERE gallery_id = 1 AND drive_file_id = ?', [id]))!.sourceVersion;
    await galleryRun("INSERT INTO face_index_photos (gallery_id, source_scope, drive_file_id, source_version, model_version, is_solo) VALUES (1, 'selection', ?, ?, ?, ?)", [id, photoVersion, FACE_MODEL_VERSION, isSolo]);
}
const referenceVersion = (await galleryOne<{ sourceVersion: string }>('SELECT source_version as "sourceVersion" FROM gallery_photos WHERE gallery_id = 1 AND drive_file_id = ?', ['a']))!.sourceVersion;
const detected = await request('/admin/1/reference-faces?fileId=a');
assert.equal(detected.status, 200);
assert.deepEqual(((await detected.json()) as { faces: Array<{ faceIndex: number }> }).faces.map((face) => face.faceIndex), [0, 1]);
assert.equal((await request('/admin/1', 'PATCH', { faceReferenceFileId: 'a', faceReferenceFemaleIndex: 0, faceReferenceMaleIndex: 0, faceReferencePhotoVersion: referenceVersion })).status, 400);
assert.equal((await request('/admin/1', 'PATCH', { faceReferenceFileId: 'a', faceReferenceFemaleIndex: 0, faceReferenceMaleIndex: 1, faceReferencePhotoVersion: 'stale' })).status, 409);
assert.equal((await request('/admin/1', 'PATCH', { faceReferenceFileId: 'a', faceReferenceFemaleIndex: 0, faceReferenceMaleIndex: 1, faceReferencePhotoVersion: referenceVersion })).status, 200);
assert.equal(await rebuildOwnPhotoResults(1), true);
for (const [category, expected] of [['female', ['b']], ['male', ['c']]] as const) {
    const result = await request(`/public/selection/photos?token=${token}&filter=${category}&sensitivity=balanced`);
    assert.equal(result.status, 200);
    assert.deepEqual(((await result.json()) as { photos: Array<{ driveFileId: string }> }).photos.map((item) => item.driveFileId), expected);
}
assert.equal((await request(`/public/selection/photos?token=${token}&filter=couple`)).status, 400, 'Foto Berdua is no longer a public filter');
const review = await request('/admin/1/own-photo-review?sensitivity=balanced');
assert.equal(review.status, 200);
const reviewData = await review.json() as { categories: { female: Array<{ driveFileId: string; sourceVersion: string; excluded: boolean }> } };
assert.deepEqual(reviewData.categories.female.map((item) => item.driveFileId), ['b']);
assert.equal((await request('/admin/1/own-photo-review/b/thumbnail')).status, 200);
const femalePhoto = reviewData.categories.female[0]!;
assert.equal((await request('/admin/1/own-photo-exclusions/female/b', 'PUT', { sourceVersion: 'stale' })).status, 409);
assert.equal((await request('/admin/1/own-photo-exclusions/female/b', 'PUT', { sourceVersion: femalePhoto.sourceVersion })).status, 200);
for (const sensitivity of ['strict', 'balanced', 'wide']) {
    const filtered = await request(`/public/selection/photos?token=${token}&filter=female&sensitivity=${sensitivity}`);
    assert.deepEqual(((await filtered.json()) as { photos: Array<{ driveFileId: string }> }).photos, [], 'admin correction applies to every sensitivity');
}
assert.equal(((await request('/admin/1/own-photo-review')).status), 200);
assert.equal((await (await request('/admin/1/own-photo-review')).json() as { categories: { female: Array<{ excluded: boolean }> } }).categories.female[0]?.excluded, true);
assert.equal(await rebuildOwnPhotoResults(1), true);
assert.deepEqual(((await (await request(`/public/selection/photos?token=${token}&filter=female`)).json()) as { photos: unknown[] }).photos, [], 'correction survives result rebuild');
assert.equal((await request('/admin/1/own-photo-exclusions/female/b', 'DELETE')).status, 200);
assert.deepEqual(((await (await request(`/public/selection/photos?token=${token}&filter=female`)).json()) as { photos: Array<{ driveFileId: string }> }).photos.map((item) => item.driveFileId), ['b']);
assert.equal((await request('/admin/1/own-photo-exclusions/female/b', 'PUT', { sourceVersion: femalePhoto.sourceVersion })).status, 200);
assert.equal((await request('/admin/1/sync', 'POST')).status, 200);
assert.equal((await galleryOne<{ count: number }>('SELECT COUNT(*) as count FROM gallery_own_photo_exclusions WHERE gallery_id = 1'))?.count, 1, 'unchanged photo keeps admin correction after sync');
source = { ...source, photos: source.photos.map((item) => item.id === 'b' ? { ...item, md5Checksum: 'changed-b' } : item) };
assert.equal((await request('/admin/1/sync', 'POST')).status, 200);
assert.equal((await galleryOne<{ count: number }>('SELECT COUNT(*) as count FROM gallery_own_photo_exclusions WHERE gallery_id = 1'))?.count, 0, 'replaced photo loses stale correction');
source = { ...source, photos: source.photos.map((item) => item.id === 'a' ? { ...item, md5Checksum: 'changed-reference' } : item) };
assert.equal((await request('/admin/1/sync', 'POST')).status, 200);
const newVersion = await getFaceSourceVersion(1);
await galleryRun("INSERT INTO face_index_jobs (gallery_id, source_scope, status, model_version, source_version, total) VALUES (1, 'selection', 'completed', ?, ?, 3)", [FACE_MODEL_VERSION, newVersion]);
assert.equal(await rebuildOwnPhotoResults(1), false, 'a resync cannot reuse an obsolete face reference');
assert.equal((await galleryOne<{ count: number }>('SELECT COUNT(*) as count FROM gallery_own_photo_results WHERE gallery_id = 1'))?.count, 0);
const currentBVersion = (await galleryOne<{ sourceVersion: string }>('SELECT source_version as "sourceVersion" FROM gallery_photos WHERE gallery_id = 1 AND drive_file_id = ?', ['b']))!.sourceVersion;
await galleryRun('INSERT INTO gallery_own_photo_exclusions (gallery_id, drive_file_id, source_version, category) VALUES (1, ?, ?, ?)', ['b', currentBVersion, 'female']);
assert.equal((await request('/admin/1', 'PATCH', { faceReferenceFileId: 'b' })).status, 200);
assert.equal((await galleryOne<{ count: number }>('SELECT COUNT(*) as count FROM gallery_own_photo_exclusions WHERE gallery_id = 1'))?.count, 0, 'changing the face reference clears manual corrections');
const invalidReference = await request(`/public/selection/photos?token=${token}&filter=female`);
assert.equal(((await invalidReference.json()) as { ownPhotoStatus: string }).ownPhotoStatus, 'unavailable', 'a one-face reference cannot reuse stale matches');

source = { rootName: 'One folder', folders: [{ id: 'only', parentId: null, name: 'Any name' }, { id: 'inside', parentId: 'only', name: 'Nested' }], photos: [photo('one', 'only'), photo('nested-one', 'inside'), photo('outside', null)] };
await galleryRun("INSERT INTO galleries (id, title, public_key, drive_folder_id, pin_hash, status, selection_deadline_at) VALUES (2, 'One folder', 'one-folder', 'one-root', ?, 'open', '2099-01-01')", [await Bun.password.hash(password)]);
assert.equal((await request('/admin/2/sync', 'POST')).status, 400, 'a root photo cannot be left outside the only photography folder');
source = { ...source, photos: source.photos.filter((item) => item.id !== 'outside') };
assert.equal((await request('/admin/2/sync', 'POST')).status, 200, 'one photography folder can be synced');
assert.deepEqual(await galleryOne<{ camera1FolderId: string; camera2FolderId: string | null }>('SELECT camera_1_folder_id as "camera1FolderId", camera_2_folder_id as "camera2FolderId" FROM galleries WHERE id = 2'), { camera1FolderId: 'only', camera2FolderId: null });
const oneVerify = await request('/public/one-folder/verify', 'POST', { pin: password });
assert.equal(oneVerify.status, 200);
const { token: oneToken } = await oneVerify.json() as { token: string };
const onePhotos = await request(`/public/one-folder/photos?token=${oneToken}&filter=camera1`);
assert.equal(onePhotos.status, 200);
const oneData = await onePhotos.json() as { photos: Array<{ driveFileId: string }>; gallery: { cameraFolderCount: number; camerasAvailable: boolean } };
assert.deepEqual(oneData.photos.map((item) => item.driveFileId), ['one', 'nested-one']);
assert.equal(oneData.gallery.cameraFolderCount, 1);
assert.equal(oneData.gallery.camerasAvailable, false);

source = { rootName: 'Too many', folders: [{ id: 'a', parentId: null, name: 'A' }, { id: 'b', parentId: null, name: 'B' }, { id: 'c', parentId: null, name: 'C' }], photos: [photo('many', 'a')] };
assert.equal((await request('/admin/2/sync', 'POST')).status, 400, 'more than two root folders need a clear sync error');

source = { rootName: 'Flat', folders: [], photos: [photo('flat', null)] };
await galleryRun("INSERT INTO galleries (id, title, public_key, drive_folder_id, pin_hash, status, selection_deadline_at) VALUES (3, 'Flat', 'flat', 'flat-root', ?, 'open', '2099-01-01')", [await Bun.password.hash(password)]);
assert.equal((await request('/admin/3/sync', 'POST')).status, 200, 'existing flat galleries remain supported');
const flatVerify = await request('/public/flat/verify', 'POST', { pin: password });
assert.equal(flatVerify.status, 200);
const { token: flatToken } = await flatVerify.json() as { token: string };
const flatPhotos = await request(`/public/flat/photos?token=${flatToken}`);
assert.equal((await flatPhotos.json() as { gallery: { cameraFolderCount: number } }).gallery.cameraFolderCount, 0);
