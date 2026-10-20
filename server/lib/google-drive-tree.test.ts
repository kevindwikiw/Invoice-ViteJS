import { expect, spyOn, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { fetchDriveFile, fetchDriveVideo, listDrivePhotoTree, listDrivePhotos } from './google-drive';

test('Drive tree follows pagination and folders, ignores shortcuts, and rejects partial reads', async () => {
    const originalConfig = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'test@example.test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
    const folder = (id: string) => ({ id, name: id, mimeType: 'application/vnd.google-apps.folder' });
    const photo = (id: string) => ({ id, name: `${id}.jpg`, mimeType: 'image/jpeg' });
    const video = (id: string) => ({ id, name: `${id}.mp4`, mimeType: 'video/mp4' });
    let mode = 'normal';
    let secondPageRead = false;
    let thumbnailAttempts = 0;
    let tokenIssues = 0;
    let videoRange = '';
    let hangVideoResponse = false;
    const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.hostname === 'oauth2.googleapis.com') {
            tokenIssues += 1;
            return Response.json({ access_token: tokenIssues > 1 ? 'refreshed' : 'test', expires_in: 3600 });
        }
        if (url.pathname.endsWith('/files/video-id')) {
            videoRange = new Headers(init?.headers).get('Range') || '';
            if (hangVideoResponse) return await new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
            });
            if (videoRange === 'bytes=99-100') return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */10', 'Accept-Ranges': 'bytes' } });
            return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.close(); } }), { status: 206, headers: { 'Content-Range': 'bytes 2-3/10', 'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4' } });
        }
        if (url.hostname === 'lh3.googleusercontent.com') {
            thumbnailAttempts += 1;
            if (mode === 'expired-thumbnail') return new Response('expired link', { status: 404 });
            if (mode === 'retry-thumbnail' && thumbnailAttempts === 1) return new Response('busy', { status: 503, headers: { 'Retry-After': '0' } });
            const authorization = new Headers(init?.headers).get('Authorization');
            if (mode === 'refresh-token' && authorization === 'Bearer test') return new Response('expired', { status: 401 });
            return new Response('image', { headers: { 'Content-Type': 'image/jpeg' } });
        }
        if (url.pathname.endsWith('/files')) {
            expect(url.searchParams.get('q')).toContain('trashed = false');
            if (url.searchParams.get('q')?.startsWith("'selection'")) {
                expect(url.searchParams.get('q')).not.toContain("mimeType contains 'video/'");
                return Response.json({ files: [photo('selection-image')] });
            }
            expect(url.searchParams.get('q')).toContain('application/vnd.google-apps.folder');
            expect(url.searchParams.get('q')).toContain("mimeType contains 'video/'");
            if (mode === 'incomplete') return Response.json({ incompleteSearch: true });
            if (url.searchParams.get('q')?.startsWith("'root'")) {
                if (mode === 'video-only') return Response.json({ files: [video('only-video')] });
                if (url.searchParams.get('pageToken') === 'next') {
                    secondPageRead = true;
                    return Response.json({ files: [photo('root-photo'), video('root-video'), folder('child')] });
                }
                return Response.json({ files: [folder('child'), { id: 'shortcut', mimeType: 'application/vnd.google-apps.shortcut' }, { id: 'pdf', mimeType: 'application/pdf' }], nextPageToken: 'next' });
            }
            if (url.searchParams.get('q')?.startsWith("'child'")) return Response.json({ files: [photo('child-photo'), folder('nested')] });
            return Response.json({ files: [photo('nested-photo'), folder('root')] });
        }
        const id = url.pathname.split('/').at(-1)!;
        if (mode === 'denied' && id === 'child') return Response.json({ error: { message: 'Permission denied' } }, { status: 403 });
        return Response.json(folder(id));
    }, { preconnect: globalThis.fetch.preconnect }));
    try {
        const tree = await listDrivePhotoTree('root');
        expect((await listDrivePhotos('selection')).map((item) => item.mimeType)).toEqual(['image/jpeg']);
        expect(secondPageRead).toBe(true);
        expect(tree.rootName).toBe('root');
        expect(tree.folders).toEqual([{ id: 'child', name: 'child', parentId: null }, { id: 'nested', name: 'nested', parentId: 'child' }]);
        expect(tree.photos.map(({ id, folderId }) => ({ id, folderId }))).toEqual([
            { id: 'root-photo', folderId: null }, { id: 'root-video', folderId: null }, { id: 'child-photo', folderId: 'child' }, { id: 'nested-photo', folderId: 'nested' },
        ]);
        const rangedVideo = await fetchDriveVideo('video-id', 'bytes=2-3');
        expect(rangedVideo.status).toBe(206);
        expect(rangedVideo.headers.get('Content-Range')).toBe('bytes 2-3/10');
        expect(videoRange).toBe('bytes=2-3');
        expect((await fetchDriveVideo('video-id', 'bytes=99-100')).status).toBe(416);
        hangVideoResponse = true;
        await expect(fetchDriveVideo('video-id', undefined, 5)).rejects.toThrow('Google Drive response timed out.');
        hangVideoResponse = false;
        mode = 'video-only';
        const videoOnlyTree = await listDrivePhotoTree('root');
        expect(videoOnlyTree.photos.map((item) => item.mimeType)).toEqual(['video/mp4']);
        mode = 'denied';
        await expect(listDrivePhotoTree('root')).rejects.toThrow('Permission denied');
        mode = 'incomplete';
        await expect(listDrivePhotoTree('root')).rejects.toThrow('incomplete folder listing');
        mode = 'retry-thumbnail';
        thumbnailAttempts = 0;
        expect((await fetchDriveFile('photo', 'https://lh3.googleusercontent.com/photo=s320', 320, true)).ok).toBe(true);
        expect(thumbnailAttempts).toBe(2);
        mode = 'refresh-token';
        thumbnailAttempts = 0;
        expect((await fetchDriveFile('photo', 'https://lh3.googleusercontent.com/photo=s320', 320, true)).ok).toBe(true);
        expect(thumbnailAttempts).toBe(2);
        expect(tokenIssues).toBe(2);
        mode = 'expired-thumbnail';
        thumbnailAttempts = 0;
        await expect(fetchDriveFile('photo', 'https://lh3.googleusercontent.com/photo=s320', 320)).rejects.toThrow('expired link');
        expect(thumbnailAttempts).toBe(1);
    } finally {
        fetchMock.mockRestore();
        if (originalConfig === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
        else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = originalConfig;
    }
});
