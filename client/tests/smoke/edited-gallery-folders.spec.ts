import { expect, test, type Page } from '@playwright/test';

const id = 'edited-folders';
const photo = (driveFileId: string, folderId: string | null) => ({ driveFileId, folderId, filename: `${driveFileId}.jpg`, mimeType: 'image/jpeg', width: 800, height: 600, downloadUrl: `https://example.test/${driveFileId}` });
const snapshot = {
    rootFolderName: 'Wedding Ges',
    folders: [{ id: 'no-watermark', parentId: null, name: 'No Watermark' }, { id: 'empty', parentId: 'no-watermark', name: 'Empty' }],
    photos: [...Array.from({ length: 55 }, (_, index) => photo(`root-photo-${index}`, null)), photo('clean-photo', 'no-watermark')],
    archive: { filename: 'all.zip', downloadUrl: 'https://example.test/all.zip' },
};
async function seed(page: Page) {
    await page.addInitScript((galleryId) => { localStorage.setItem(`orbit:edit-results-token:${galleryId}`, 'old-token'); localStorage.setItem(`orbit:edit-results-guide:${galleryId}`, 'seen'); }, id);
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
        const folderTrigger = folderBar.getByRole('button', { name: /Choose folder, current:/ });
        const folderPanel = page.getByTestId('edited-folder-panel');
        await expect(folderBar).toHaveCount(0);
        await expect(page.getByTestId('edited-folder-tiles').getByRole('link', { name: 'Open folder No Watermark' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Wedding Ges' })).toBeVisible();
        await expect(page.getByTestId('edited-folder-tiles')).toContainText('1 item · 1 folder');
        await expect(page.getByRole('button', { name: /Download No Watermark photos as ZIP/ })).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Photos' })).toBeVisible();
        const rootPhotosHeadingX = await page.getByRole('heading', { name: 'Photos & Video' }).evaluate((element) => element.getBoundingClientRect().x);
        const rootLastFolderTile = page.getByRole('link', { name: 'Open folder No Watermark' }).locator('xpath=..');
        expect(await rootLastFolderTile.evaluate((element) => getComputedStyle(element).borderBottomWidth)).toBe('1px');
        await expect(grid.locator('img')).toHaveCount(54);
        await expect(grid.locator('img').first()).toHaveAttribute('src', /root-photo-0\/thumbnail/);
        await page.getByRole('button', { name: 'Next page', exact: true }).click();
        await expect(page).toHaveURL(/editedPage=2/);
        await expect(grid.locator('img')).toHaveAttribute('src', /root-photo-54\/thumbnail/);
        await page.getByTestId('edited-folder-tiles').getByRole('link', { name: 'Open folder No Watermark' }).click();
        const downloadHere = page.getByRole('button', { name: 'Download Photos Here' });
        if (width < 640) expect((await downloadHere.boundingBox())?.width).toBe(width < 390 ? 112 : 128);
        const folderPhotosHeading = page.getByRole('heading', { name: 'Photos & Video' });
        await expect(folderPhotosHeading).toBeVisible();
        const folderPhotosHeadingX = await folderPhotosHeading.evaluate((element) => element.getBoundingClientRect().x);
        expect(folderPhotosHeadingX).toBe(rootPhotosHeadingX);
        const folderLastTile = page.getByRole('link', { name: 'Open folder Empty' }).locator('xpath=..');
        expect(await folderLastTile.evaluate((element) => getComputedStyle(element).borderBottomWidth)).toBe('1px');
        await expect(folderBar).toBeVisible();
        await expect(folderTrigger).toHaveAttribute('aria-expanded', 'false');
        await expect(folderTrigger).toContainText('No Watermark');
        await expect(folderBar).not.toContainText('55');
        expect(await folderBar.evaluate((element) => getComputedStyle(element).position)).toBe('fixed');
        const initialBarBox = await folderBar.boundingBox();
        expect(initialBarBox).not.toBeNull();
        const breadcrumb = page.getByRole('navigation', { name: 'Folder breadcrumb' });
        await expect(breadcrumb).toContainText('Edited Photos');
        await expect(breadcrumb).toContainText('No Watermark');
        await folderTrigger.click();
        await expect(folderPanel).toHaveAttribute('aria-hidden', 'false');
        await expect(folderPanel.getByRole('link', { name: 'Edited Photos' })).toBeVisible();
        await expect(folderPanel.getByRole('link', { name: 'Open folder No Watermark', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(folderTrigger).toBeFocused();
        await expect(folderPanel).toHaveAttribute('aria-hidden', 'true');
        await folderTrigger.click();
        await folderPanel.getByRole('link', { name: 'Open folder No Watermark', exact: true }).click();
        await expect(page).toHaveURL(/folder=no-watermark/);
        await expect(page).not.toHaveURL(/editedPage=1/);
        await expect(folderTrigger).toContainText('No Watermark');
        await expect(folderTrigger).toHaveAttribute('aria-expanded', 'false');
        await expect(grid.locator('img')).toHaveAttribute('src', /clean-photo\/thumbnail/);
        await expect(page.getByRole('link', { name: 'Back to Edited Photos' })).toBeVisible();
        expect((await folderBar.boundingBox())?.height).toBe(initialBarBox?.height);
        expect(await page.evaluate(() => history.length)).toBeGreaterThan(1);
        await page.reload();
        await expect(grid.locator('img')).toHaveAttribute('src', /clean-photo\/thumbnail/);
        const footerTextBox = await page.locator('footer p').first().boundingBox();
        const instagramLink = page.getByRole('link', { name: '@theorbitphoto on Instagram' });
        await expect(instagramLink).toHaveCSS('font-size', '12px');
        expect((await instagramLink.boundingBox())?.height).toBeGreaterThanOrEqual(44);
        const folderBarBox = await folderBar.boundingBox();
        expect(footerTextBox).not.toBeNull();
        expect(folderBarBox).not.toBeNull();
        expect(folderBarBox!.y - (footerTextBox!.y + footerTextBox!.height)).toBeGreaterThan(0);
        expect(folderBarBox!.y - (footerTextBox!.y + footerTextBox!.height)).toBeLessThan(120);
        await page.screenshot({ path: `test-results/edited-folder-${width}.png`, fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await folderTrigger.click();
        await folderPanel.getByRole('link', { name: 'Open folder No Watermark / Empty' }).click();
        await expect(page.getByText('This folder is empty.')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Back to No Watermark' })).toBeVisible();
        await folderTrigger.click();
        await folderPanel.getByRole('link', { name: 'Edited Photos' }).click();
        await expect(folderBar).toHaveCount(0);
        await expect(grid.locator('img').first()).toHaveAttribute('src', /root-photo-0\/thumbnail/);
        await expect(page.getByText('Page 1 of 2')).toBeVisible();
        await page.goto(`/culling/${id}?view=edit-results&folder=removed`);
        await expect(page).not.toHaveURL(/folder=/);
        await expect(grid.locator('img').first()).toHaveAttribute('src', /root-photo-0\/thumbnail/);
    });
}

test('root folder row and folder breadcrumb align the Photos & Video section', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await seed(page);
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
        if (path.endsWith('/edit-results')) return route.fulfill({ json: { folders: [{ id: 'no-watermark', parentId: null, name: 'No Watermark' }], photos: [photo('root-photo', null), photo('folder-photo', 'no-watermark')] } });
        return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6z7QAAAAASUVORK5CYII=', 'base64') });
    });
    await page.goto(`/culling/${id}?view=edit-results`);
    const rootHeading = page.getByRole('heading', { name: 'Photos & Video' });
    const rootBox = await rootHeading.boundingBox();
    expect(rootBox).not.toBeNull();
    await page.getByRole('link', { name: 'Open folder No Watermark' }).click();
    const folderBox = await page.getByRole('heading', { name: 'Photos & Video' }).boundingBox();
    expect(folderBox).not.toBeNull();
    expect(folderBox!.x).toBe(rootBox!.x);
    expect(folderBox!.y).toBe(rootBox!.y);
});

for (const theme of ['black', 'white']) {
    test(`folder picker handles long names, many folders, and outside dismissal in ${theme}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 320, height: 700 });
        await seed(page);
        await page.addInitScript(({ galleryId, colorTheme }) => { localStorage.setItem(`orbit_culling_theme_${galleryId}`, colorTheme); }, { galleryId: id, colorTheme: theme });
        const folders = [
            ...Array.from({ length: 30 }, (_, index) => ({ id: `folder-${index}`, parentId: null, name: `Folder ${index + 1}` })),
            { id: 'details', parentId: 'folder-0', name: 'Details And Decoration' },
        ];
        await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
            if (path.endsWith('/edit-results')) return route.fulfill({ json: { folders, photos: [photo('detail-photo', 'details')] } });
            return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6z7QAAAAASUVORK5CYII=', 'base64') });
        });
        await page.goto(`/culling/${id}?view=edit-results`);
        await expect(page.getByTestId('edited-folder-tiles').getByRole('link', { name: 'Open folder Folder 1', exact: true })).toBeVisible();
        const rootFolderNames = await page.getByTestId('edited-folder-tiles').locator('a').evaluateAll((links) => links.map((link) => link.textContent?.trim()));
        expect(rootFolderNames.slice(0, 4)).toEqual(['Folder 1', 'Folder 2', 'Folder 3', 'Folder 4']);
        await page.getByTestId('edited-folder-tiles').getByRole('link', { name: 'Open folder Folder 1', exact: true }).click();
        const trigger = page.getByRole('button', { name: /Choose folder, current:/ });
        const panel = page.getByTestId('edited-folder-panel');
        await trigger.click();
        await expect(panel).toHaveAttribute('aria-hidden', 'false');
        await expect(panel).toHaveCSS('opacity', '1');
        await page.screenshot({ path: testInfo.outputPath('folder-picker-open.png') });
        expect(await panel.locator('[class*="overflow-y-auto"]').evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
        expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        await page.keyboard.press('Tab');
        await expect(panel.getByRole('button', { name: 'Close folders' })).toBeFocused();
        await page.getByTestId('gallery-header').click({ position: { x: 150, y: 10 } });
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await trigger.click();
        await panel.getByRole('button', { name: 'Close folders' }).click();
        await expect(trigger).toBeFocused();
        await trigger.click();
        await panel.getByRole('link', { name: 'Open folder Folder 1 / Details And Decoration' }).click();
        await expect(page).toHaveURL(/folder=details/);
        await expect(trigger).toContainText('Details And Decoration');
        await expect(page.getByTestId('edited-gallery-grid').locator('img')).toHaveAttribute('src', /detail-photo\/thumbnail/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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

test('folder-only root opens nested folders and keeps empty folders navigable', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await seed(page);
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
        if (path.endsWith('/edit-results')) return route.fulfill({ json: { folders: snapshot.folders, photos: [photo('clean-photo', 'no-watermark')] } });
        return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6z7QAAAAASUVORK5CYII=', 'base64') });
    });
    await page.goto(`/culling/${id}?view=edit-results`);
    await expect(page.getByTestId('edited-folder-tiles').getByRole('link', { name: 'Open folder No Watermark' })).toBeVisible();
    await expect(page.getByText('No edited photos are available.')).toHaveCount(0);
    await expect(page.getByTestId('edited-gallery-grid')).toHaveCount(0);
    await page.getByRole('link', { name: 'Open folder No Watermark' }).first().click();
    await expect(page.getByTestId('edited-folder-tiles').getByRole('link', { name: 'Open folder Empty' })).toBeVisible();
    await expect(page.getByTestId('edited-gallery-grid').locator('img')).toHaveCount(1);
    await page.getByTestId('edited-folder-tiles').getByRole('link', { name: 'Open folder Empty' }).click();
    await expect(page.getByText('This folder is empty.')).toBeVisible();
    await expect(page.getByText('This folder is empty.')).toHaveCSS('font-size', '15px');
    await page.getByRole('link', { name: 'Back to No Watermark' }).click();
    await expect(page).toHaveURL(/folder=no-watermark/);
    await page.getByRole('link', { name: 'Back to Edited Photos' }).click();
    await expect(page).not.toHaveURL(/folder=/);
});

test('switching folders from the bottom picker returns to the new folder start', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 600 });
    await seed(page);
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
        if (path.endsWith('/edit-results')) return route.fulfill({ json: {
            folders: [{ id: 'second', parentId: null, name: 'Second Folder' }, { id: 'first-folder', parentId: null, name: 'First Folder' }],
            photos: [...Array.from({ length: 54 }, (_, index) => photo(`first-${index}`, null)), ...Array.from({ length: 54 }, (_, index) => photo(`first-folder-${index}`, 'first-folder')), ...Array.from({ length: 54 }, (_, index) => photo(`second-${index}`, 'second'))],
        } });
        return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6z7QAAAAASUVORK5CYII=', 'base64') });
    });
    await page.goto(`/culling/${id}?view=edit-results`);
    await expect(page.getByTestId('edited-gallery-grid').locator('article')).toHaveCount(54);
    await page.getByRole('link', { name: 'Open folder First Folder' }).click();
    await expect(page.getByTestId('edited-folder-bar')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await page.getByRole('button', { name: /Choose folder, current:/ }).click();
    await page.getByTestId('edited-folder-panel').getByRole('link', { name: 'Open folder Second Folder' }).click();
    await expect(page).toHaveURL(/folder=second/);
    await expect(page.getByTestId('edited-gallery-grid').locator('img').first()).toHaveAttribute('src', /second-0\/thumbnail/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(100);
});

test('folder toolbar ZIP tracks the worker job and automatically downloads the completed ZIP', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await seed(page);
    let created = false;
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
        if (path.endsWith('/edit-results/folders/no-watermark/archive/jobs') && route.request().method() === 'POST') {
            expect(url.searchParams.get('scope')).toBe('direct');
            created = true;
            return route.fulfill({ status: 202, json: { jobId: 'a'.repeat(32), status: 'queued', total: 1 } });
        }
        if (path.endsWith(`/edit-results/archive/jobs/${'a'.repeat(32)}`)) {
            return route.fulfill({ json: created ? { status: 'completed', processed: 1, total: 1, filename: 'No Watermark.zip', downloadUrl: 'https://worker.example.test/v1/archive/download/job?ticket=ticket' } : { status: 'queued', processed: 0, total: 1 } });
        }
        if (path.endsWith('/edit-results')) return route.fulfill({ json: snapshot });
        return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6z7QAAAAASUVORK5CYII=', 'base64') });
    });
    await page.route('https://worker.example.test/**', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="No Watermark.zip"' }, body: 'zip' }));
    await page.goto(`/culling/${id}?view=edit-results`);
    await expect(page.getByRole('button', { name: /Download No Watermark photos as ZIP/ })).toHaveCount(0);
    await page.getByRole('link', { name: 'Open folder No Watermark' }).click();
    const downloadButton = page.getByRole('button', { name: 'Download Photos Here' });
    await expect(downloadButton).toBeVisible();
    const download = page.waitForEvent('download');
    await downloadButton.click();
    await expect.poll(() => created).toBe(true);
    expect((await download).suggestedFilename()).toBe('No Watermark.zip');
    await expect(downloadButton).toBeVisible({ timeout: 5000 });
    await expect(page.locator('p[role="status"]').filter({ hasText: 'Download starting' })).toHaveClass(/sr-only/);
});

test('folder header downloads only the open folder even when a gallery ZIP exists', async ({ page }) => {
    await seed(page);
    let directStarts = 0;
    let publishedArchiveRequests = 0;
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
        if (path.endsWith('/edit-results/folders/no-watermark/archive/jobs') && route.request().method() === 'POST') {
            expect(url.searchParams.get('scope')).toBe('direct');
            directStarts += 1;
            return route.fulfill({ status: 202, json: { jobId: 'c'.repeat(32), status: 'queued', total: 1 } });
        }
        if (path.endsWith(`/edit-results/archive/jobs/${'c'.repeat(32)}`)) {
            return route.fulfill({ json: { status: 'completed', processed: 1, total: 1, filename: 'No Watermark.zip', downloadUrl: 'https://worker.example.test/v1/archive/download/direct?ticket=ticket' } });
        }
        if (path.endsWith('/edit-results/archive/download-url')) {
            publishedArchiveRequests += 1;
            return route.fulfill({ json: { downloadUrl: snapshot.archive.downloadUrl, filename: snapshot.archive.filename } });
        }
        if (path.endsWith('/edit-results')) return route.fulfill({ json: snapshot });
        return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6z7QAAAAASUVORK5CYII=', 'base64') });
    });
    await page.route('https://worker.example.test/**', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="No Watermark.zip"' }, body: 'zip' }));
    await page.goto(`/culling/${id}/edited`);
    await expect(page.getByRole('button', { name: 'Download All Photos' })).toBeVisible();
    await page.getByRole('link', { name: 'Open folder No Watermark' }).click();
    const folderDownload = page.getByRole('button', { name: 'Download Photos Here' });
    await expect(folderDownload).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Folder breadcrumb' }).getByRole('button')).toHaveCount(0);
    const automaticDownload = page.waitForEvent('download');
    await folderDownload.click();
    expect((await automaticDownload).suggestedFilename()).toBe('No Watermark.zip');
    expect(directStarts).toBe(1);
    expect(publishedArchiveRequests).toBe(0);
    await expect(folderDownload).toBeVisible();
    const manualDownload = page.waitForEvent('download');
    await folderDownload.click();
    expect((await manualDownload).suggestedFilename()).toBe('No Watermark.zip');
    expect(directStarts).toBe(1);
    await page.getByRole('link', { name: 'Open folder Empty' }).click();
    await expect(page.getByRole('button', { name: 'Download Photos Here' })).toHaveCount(0);
});

test('Download All Photos requests only root photos even when a gallery ZIP exists', async ({ page }) => {
    await seed(page);
    let created = false;
    let publishedArchiveRequests = 0;
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
        if (path.endsWith('/edit-results/archive/jobs') && route.request().method() === 'POST') {
            expect(url.searchParams.get('scope')).toBe('direct');
            created = true;
            return route.fulfill({ status: 202, json: { jobId: 'b'.repeat(32), status: 'queued', total: 55 } });
        }
        if (path.endsWith(`/edit-results/archive/jobs/${'b'.repeat(32)}`)) {
            return route.fulfill({ json: created ? { status: 'completed', processed: 55, total: 55, filename: 'Edited Photos.zip', downloadUrl: 'https://worker.example.test/v1/archive/download/job?ticket=ticket' } : { status: 'queued', processed: 0, total: 55 } });
        }
        if (path.endsWith('/edit-results/archive/download-url')) {
            publishedArchiveRequests += 1;
            return route.fulfill({ json: { downloadUrl: snapshot.archive.downloadUrl, filename: snapshot.archive.filename } });
        }
        if (path.endsWith('/edit-results')) return route.fulfill({ json: snapshot });
        return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6z7QAAAAASUVORK5CYII=', 'base64') });
    });
    await page.route('https://worker.example.test/**', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="Edited Photos.zip"' }, body: 'zip' }));
    await page.goto(`/culling/${id}/edited`);
    const downloadAll = page.getByRole('button', { name: 'Download All Photos' });
    await expect(downloadAll).toBeVisible();
    const download = page.waitForEvent('download');
    await downloadAll.click();
    await expect.poll(() => created).toBe(true);
    expect((await download).suggestedFilename()).toBe('Edited Photos.zip');
    expect(publishedArchiveRequests).toBe(0);
    await expect(page.locator('p[role="status"]').filter({ hasText: 'Download starting' })).toHaveClass(/sr-only/);
    await expect(downloadAll).toBeVisible();
});

test('root download is hidden when photos exist only in subfolders', async ({ page }) => {
    await seed(page);
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
        if (path.endsWith('/edit-results')) return route.fulfill({ json: { ...snapshot, photos: [photo('clean-photo', 'no-watermark')] } });
        return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6z7QAAAAASUVORK5CYII=', 'base64') });
    });
    await page.goto(`/culling/${id}/edited`);
    await expect(page.getByRole('link', { name: 'Open folder No Watermark' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download All Photos' })).toHaveCount(0);
});

test('failed ZIP job shows the worker failure without leaving a spinner', async ({ page }) => {
    await seed(page);
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
        if (path.endsWith('/edit-results/archive/jobs') && route.request().method() === 'POST') return route.fulfill({ status: 202, json: { jobId: 'd'.repeat(32), status: 'queued', total: 55 } });
        if (path.endsWith(`/edit-results/archive/jobs/${'d'.repeat(32)}`)) return route.fulfill({ json: { status: 'failed', processed: 0, total: 55, error: 'The photo source is unavailable. Please contact the photographer.' } });
        if (path.endsWith('/edit-results')) return route.fulfill({ json: snapshot });
        return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6z7QAAAAASUVORK5CYII=', 'base64') });
    });
    await page.goto(`/culling/${id}/edited`);
    await page.getByRole('button', { name: 'Download All Photos' }).click();
    await expect(page.getByRole('alert')).toContainText('The photo source is unavailable. Please contact the photographer.');
    await expect(page.getByRole('button', { name: 'Download All Photos' })).toBeEnabled();
});

test('Edited Photos guide opens once, restarts from Help, and closes with Escape', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.addInitScript((galleryId) => { localStorage.setItem(`orbit:edit-results-token:${galleryId}`, 'old-token'); }, id);
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
        if (path.endsWith('/edit-results')) return route.fulfill({ json: snapshot });
        return route.fulfill({ json: {} });
    });
    await page.goto(`/culling/${id}?view=edit-results`);
    const guide = page.getByTestId('edited-photos-guide');
    await expect(guide).toBeVisible();
    await expect(guide.getByRole('heading', { name: 'Open a folder' })).toBeVisible();
    await expect(guide.getByRole('button', { name: 'Close Edited Photos guide' })).toBeFocused();
    await guide.getByRole('button', { name: 'Next' }).click();
    await expect(guide.getByRole('heading', { name: 'Switch folders' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(guide).not.toBeVisible();
    await expect.poll(() => page.evaluate((galleryId) => localStorage.getItem(`orbit:edit-results-guide:${galleryId}`), id)).toBe('seen');
    await page.reload();
    await expect(guide).not.toBeVisible();
    await page.getByRole('button', { name: 'Edited Photos guide' }).click();
    await expect(guide.getByRole('heading', { name: 'Open a folder' })).toBeVisible();
    await guide.getByRole('button', { name: 'Close Edited Photos guide' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('guide offers a complete ZIP download for a flat gallery', async ({ page }) => {
    await page.addInitScript((galleryId) => { localStorage.setItem(`orbit:edit-results-token:${galleryId}`, 'old-token'); }, id);
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
        if (path.endsWith('/edit-results')) return route.fulfill({ json: { folders: [], photos: [photo('only-photo', null)] } });
        return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6z7QAAAAASUVORK5CYII=', 'base64') });
    });
    await page.goto(`/culling/${id}?view=edit-results`);
    const guide = page.getByTestId('edited-photos-guide');
    await expect(guide.getByRole('heading', { name: 'Browse your photos' })).toBeVisible();
    await expect(guide).toContainText('Step 1 of 2');
    await guide.getByRole('button', { name: 'Next' }).click();
    await expect(guide.getByRole('heading', { name: 'Download your photos' })).toBeVisible();
    await expect(guide).toContainText('Download All Photos');
    await guide.getByRole('button', { name: 'View photos' }).click();
    await expect(page.getByTestId('edited-gallery-grid')).toBeVisible();
    await expect(page.getByTestId('edited-folder-bar')).toHaveCount(0);
});

test('password unlock opens the guide in light theme without requiring media', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((galleryId) => localStorage.setItem(`orbit_culling_theme_${galleryId}`, 'white'), id);
    const mediaRequests: string[] = [];
    page.on('request', (request) => { if (/\/(thumbnail|preview)$/.test(new URL(request.url()).pathname)) mediaRequests.push(request.url()); });
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true, workflow: 'delivery_only' } });
        if (path.endsWith('/edit-results/verify')) return route.fulfill({ json: { token: 'fresh-token', expiresAt: null } });
        if (path.endsWith('/edit-results')) return route.fulfill({ json: { folders: snapshot.folders, photos: [] } });
        return route.fulfill({ json: {} });
    });
    await page.goto(`/culling/${id}?view=edit-results`);
    await page.getByLabel('Edited photos password', { exact: true }).fill('fresh-password');
    await page.getByRole('button', { name: 'Unlock Edited Photos' }).click();
    const guide = page.getByTestId('edited-photos-guide');
    await expect(guide.getByRole('heading', { name: 'Open a folder' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(guide.getByRole('button', { name: 'Next' })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('edited-guide-light-mobile.png') });
    expect(mediaRequests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('expired access does not open the Edited Photos guide', async ({ page }) => {
    await page.addInitScript((galleryId) => { localStorage.setItem(`orbit:edit-results-token:${galleryId}`, 'old-token'); }, id);
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: false, isExpired: true } });
        if (path.endsWith('/edit-results')) return route.fulfill({ json: snapshot });
        return route.fulfill({ json: {} });
    });
    await page.goto(`/culling/${id}?view=edit-results`);
    await expect(page.getByText('Edited Photos access expired')).toBeVisible();
    await expect(page.getByTestId('edited-photos-guide')).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Edited Photos guide' })).toHaveCount(0);
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
