import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page, wedding: boolean) {
    const id = wedding ? 'selfie-wedding' : 'selfie-edited';
    const token = 'edited-selfie-token';
    const photos: Array<{ driveFileId: string; filename: string; mimeType: string; folderId: string | null; width: number; height: number; displayOrder: number; downloadUrl: string }> = Array.from({ length: 55 }, (_, index) => ({ driveFileId: `edited-${index}`, filename: `Edited-${index}.jpg`, mimeType: 'image/jpeg', folderId: index % 2 ? 'family' : 'ceremony', width: 800, height: 600, displayOrder: index, downloadUrl: 'https://download.test/photo' }));
    const state = { searches: 0, rawSearches: 0, indexing: false, empty: false, failure: false, expired: false, faceSearchAvailable: true, sourceVersion: 'edited-v1', soloOnly: false, holdVideoResponse: false, videoRequests: 0 };
    let releaseVideoResponse!: () => void;
    const videoResponse = new Promise<void>((resolve) => { releaseVideoResponse = resolve; });
    await page.addInitScript(({ id, token }) => {
        localStorage.setItem(`orbit:edit-results-token:${id}`, token);
        localStorage.setItem(`orbit:edit-results-guide:${id}`, 'seen');
        localStorage.setItem(`orbit_culling_tutorial_${id}`, 'seen');
        localStorage.setItem(`orbit_culling_token_${id}`, 'selection-token');
    }, { id, token });
    const rawCalls: string[] = [];
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { workflow: wedding ? 'delivery_only' : 'selection_delivery', title: 'Alya & Rafi Wedding', available: !state.expired, isExpired: state.expired, photoCount: 55 } });
        if (path.endsWith('/edit-results/face-search/status')) return route.fulfill({ json: { available: state.faceSearchAvailable, status: state.faceSearchAvailable ? 'ready' : 'unavailable', processed: state.faceSearchAvailable ? 55 : 0, total: 55 } });
        if (path.endsWith('/edit-results/face-search')) {
            expect(route.request().headers()['x-edit-results-token']).toBe(token);
            expect(route.request().headers()['x-gallery-token']).toBeUndefined();
            state.searches++;
            if (state.expired) return route.fulfill({ status: 403, json: { error: 'Edited photos access expired.', code: 'EDIT_RESULTS_EXPIRED' } });
            state.soloOnly = route.request().postData()?.includes('\r\ntrue\r\n') ?? false;
            if (state.failure) return route.fulfill({ status: 503, json: { error: 'Face search is temporarily unavailable.' } });
            if (state.indexing && state.searches === 1) return route.fulfill({ status: 202, json: { status: 'indexing', job: { processed: 5, total: 55 }, matches: [] } });
            return route.fulfill({ json: { status: 'complete', sourceVersion: state.sourceVersion, total: 55, matches: state.empty ? [] : photos.map((photo) => ({ ...photo, sourceVersion: state.sourceVersion })) } });
        }
        if (path.endsWith('/edit-results')) return route.fulfill({ json: { sourceVersion: state.sourceVersion, photos: photos.map((photo) => ({ ...photo, sourceVersion: state.sourceVersion })), folders: [{ id: 'ceremony', parentId: null, name: 'Ceremony' }, { id: 'family', parentId: 'ceremony', name: 'Family' }], archive: { filename: 'all.zip', downloadUrl: 'https://download.test/all.zip' } } });
        if (path.endsWith('/download-url')) return route.fulfill({ json: path.includes('/edited-video/') ? { filename: 'Highlights.mp4', downloadUrl: 'https://download.test/video' } : { filename: 'Edited-54.jpg', downloadUrl: 'https://download.test/photo' } });
        if (path.endsWith('/video')) {
            state.videoRequests++;
            if (state.holdVideoResponse) await videoResponse;
            return route.fulfill({ status: 206, headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': 'bytes 0-15/16' }, body: Buffer.from('not-a-real-video') });
        }
        if (!path.includes('/edit-results/')) {
            rawCalls.push(path);
            if (path.endsWith('/face-search/status')) return route.fulfill({ json: { available: true, status: 'ready', processed: 1, total: 1 } });
            const raw = { id: 1, galleryId: 1, driveFileId: 'raw-1', filename: 'Raw-1.jpg', mimeType: 'image/jpeg', width: 800, height: 600, displayOrder: 0, createdAt: '' };
            if (path.endsWith('/face-search')) { state.rawSearches++; return route.fulfill({ json: { status: 'complete', total: 1, matches: [raw] } }); }
            if (path.endsWith('/photos')) return route.fulfill({ json: { gallery: { id: 1, title: 'Alya & Rafi Wedding', status: 'open', serverTime: new Date().toISOString(), selectionDeadlineAt: new Date(Date.now() + 86400000).toISOString(), maxSelections: 70, tutorialSampleSlots: [] }, photos: [raw], total: 1, totalPages: 1, page: 1, selectedDriveFileIds: [] } });
        }
        return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#73837c"/></svg>' });
    });
    await page.route('https://download.test/**', (route) => {
        const video = new URL(route.request().url()).pathname.endsWith('/video');
        return route.fulfill({ headers: { 'Content-Disposition': `attachment; filename="${video ? 'Highlights.mp4' : 'Edited-54.jpg'}"` }, contentType: 'application/octet-stream', body: video ? 'video' : 'photo' });
    });
    const upload = async () => {
        const encoded = await page.evaluate(() => {
            const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
            const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#999'; ctx.fillRect(0, 0, 32, 32);
            return canvas.toDataURL('image/png').split(',')[1]!;
        });
        await page.getByLabel('Choose selfie', { exact: true }).setInputFiles({ name: 'selfie.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') });
    };
    return { id, photos, state, rawCalls, upload, releaseVideoResponse };
}

test('Edited Selfie results disappear immediately when the worker goes offline', async ({ page }) => {
    await page.clock.install();
    const { id, state, upload } = await fixture(page, false);
    await page.goto(`/culling/${id}?view=edit-results`);
    await page.getByRole('button', { name: 'Selfie', exact: true }).click();
    await upload();
    await page.getByRole('button', { name: 'Show 55 photos' }).click();
    await expect(page.getByTestId('edited-gallery-grid').locator('article')).toHaveCount(54);

    state.faceSearchAvailable = false;
    await page.clock.fastForward(30_100);
    await expect(page).not.toHaveURL(/view=selfie/);
    await expect(page.getByTestId('edited-folder-tiles')).toBeVisible();
    await expect(page.getByTestId('edited-gallery-grid')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Filter by selfie' })).toHaveCount(0);
});

for (const wedding of [false, true]) for (const width of [320, 390, 1280]) {
    test(`${wedding ? 'Wedding' : 'Edited'} Selfie searches all folders and preserves navigation at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        if (width === 390) await page.emulateMedia({ reducedMotion: 'reduce' });
        const { id, state, rawCalls, upload } = await fixture(page, wedding);
        if (width === 390) await page.addInitScript((galleryId) => localStorage.setItem(`orbit_culling_theme_${galleryId}`, 'white'), id);
        await page.goto(`/culling/${id}?view=edit-results&folder=family`);
        await expect(page.getByRole('heading', { name: 'Family', exact: true })).toBeVisible();
        const tabs = page.getByRole('navigation', { name: 'Gallery views' });
        await expect(tabs.getByRole('button', { name: 'Selfie', exact: true })).toBeEnabled();
        await tabs.getByRole('button', { name: 'Selfie', exact: true }).click();
        const modal = page.getByRole('dialog', { name: 'Filter by selfie' });
        await expect(modal).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(modal).toHaveCount(0);
        await expect(tabs.getByRole('button', { name: 'Selfie', exact: true })).toBeFocused();
        await tabs.getByRole('button', { name: 'Selfie', exact: true }).click();
        await upload();
        await modal.getByRole('button', { name: 'Show 55 photos' }).click();
        await expect(page).toHaveURL(/selfieSource=edited/);
        await expect(tabs.getByRole('button', { name: 'Selfie', exact: true })).toHaveAttribute('aria-pressed', 'true');
        const grid = page.getByTestId('edited-gallery-grid');
        await expect(grid.locator('article')).toHaveCount(54);
        await expect(grid.locator('img').first()).toHaveAttribute('src', /v=edited-v1/);
        await expect(grid.getByText('Ceremony / Family', { exact: true }).first()).toBeVisible();
        await expect(page.getByTestId('edited-folder-bar')).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath('edited-selfie-first-page.png') });
        await page.getByRole('button', { name: 'Next page', exact: true }).click();
        await expect(grid.locator('article')).toHaveCount(1);
        await expect(page).toHaveURL(/selfiePage=2/);
        await page.getByRole('button', { name: 'Open Edited-54.jpg', exact: true }).click();
        await expect(page.getByTestId('gallery-lightbox-image')).toHaveAttribute('src', /edited-54\/preview/);
        await page.getByRole('button', { name: 'Close photo preview' }).click();
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download Edited-54.jpg', exact: true }).click();
        expect((await downloaded).suggestedFilename()).toBe('Edited-54.jpg');
        await tabs.getByRole('button', { name: 'Edited Photos', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Family', exact: true })).toBeVisible();
        await expect(page.getByTestId('edited-folder-bar')).toBeVisible();
        await tabs.getByRole('button', { name: 'Selfie', exact: true }).click();
        await expect(modal).toHaveCount(0);
        await expect(grid.locator('article')).toHaveCount(1);
        expect(state.searches).toBe(1);
        await page.goBack();
        await expect(page.getByRole('heading', { name: 'Family', exact: true })).toBeVisible();
        await page.goForward();
        await expect(grid.locator('article')).toHaveCount(1);
        expect(rawCalls).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath('edited-selfie-results.png'), fullPage: true });
        await page.reload();
        await expect(page).toHaveURL(/selfieSource=edited/);
        await expect(page.getByRole('dialog', { name: 'Filter by selfie' })).toBeVisible();
        await expect(page.getByTestId('edited-folder-bar')).toHaveCount(0);
    });
}

test('Edited Selfie polls indexing in the modal, supports retry and empty results, and clears stale results', async ({ page }) => {
    const { id, state, upload } = await fixture(page, false);
    state.indexing = true;
    await page.goto(`/culling/${id}?view=edit-results`);
    await page.getByRole('button', { name: 'Selfie', exact: true }).click();
    await upload();
    await expect(page.getByText('Preparing face search 5 / 55')).toBeVisible();
    await page.getByRole('button', { name: 'Show 55 photos' }).click();
    expect(state.searches).toBe(2);
    await page.getByRole('button', { name: 'Selfie', exact: true }).click();
    state.failure = true;
    await upload();
    await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
    state.failure = false;
    state.empty = true;
    await page.getByRole('button', { name: 'Retry search', exact: true }).click();
    await page.getByRole('dialog', { name: 'Filter by selfie' }).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByText('No matching photos found.')).toBeVisible();
    state.sourceVersion = 'edited-v2';
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    await expect(page.getByRole('dialog', { name: 'Filter by selfie' })).toBeVisible();
});

test('a mixed gallery routes Selfie to the source view and retains independent results', async ({ page }) => {
    const { id, state, upload } = await fixture(page, false);
    await page.goto(`/culling/${id}?view=edit-results`);
    await page.getByRole('button', { name: 'Selfie', exact: true }).click();
    await upload();
    await page.getByRole('button', { name: 'Show 55 photos' }).click();
    await page.getByRole('button', { name: 'All Photos', exact: true }).click();
    await expect(page.getByTestId('gallery-grid')).toBeVisible();
    await page.getByRole('button', { name: 'Selfie', exact: true }).click();
    await upload();
    await page.getByRole('button', { name: 'Show 1 photos' }).click();
    await expect(page).toHaveURL(/selfieSource=selection/);
    await expect(page.getByTestId('gallery-grid').locator('img')).toHaveAttribute('src', /\/photos\/raw-1\/thumbnail/);
    await page.getByRole('button', { name: 'Edited Photos', exact: true }).click();
    await page.getByRole('button', { name: 'Selfie', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/culling/${id}/edited\\?view=selfie`));
    await expect(page.getByTestId('edited-gallery-grid').locator('img')).toHaveCount(54);
    expect(state.searches).toBe(1);
    expect(state.rawSearches).toBe(1);
});

test('an Edited Selfie deep link unlocks with the delivery password and keeps folder context', async ({ page }) => {
    const { id, rawCalls } = await fixture(page, false);
    await page.addInitScript((galleryId) => { localStorage.removeItem(`orbit:edit-results-token:${galleryId}`); localStorage.removeItem(`orbit_culling_token_${galleryId}`); }, id);
    await page.route(`**/api/public/galleries/${id}/edit-results/verify`, (route) => route.fulfill({ json: { token: 'edited-selfie-token', expiresAt: null } }));
    await page.goto(`/culling/${id}?view=selfie&selfieSource=edited&folder=family`);
    await expect(page).toHaveURL(new RegExp(`/culling/${id}/edited\\?folder=family&view=selfie|/culling/${id}/edited\\?view=selfie&folder=family`));
    await page.getByLabel('Edited photos password', { exact: true }).fill('delivery-password');
    await page.getByRole('button', { name: 'Unlock Edited Photos' }).click();
    await expect(page).toHaveURL(new RegExp(`/culling/${id}/edited\\?folder=family&view=selfie|/culling/${id}/edited\\?view=selfie&folder=family`));
    await expect(page.getByRole('dialog', { name: 'Filter by selfie' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Edited Photos', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Family', exact: true })).toBeVisible();
    expect(rawCalls).toEqual([]);
});

test('expired Edited access closes Selfie and removes cached photos and download controls', async ({ page }) => {
    const { id, state, upload } = await fixture(page, true);
    await page.goto(`/culling/${id}?view=edit-results&folder=family`);
    await page.getByRole('button', { name: 'Selfie', exact: true }).click();
    state.expired = true;
    await upload();
    await expect(page.getByRole('heading', { name: 'Edited Photos access expired' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Filter by selfie' })).toHaveCount(0);
    await expect(page.getByTestId('edited-gallery-grid')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Download All (.zip)' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Selfie', exact: true })).toHaveCount(0);
});

test('a Sync during Selfie search reconciles the edited snapshot before showing new matches', async ({ page }) => {
    const { id, state, upload } = await fixture(page, false);
    await page.goto(`/culling/${id}?view=edit-results&folder=family`);
    await page.getByRole('button', { name: 'Selfie', exact: true }).click();
    state.sourceVersion = 'edited-v2';
    await upload();
    await page.getByRole('button', { name: 'Show 55 photos' }).click();
    const grid = page.getByTestId('edited-gallery-grid');
    await expect(grid.locator('article')).toHaveCount(54);
    await expect(grid.locator('img').first()).toHaveAttribute('src', /v=edited-v2/);
    await page.getByRole('button', { name: 'Edited Photos', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Family', exact: true })).toBeVisible();
});

test('Edited Photos renders video tiles and opens a native, non-autoplay video player with download fallback', async ({ page }) => {
    const { id, photos, state, releaseVideoResponse } = await fixture(page, false);
    photos.unshift({ driveFileId: 'edited-video', filename: 'Highlights.mp4', mimeType: 'video/mp4', folderId: null, width: 1280, height: 720, displayOrder: -1, downloadUrl: 'https://download.test/video' });
    state.holdVideoResponse = true;
    await page.goto(`/culling/${id}?view=edit-results`);
    const tile = page.getByRole('article').filter({ hasText: 'Highlights.mp4' });
    await expect(tile.getByText('Video', { exact: true })).toBeVisible();
    await tile.getByRole('button', { name: 'Open Highlights.mp4' }).click();
    const player = page.getByTestId('gallery-lightbox-video');
    await expect(player).toHaveAttribute('controls', '');
    await expect(player).not.toHaveAttribute('autoplay', '');
    releaseVideoResponse();
    await expect(page.getByText('This video format cannot be played in this browser.')).toBeVisible();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Original' }).click();
    expect((await downloaded).suggestedFilename()).toBe('Highlights.mp4');
});
