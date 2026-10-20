import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { Hono } from 'hono';

const storage = await import('../db/galleries');
const { galleryRun: run, galleryOne: one, galleryAll: all } = storage;
await storage.ensureGalleryStorage();
const galleryReads: string[] = [];
let photosInFlight = false;
let settingsReadInParallel = false;
mock.module('../db/galleries', () => ({
    ...storage,
    galleryOne: async (sql: string, params: unknown[] = []) => {
        if (/FROM galleries WHERE/.test(sql)) galleryReads.push(sql);
        return one(sql, params);
    },
    galleryAll: async (sql: string, params: unknown[] = []) => {
        if (/FROM gallery_photos .*LIMIT/s.test(sql)) {
            photosInFlight = true;
            await Bun.sleep(20);
            photosInFlight = false;
        }
        if (/FROM gallery_settings/.test(sql) && photosInFlight) settingsReadInParallel = true;
        return all(sql, params);
    },
}));

const imageCalls: Array<{ id: string; url?: string; width?: number }> = [];
const metadataCalls: string[] = [];
let failMetadata = true;
let failDriveTransient = false;
let expireRepairedThumbnail = false;
let releaseMetadata!: () => void;
let metadataStarted!: () => void;
const metadataGate = new Promise<void>((resolve) => { releaseMetadata = resolve; });
const metadataStart = new Promise<void>((resolve) => { metadataStarted = resolve; });
mock.module('../lib/google-drive', () => ({
    getReadonlyDriveToken: async () => ({ accessToken: 'test', expiresAt: Date.now() + 1000 }),
    hasAnyoneViewerFolderAccess: async () => true,
    listDrivePhotos: async () => [],
    listDrivePhotoTree: async () => ({ rootName: 'Edited Source', photos: [], folders: [] }),
    getDrivePhotoMetadata: async (id: string) => {
        metadataCalls.push(id);
        if (id === 'transient' && failMetadata) throw new Error('Temporary metadata failure');
        if (id === 'concurrent') { metadataStarted(); await metadataGate; }
        if (id === 'sync-race') await run("UPDATE gallery_photos SET thumbnail_url = 'https://images.test/new-sync' WHERE drive_file_id = ?", [id]);
        const revision = id === 'stale' && metadataCalls.filter((value) => value === id).length > 1 ? '-v2' : '';
        return { id, name: `${id}.jpg`, mimeType: 'image/jpeg', thumbnailLink: id === 'unavailable' ? undefined : `https://images.test/fresh/${id}${revision}`, webViewLink: 'https://drive.google.com/file/view' };
    },
    fetchDriveFile: async (id: string, url?: string, width?: number) => {
        imageCalls.push({ id, url, width });
        if (id === 'healthy' && failDriveTransient) throw Object.assign(new Error('Temporary Drive gateway timeout'), { status: 504 });
        if (url?.includes('/expired/')) throw Object.assign(new Error('Expired thumbnail'), { status: 404 });
        if (expireRepairedThumbnail && url === 'https://images.test/fresh/stale') throw Object.assign(new Error('Refreshed link expired'), { status: 404 });
        return new Response(url ? 'thumbnail' : 'large-original', { headers: { 'content-type': 'image/jpeg' } });
    },
    fetchDriveVideo: async () => new Response('video', { headers: { 'content-type': 'video/mp4' } }),
}));

const { publicGalleriesRouter } = await import('../routes/galleries');
const app = new Hono();
app.route('/public', publicGalleriesRouter);
const password = 'selection-password';
await run("INSERT INTO galleries (id, title, public_key, drive_folder_id, pin_hash, status, photo_count, selection_deadline_at) VALUES (1, 'Selection', 'selection', 'folder', ?, 'open', 9, '2099-01-01')", [await Bun.password.hash(password)]);
const ids = ['empty', 'stale', 'healthy', 'concurrent', 'unavailable', 'transient', 'sync-race', 'next-page', 'last-page'];
for (const [index, id] of ids.entries()) {
    const url = id === 'healthy' ? 'https://images.test/healthy' : id === 'empty' || id === 'unavailable' ? null : `https://images.test/expired/${id}`;
    await run('INSERT INTO gallery_photos (gallery_id, drive_file_id, filename, mime_type, thumbnail_url, display_order) VALUES (1, ?, ?, ?, ?, ?)', [id, `${id}.jpg`, 'image/jpeg', url, index]);
}
await run("INSERT INTO gallery_selections (gallery_id, selected_drive_file_id, selected_filename) VALUES (1, 'stale', 'stale.jpg')");
const unlocked = await app.request('/public/selection/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: password }) });
assert.equal(unlocked.status, 200);
assert.equal(galleryReads.length, 1, 'PIN verification must read gallery only once');
const { token } = await unlocked.json() as { token: string };
galleryReads.length = 0;
const listed = await app.request(`/public/selection/photos?token=${token}&includeSelections=1&pageSize=7`);
assert.equal(listed.status, 200);
const payload = await listed.json() as { photos: Array<{ driveFileId: string; photoToken: string }>; selectedDriveFileIds: string[]; totalPages: number };
assert.equal(galleryReads.length, 1, 'Photo list must read gallery only once');
assert.equal(settingsReadInParallel, true, 'Settings must overlap the photo query');
assert.equal(imageCalls.length, 0, 'Metadata listing must not download images');
assert.equal(metadataCalls.length, 0, 'Metadata listing must not contact Drive');
assert.equal(payload.photos.length, 7);
assert.ok(payload.photos.every((photo) => !('thumbnailUrl' in photo) && !('webViewUrl' in photo)), 'Public metadata must not duplicate URLs embedded in photo tokens');
assert.equal(payload.totalPages, 2);
assert.deepEqual(payload.selectedDriveFileIds, ['stale']);
const photoTokens = new Map(payload.photos.map((photo) => [photo.driveFileId, photo.photoToken]));
const image = (id: string, variant = 'thumbnail') => app.request(`/public/selection/photos/${id}/${variant}?token=${token}&pt=${photoTokens.get(id)}`);

assert.equal(await (await image('empty')).text(), 'thumbnail');
assert.equal(imageCalls.filter((call) => call.id === 'empty').length, 1);
assert.equal(imageCalls.find((call) => call.id === 'empty')!.width, 320);
assert.equal((await one<{ url: string }>("SELECT thumbnail_url as url FROM gallery_photos WHERE drive_file_id = 'empty'"))!.url, 'https://images.test/fresh/empty');

await image('stale');
await image('stale', 'preview');
await image('stale');
assert.equal(metadataCalls.filter((id) => id === 'stale').length, 1, 'Old signed tokens must reuse the refreshed URL');
assert.equal(imageCalls.filter((call) => call.id === 'stale' && call.url?.includes('/expired/')).length, 1);
assert.equal((await one<{ url: string }>("SELECT thumbnail_url as url FROM gallery_photos WHERE drive_file_id = 'stale'"))!.url, 'https://images.test/fresh/stale');
expireRepairedThumbnail = true;
assert.equal((await image('stale')).status, 200);
assert.equal((await one<{ url: string }>("SELECT thumbnail_url as url FROM gallery_photos WHERE drive_file_id = 'stale'"))!.url, 'https://images.test/fresh/stale-v2');
const metadataBeforeLegacy = metadataCalls.length;
assert.equal((await app.request(`/public/selection/photos/stale/thumbnail?token=${token}`)).status, 200);
assert.equal(metadataCalls.length, metadataBeforeLegacy, 'Session-only requests must reuse repaired database metadata');
failDriveTransient = true;
assert.equal((await image('healthy')).status, 502, 'Transient thumbnail failures should fail quickly for a client retry');
failDriveTransient = false;
await image('healthy');
assert.equal(metadataCalls.includes('healthy'), false);

const concurrent = Promise.all([image('concurrent'), image('concurrent', 'preview'), image('concurrent')]);
await metadataStart;
await Bun.sleep(20);
assert.equal(metadataCalls.filter((id) => id === 'concurrent').length, 1);
releaseMetadata();
assert.ok((await concurrent).every((response) => response.status === 200));

assert.equal((await image('unavailable')).status, 502);
assert.equal(imageCalls.some((call) => call.id === 'unavailable'), false, 'Unavailable thumbnail must not download an original');
assert.equal((await image('transient')).status, 502);
failMetadata = false;
assert.equal((await image('transient')).status, 200, 'A failed refresh must not poison retries');
assert.equal(metadataCalls.filter((id) => id === 'transient').length, 2);
await image('sync-race');
assert.equal((await one<{ url: string }>("SELECT thumbnail_url as url FROM gallery_photos WHERE drive_file_id = 'sync-race'"))!.url, 'https://images.test/new-sync');
assert.equal(imageCalls.some((call) => !call.url), false, 'No grid request may fetch the original');

assert.equal((await app.request('/public/selection/photos?token=invalid')).status, 401);
const callsBefore = imageCalls.length;
assert.equal((await app.request('/public/selection/photos/stale/thumbnail?pt=invalid')).status, 401);
assert.equal(imageCalls.length, callsBefore);
await run("UPDATE galleries SET status = 'closed' WHERE id = 1");
assert.equal((await app.request(`/public/selection/photos?token=${token}`)).status, 403);
await run("UPDATE galleries SET status = 'open', selection_deadline_at = '2000-01-01' WHERE id = 1");
assert.equal((await app.request(`/public/selection/photos?token=${token}`)).status, 403);
