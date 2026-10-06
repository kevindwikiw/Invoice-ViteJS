import { expect, test, type Page } from '@playwright/test';

const id = 'delivery-ux';
const archive = { filename: 'edited.zip', downloadUrl: 'https://drive.google.com/uc?export=download&id=archive' };
const photos = Array.from({ length: 54 }, (_, index) => ({
    id: index + 1, galleryId: 1, driveFileId: `photo-${index}`, filename: `photo-${index}.jpg`,
    mimeType: 'image/jpeg', width: 1200, height: 900, displayOrder: index, createdAt: '',
}));
const edited = photos.map((photo) => ({
    ...photo,
    filename: `edited-${photo.filename}`,
    thumbnailUrl: `/api/public/galleries/${id}/edit-results/photos/${photo.driveFileId}/thumbnail`,
    previewUrl: `/api/public/galleries/${id}/edit-results/photos/${photo.driveFileId}/preview`,
    downloadUrl: `https://drive.google.com/uc?export=download&id=${photo.driveFileId}`,
}));

async function setup(page: Page, theme = 'black', connection?: { saveData: boolean; effectiveType: string }) {
    await page.addInitScript(({ id, theme, connection }) => {
        localStorage.setItem(`orbit_culling_token_${id}`, 'culling-token');
        localStorage.setItem(`orbit_culling_tutorial_${id}`, '1');
        localStorage.setItem(`orbit_culling_theme_${id}`, theme);
        localStorage.setItem(`orbit:edit-results-token:${id}`, 'edited-token');
        if (connection) Object.defineProperty(navigator, 'connection', { configurable: true, value: connection });
    }, { id, theme, connection });
    await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (/\/(thumbnail|preview)$/.test(path)) {
            await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#687b70"/><circle cx="600" cy="450" r="200" fill="#cbd5d1"/></svg>' });
        } else if (path.endsWith('/edit-results/status')) {
            await route.fulfill({ json: { available: true, photoCount: 54 } });
        } else if (path.endsWith('/edit-results')) {
            await route.fulfill({ json: { photos: edited, archive, publishedAt: '2026-10-01T00:00:00Z' } });
        } else if (path.endsWith('/photos')) {
            await route.fulfill({ json: {
                gallery: { id: 1, title: 'Delivery Gallery', status: 'open', maxSelections: 30, hasEditResults: true, tutorialSampleSlots: [], selectionDeadlineAt: '2099-01-01T00:00:00Z', serverTime: new Date().toISOString() },
                photos, page: 1, pageSize: 54, total: 54, totalPages: 1,
                selectedDriveFileIds: [photos[2]!.driveFileId], selectedPhotos: [photos[2]],
            } });
        } else if (path.endsWith('/face-search/status')) {
            await route.fulfill({ json: { available: false, status: 'unavailable' } });
        } else {
            await route.fulfill({ json: {} });
        }
    });
    await page.goto(`/culling/${id}`);
    await expect(page.getByRole('button', { name: 'All Photos', exact: true })).toBeVisible();
}

async function openPicked(page: Page) {
    const allPhotos = page.getByRole('button', { name: 'All Photos', exact: true });
    await allPhotos.click();
    if (await page.getByRole('menu', { name: 'All Photos views' }).count() === 0) await allPhotos.click();
    await page.getByRole('menuitem', { name: 'Picked', exact: true }).click();
}

for (const theme of ['black', 'white']) {
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        test(`delivery tabs preserve picks at ${viewport.width}px in ${theme}`, async ({ page }, testInfo) => {
            await page.setViewportSize(viewport);
            await setup(page, theme);
            await page.getByRole('button', { name: 'Select photo-0.jpg', exact: true }).click();
            await openPicked(page);
            await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(2);
            const draft = await page.evaluate((id) => localStorage.getItem(`orbit_culling_selected_${id}`), id);
            await page.getByRole('button', { name: 'Open photo-0.jpg', exact: true }).click();
            await expect(page.getByTestId('gallery-lightbox-stage')).toBeVisible();
            // Trigger a view change while the overlay covers the toolbar.
            await page.getByRole('button', { name: 'Edited Photos', exact: true }).dispatchEvent('click');
            await expect(page.getByTestId('gallery-lightbox-stage')).toHaveCount(0);
            const grid = page.getByTestId('edited-gallery-grid');
            await expect(grid.locator('article')).toHaveCount(54);
            await expect(page.getByRole('heading', { name: 'Edited Photos' })).toHaveCount(0);
            await expect(page.getByText('54 photos', { exact: true })).toHaveCount(0);
            await expect(page.getByTestId('gallery-toolbar').getByRole('button', { name: 'Download All (.zip)' })).toBeVisible();
            await expect(grid.locator('img[loading="eager"]')).toHaveCount(10);
            await expect(grid.locator('img[loading="lazy"]')).toHaveCount(44);
            const styles = await grid.locator('img').first().evaluate((img) => {
                const frame = img.closest('button')!.getBoundingClientRect();
                return { filter: getComputedStyle(img).filter, ratio: frame.width / frame.height };
            });
            expect(styles.filter).toBe('none');
            expect(styles.ratio).toBeCloseTo(4 / 3, 2);
            await page.screenshot({ path: testInfo.outputPath('edited-toolbar.png') });
            await page.mouse.wheel(0, 600);
            await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
            await expect(page.getByTestId('gallery-toolbar')).toBeInViewport();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            await openPicked(page);
            await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(2);
            await expect(page.getByRole('button', { name: 'Download All (.zip)' })).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Remove photo-0.jpg', exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Remove photo-2.jpg', exact: true })).toBeVisible();
            expect(await page.evaluate((id) => localStorage.getItem(`orbit_culling_selected_${id}`), id)).toBe(draft);
            await page.getByRole('button', { name: 'Picked', exact: true }).click();
            await page.getByRole('menuitemradio', { name: 'All Photos', exact: true }).click();
            await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(54);
        });
    }
}

for (const connection of [{ saveData: true, effectiveType: '4g' }, { saveData: false, effectiveType: '2g' }]) {
    test(`lightbox skips neighbor prefetch with ${connection.saveData ? 'Save Data' : '2g'}`, async ({ page }) => {
        await setup(page, 'black', connection);
        const previews = new Set<string>();
        page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('/preview')) previews.add(new URL(request.url()).pathname); });
        await page.getByRole('button', { name: 'Edited Photos', exact: true }).click();
        await page.getByRole('button', { name: 'Open edited-photo-0.jpg', exact: true }).click();
        await expect(page.getByTestId('gallery-lightbox-image')).toHaveAttribute('src', /photo-0\/preview/);
        await expect(page.getByTestId('gallery-lightbox-stage').locator('img').first()).toHaveCSS('filter', /blur/);
        // Allow the neighbor prefetch timer to fire before checking network activity.
        await page.waitForTimeout(800);
        expect(previews.size).toBe(1);
        await page.keyboard.press('ArrowRight');
        await expect(page.getByTestId('gallery-lightbox-image')).toHaveAttribute('src', /photo-1\/preview/);
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('gallery-lightbox-stage')).toHaveCount(0);
    });
}
