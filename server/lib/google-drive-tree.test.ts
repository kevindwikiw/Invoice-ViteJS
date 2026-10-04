import { expect, spyOn, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { listDrivePhotoTree } from './google-drive';

test('Drive tree follows pagination and folders, ignores shortcuts, and rejects partial reads', async () => {
    const originalConfig = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'test@example.test', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
    const folder = (id: string) => ({ id, name: id, mimeType: 'application/vnd.google-apps.folder' });
    const photo = (id: string) => ({ id, name: `${id}.jpg`, mimeType: 'image/jpeg' });
    let mode = 'normal';
    let secondPageRead = false;
    const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'test', expires_in: 3600 });
        if (url.pathname.endsWith('/files')) {
            expect(url.searchParams.get('q')).toContain('trashed = false');
            expect(url.searchParams.get('q')).toContain('application/vnd.google-apps.folder');
            if (mode === 'incomplete') return Response.json({ incompleteSearch: true });
            if (url.searchParams.get('q')?.startsWith("'root'")) {
                if (url.searchParams.get('pageToken') === 'next') {
                    secondPageRead = true;
                    return Response.json({ files: [photo('root-photo'), folder('child')] });
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
        expect(secondPageRead).toBe(true);
        expect(tree.folders).toEqual([{ id: 'child', name: 'child', parentId: null }, { id: 'nested', name: 'nested', parentId: 'child' }]);
        expect(tree.photos.map(({ id, folderId }) => ({ id, folderId }))).toEqual([
            { id: 'root-photo', folderId: null }, { id: 'child-photo', folderId: 'child' }, { id: 'nested-photo', folderId: 'nested' },
        ]);
        mode = 'denied';
        await expect(listDrivePhotoTree('root')).rejects.toThrow('Permission denied');
        mode = 'incomplete';
        await expect(listDrivePhotoTree('root')).rejects.toThrow('incomplete folder listing');
    } finally {
        fetchMock.mockRestore();
        if (originalConfig === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
        else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = originalConfig;
    }
});
