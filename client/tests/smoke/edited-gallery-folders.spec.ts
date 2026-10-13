import { expect, test, type Page } from '@playwright/test';

const id = 'edited-folders';
const photo = (driveFileId: string, folderId: string | null) => ({ driveFileId, folderId, filename: `${driveFileId}.jpg`, width: 800, height: 600, downloadUrl: `https://example.test/${driveFileId}` });
const snapshot = {
    folders: [{ id: 'no-watermark', parentId: null, name: 'No Watermark' }, { id: 'empty', parentId: 'no-watermark', name: 'Empty' }],
    photos: [...Array.from({ length: 55 }, (_, index) => photo(`root-photo-${index}`, null)), photo('clean-photo', 'no-watermark')],
    archive: { filename: 'all.zip', downloadUrl: 'https://example.test/all.zip' },
};
async function seed(page: Page) {
    await page.addInitScript((galleryId) => { localStorage.setItem(`orbit:edit-results-token:${galleryId}`, 'old-token'); }, id);
}

for (const width of [320, 390, 1280]) {
    test(`edited folders preserve location and isolate photos at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await seed(page);
        await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
            if (path.endsWith('/edit-results')) return route.fulfill({ json: snapshot });
            return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6z7QAAAAASUVORK5CYII=', 'base64') });
        });
        await page.goto(`/culling/${id}?view=edit-results`);
        const grid = page.getByTestId('edited-gallery-grid');
        const folderBar = page.getByTestId('edited-folder-bar');
        await expect(folderBar).toBeVisible();
        await expect(folderBar.getByRole('link', { name: /Edited Photos/ })).toHaveAttribute('aria-current', 'page');
        await expect(folderBar.getByRole('link', { name: 'Open folder No Watermark', exact: true })).toBeVisible();
        await expect(folderBar).not.toContainText('55');
        await expect(folderBar.getByRole('button')).toHaveCount(0);
        expect(await folderBar.evaluate((element) => getComputedStyle(element).position)).toBe('fixed');
        const rootTab = folderBar.getByRole('link', { name: /Edited Photos/ });
        const cleanTab = folderBar.getByRole('link', { name: 'Open folder No Watermark', exact: true });
        const initialBarBox = await folderBar.boundingBox();
        const initialRootBox = await rootTab.boundingBox();
        const initialCleanBox = await cleanTab.boundingBox();
        expect(initialBarBox).not.toBeNull();
        expect(initialRootBox?.width).toBe(initialCleanBox?.width);
        expect(initialRootBox?.y).toBe(initialCleanBox?.y);
        await expect(grid.locator('img')).toHaveCount(54);
        await expect(grid.locator('img').first()).toHaveAttribute('src', /root-photo-0\/thumbnail/);
        await page.getByRole('button', { name: 'Next page', exact: true }).click();
        await expect(page).toHaveURL(/editedPage=2/);
        await expect(grid.locator('img')).toHaveAttribute('src', /root-photo-54\/thumbnail/);
        await folderBar.getByRole('link', { name: 'Open folder No Watermark', exact: true }).click();
        await expect(page).toHaveURL(/folder=no-watermark/);
        await expect(page).toHaveURL(/editedPage=1/);
        await expect(folderBar).toContainText('No Watermark');
        await expect(folderBar.getByRole('link', { name: 'Open folder No Watermark', exact: true })).toHaveAttribute('aria-current', 'page');
        await expect(grid.locator('img')).toHaveAttribute('src', /clean-photo\/thumbnail/);
        expect((await folderBar.boundingBox())?.height).toBe(initialBarBox?.height);
        expect((await cleanTab.boundingBox())?.width).toBe(initialCleanBox?.width);
        expect((await cleanTab.boundingBox())?.y).toBe(initialCleanBox?.y);
        expect(await page.evaluate(() => history.length)).toBeGreaterThan(1);
        await page.reload();
        await expect(grid.locator('img')).toHaveAttribute('src', /clean-photo\/thumbnail/);
        const footerTextBox = await page.getByText('The Orbit Photo. All rights reserved.').boundingBox();
        const folderBarBox = await folderBar.boundingBox();
        expect(footerTextBox).not.toBeNull();
        expect(folderBarBox).not.toBeNull();
        expect(folderBarBox!.y - (footerTextBox!.y + footerTextBox!.height)).toBeGreaterThan(0);
        expect(folderBarBox!.y - (footerTextBox!.y + footerTextBox!.height)).toBeLessThan(120);
        await page.screenshot({ path: `test-results/edited-folder-${width}.png`, fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await folderBar.getByRole('link', { name: 'Open folder No Watermark / Empty' }).click();
        await expect(page.getByText('This folder is empty.')).toBeVisible();
        await folderBar.getByRole('link', { name: /Edited Photos/ }).click();
        await expect(grid.locator('img').first()).toHaveAttribute('src', /root-photo-0\/thumbnail/);
        await expect(page.getByText('Page 1 of 2')).toBeVisible();
        await page.goto(`/culling/${id}?view=edit-results&folder=removed`);
        await expect(page).not.toHaveURL(/folder=/);
        await expect(grid.locator('img').first()).toHaveAttribute('src', /root-photo-0\/thumbnail/);
    });
}

test('rapid Next clicks advance directly to the latest edited page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seed(page);
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
        if (path.endsWith('/edit-results')) return route.fulfill({ json: { folders: snapshot.folders, photos: Array.from({ length: 220 }, (_, index) => photo(`rapid-photo-${index}`, null)) } });
        return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6z7QAAAAASUVORK5CYII=', 'base64') });
    });
    await page.goto(`/culling/${id}?view=edit-results`);
    await expect(page.getByText('Page 1 of 5')).toBeVisible();
    await page.evaluate(async () => {
        for (let index = 0; index < 3; index++) {
            document.querySelector<HTMLButtonElement>('[aria-label="Next page"]')?.click();
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
    });
    await expect(page.getByText('Page 4 of 5')).toBeVisible();
    await expect(page).toHaveURL(/editedPage=4/);
    await expect(page.getByTestId('edited-gallery-grid').locator('img').first()).toHaveAttribute('src', /rapid-photo-162\/thumbnail/);
});

test('401 clears the edited session and accepts a fresh password', async ({ page }) => {
    await seed(page);
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
        if (url.pathname.endsWith('/edit-results/verify')) return route.fulfill({ json: { token: 'fresh-token', expiresAt: null } });
        if (url.pathname.endsWith('/edit-results')) return url.searchParams.get('token') === 'old-token'
            ? route.fulfill({ status: 401, json: { error: 'Edited session expired. Enter your password again.' } })
            : route.fulfill({ json: { photos: [], folders: [] } });
        return route.fulfill({ json: {} });
    });
    await page.goto(`/culling/${id}?view=edit-results`);
    await expect(page.getByLabel('Edited photos password', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate((galleryId) => localStorage.getItem(`orbit:edit-results-token:${galleryId}`), id)).toBeNull();
    await page.getByLabel('Edited photos password', { exact: true }).fill('new-password');
    await page.getByRole('button', { name: 'Unlock Edited Photos' }).click();
    await expect(page.getByText('No edited photos are available.')).toBeVisible();
});

test('malformed photo IDs show a retry error without requesting undefined media', async ({ page }) => {
    await seed(page);
    const invalidRequests: string[] = [];
    page.on('request', (request) => { if (request.url().includes('/photos/undefined/')) invalidRequests.push(request.url()); });
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        if (new URL(route.request().url()).pathname.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
        return route.fulfill({ json: { photos: [{ filename: 'broken.jpg' }] } });
    });
    await page.goto(`/culling/${id}?view=edit-results`);
    await expect(page.getByRole('alert')).toContainText('Edited photo data is incomplete');
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    expect(invalidRequests).toEqual([]);
});
