import { expect, test, type Page, type Route } from '@playwright/test';
import type { FaceSearchResult } from '../../src/features/culling/client-gallery/face-search';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5174' });

const galleryId = 'batch-gallery';
const token = 'gallery-session-token';

function photo(index: number) {
    const padded = String(index).padStart(3, '0');
    return {
        id: index,
        galleryId: 1,
        driveFileId: `file-${padded}`,
        filename: `photo-${padded}.jpg`,
        mimeType: 'image/jpeg',
        width: index % 2 ? 6000 : 4000,
        height: index % 2 ? 4000 : 6000,
        displayOrder: index - 1,
        createdAt: '2026-09-02T03:00:00.000Z',
        photoToken: `photo-token-${padded}`,
    };
}

function gallery(deadline: string, serverTime = '2026-09-02T03:00:00.000Z') {
    return {
        id: 1,
        title: 'Full Frame Test Gallery',
        status: 'open',
        syncedAt: serverTime,
        photoCount: 101,
        selectionCount: 0,
        selectionDurationHours: 72,
        selectionDurationDays: 3,
        selectionDeadlineAt: deadline,
        isExpired: false,
        serverTime,
        maxSelections: 30,
        additionalLimit: 0,
        addon: { enabled: false, additionalLimit: 0, unitPrice: 10000, status: 'none' },
        tutorialSampleSlots: [1, 2, 3],
    };
}

function galleryWithTitle(title: string, deadline = '2026-09-05T03:00:00.000Z') {
    return { ...gallery(deadline), title };
}

async function installSession(page: Page, id = galleryId) {
    await page.route(`**/api/public/galleries/${id}/edit-results/status`, (route) => route.fulfill({ json: { workflow: 'selection_delivery', available: false, photoCount: 0, status: 'draft' } }));
    await page.addInitScript(({ galleryKey, galleryToken }) => {
        localStorage.setItem(`orbit_culling_token_${galleryKey}`, galleryToken);
        localStorage.setItem(`orbit_culling_tutorial_${galleryKey}`, '1');
    }, { galleryKey: id, galleryToken: token });
    await page.route('**/face-search/status', (route) => route.fulfill({
        status: 200,
        json: { available: false, status: 'unavailable', processed: 0, total: 0, code: 'worker_offline' },
    }));
}

async function mockFaceSearchAvailable(page: Page, id: string, status: 'not_indexed' | 'ready' = 'not_indexed') {
    await page.unroute('**/face-search/status');
    await page.route(`**/api/public/galleries/${id}/face-search/status`, (route) => route.fulfill({
        json: { available: true, status, processed: status === 'ready' ? 1 : 0, total: status === 'ready' ? 1 : 0 },
    }));
}

async function fulfillImage(route: Route, width: number, height: number) {
    await route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#718096"/><path d="M0 ${height} L${width / 2} 0 L${width} ${height} Z" fill="#e2e8f0"/></svg>`,
    });
}

async function expectLightboxFrame(page: Page, expectedRatio: number) {
    const image = page.getByTestId('gallery-lightbox-image');
    await expect(image).toBeVisible();
    const [stageBox, imageBox, footerBox] = await Promise.all([
        page.getByTestId('gallery-lightbox-stage').boundingBox(),
        image.boundingBox(),
        page.getByTestId('gallery-lightbox-footer').boundingBox(),
    ]);
    expect(stageBox).not.toBeNull();
    expect(imageBox).not.toBeNull();
    expect(footerBox).not.toBeNull();
    expect((stageBox?.y ?? 0) + (stageBox?.height ?? 0)).toBeLessThanOrEqual((footerBox?.y ?? 0) + 1);
    expect((imageBox?.y ?? 0) + (imageBox?.height ?? 0)).toBeLessThanOrEqual((footerBox?.y ?? 0) + 1);
    expect((imageBox?.width ?? 0) / (imageBox?.height ?? 1)).toBeCloseTo(expectedRatio, 1);
}

async function expectMobileGalleryViewport(page: Page, width: number, height: number) {
    await page.setViewportSize({ width, height });
    await expect(page.getByTestId('gallery-header')).toBeVisible();
    await expect(page.getByTestId('gallery-toolbar')).toBeVisible();
    await expect(page.getByTestId('gallery-toolbar').getByRole('button', { name: 'Submit', exact: true })).toHaveCount(0);

    const layout = await page.evaluate(() => {
        const grid = document.querySelector('[data-testid="gallery-grid"]')?.getBoundingClientRect();
        const visibleTiles = [...document.querySelectorAll('button[aria-label^="Open photo-"]')]
            .filter((node) => {
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0;
            })
            .length;

        return {
            scrollWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
            gridTop: grid?.top ?? Number.POSITIVE_INFINITY,
            visibleTiles,
        };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.gridTop).toBeLessThan(230);
    expect(layout.visibleTiles).toBeGreaterThanOrEqual(6);
}

async function expectToolbarAlignedWithGrid(page: Page) {
    const [toolbar, grid] = await Promise.all([
        page.getByTestId('gallery-toolbar-inner').boundingBox(),
        page.getByTestId('gallery-grid').boundingBox(),
    ]);
    expect(toolbar).not.toBeNull();
    expect(grid).not.toBeNull();
    expect(toolbar!.x).toBeCloseTo(grid!.x, 0);
    expect(toolbar!.x + toolbar!.width).toBeCloseTo(grid!.x + grid!.width, 0);
}

async function expectCompactCountdown(page: Page, width: number, height: number) {
    await page.setViewportSize({ width, height });
    const icon = await page.getByTestId('gallery-countdown-icon').boundingBox();
    const value = await page.getByTestId(width >= 640 ? 'gallery-countdown-value-desktop' : 'gallery-countdown-value').boundingBox();
    const themeToggle = page.getByRole('button', { name: /Switch to (white|black) mode/ });
    const themeBefore = await themeToggle.boundingBox();
    expect(icon).not.toBeNull();
    expect(value).not.toBeNull();
    const iconGap = (value?.x ?? 0) - ((icon?.x ?? 0) + (icon?.width ?? 0));
    expect(iconGap).toBeGreaterThanOrEqual(0);
    expect(iconGap).toBeLessThanOrEqual(6);
    await page.waitForTimeout(1_100);
    const themeAfter = await themeToggle.boundingBox();
    expect(Math.abs((themeAfter?.x ?? 0) - (themeBefore?.x ?? 0))).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('Edited Photos does not poll closed selection endpoints in the background', async ({ page }) => {
    const id = 'edited-with-closed-selection';
    let photoRequests = 0;
    let faceStatusRequests = 0;
    await page.addInitScript(({ galleryKey, galleryToken }) => {
        localStorage.setItem(`orbit_culling_token_${galleryKey}`, galleryToken);
        localStorage.setItem(`orbit:edit-results-token:${galleryKey}`, 'edited-session-token');
        localStorage.setItem(`orbit_culling_tutorial_${galleryKey}`, '1');
    }, { galleryKey: id, galleryToken: token });
    await page.route(`**/api/public/galleries/${id}/edit-results/status`, (route) => route.fulfill({ json: {
        workflow: 'selection_delivery', title: 'Closed Selection', available: true, photoCount: 1, status: 'open',
    } }));
    await page.route(`**/api/public/galleries/${id}/edit-results?*`, (route) => route.fulfill({ json: {
        title: 'Closed Selection', photos: [], folders: [], archive: null,
    } }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => {
        photoRequests += 1;
        return route.fulfill({ status: 403, json: { error: 'Gallery is closed.', code: 'GALLERY_CLOSED' } });
    });
    await page.route(`**/api/public/galleries/${id}/face-search/status`, (route) => {
        faceStatusRequests += 1;
        return route.fulfill({ status: 403, json: { error: 'Gallery is closed.', code: 'GALLERY_CLOSED' } });
    });

    await page.goto(`/culling/${id}?view=edit-results`);
    await expect(page.getByRole('button', { name: 'Edited Photos', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(300);
    expect(photoRequests).toBe(0);
    expect(faceStatusRequests).toBe(0);

    await page.getByRole('button', { name: 'All Photos', exact: true }).click();
    await expect.poll(() => photoRequests).toBeGreaterThan(0);
    await expect.poll(() => faceStatusRequests).toBeGreaterThan(0);
    await page.waitForTimeout(5_200);
    expect(faceStatusRequests).toBe(1);
});

async function chooseGalleryRefineView(page: Page, view: 'All Photos' | 'Picked' | 'Submitted') {
    const trigger = page.getByRole('navigation', { name: 'Gallery views' }).getByRole('button').first();
    const menu = page.getByRole('menu', { name: 'All Photos views' });
    await trigger.click();
    if (await menu.count() === 0) await trigger.click();
    await menu.getByText(view, { exact: true }).click();
}

function selfieTab(page: Page) {
    return page.getByRole('navigation', { name: 'Gallery views' }).getByRole('button', { name: 'Selfie', exact: true });
}

test('opens photo 101 on page 2 by driveFileId and keeps the full frame above the footer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installSession(page);
    const externalFontRequests: string[] = [];
    page.on('request', (request) => {
        if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) externalFontRequests.push(request.url());
    });

    let secondPageRequests = 0;
    await page.route(`**/api/public/galleries/${galleryId}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${galleryId}/photos?*`, async (route) => {
        const requestUrl = new URL(route.request().url());
        const requestedPage = Number(requestUrl.searchParams.get('page') || 1);
        if (requestedPage === 2) secondPageRequests += 1;
        await route.fulfill({
            json: {
                gallery: gallery('2026-09-05T03:00:00.000Z'),
                photos: requestedPage === 1
                    ? Array.from({ length: 54 }, (_, index) => photo(index + 1))
                    : Array.from({ length: 47 }, (_, index) => photo(index + 55)),
                page: requestedPage,
                pageSize: 54,
                total: 101,
                totalPages: 2,
                selectedDriveFileIds: [],
                selectedPhotos: [],
            },
        });
    });
    await page.route(`**/api/public/galleries/${galleryId}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
    await page.route(`**/api/public/galleries/${galleryId}/photos/*/preview?*`, (route) => {
        const fileId = new URL(route.request().url()).pathname.match(/\/photos\/(file-\d+)\/preview$/)?.[1];
        if (fileId === 'file-100') return fulfillImage(route, 1067, 1600);
        if (fileId === 'file-099') return fulfillImage(route, 1200, 1200);
        return fulfillImage(route, 1600, 1067);
    });

    await page.goto(`/culling/${galleryId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Full Frame Test Gallery' })).toBeVisible();
    await expect(page.getByTestId('gallery-header').getByTestId('gallery-countdown')).toBeVisible();
    await expect(page.getByTestId('gallery-event-bar')).toHaveCount(0);
    expect((await page.getByTestId('gallery-header').boundingBox())?.height).toBeLessThan(110);
    await expect(page.getByTestId('gallery-toolbar').getByRole('heading')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(54);
    const grid = page.getByTestId('gallery-grid');
    await expect(grid.locator('img[fetchpriority="high"]')).toHaveCount(1);
    await expect(grid.locator('img[loading="eager"]')).toHaveCount(10);
    await expect(grid.locator('img[loading="lazy"]')).toHaveCount(44);
    await expect(grid.locator('img').first()).toHaveCSS('opacity', '1');
    await expect(grid.locator('img').first()).toHaveAttribute('width', '6000');
    await expect(page.getByRole('img', { name: 'Orbit Logo' })).toHaveAttribute('width', '791');
    await expect(page.getByRole('region', { name: 'Notifications', includeHidden: true })).toHaveCount(1);
    await expect(page.getByRole('link', { name: '@theorbitphoto on Instagram' })).toContainText('@theorbitphoto');
    expect(await page.evaluate(async () => (await document.fonts.load('400 16px Inter')).length)).toBeGreaterThan(0);
    expect(externalFontRequests).toEqual([]);
    await expectMobileGalleryViewport(page, 320, 568);
    await expectToolbarAlignedWithGrid(page);
    await expect(page.getByTestId('gallery-header').getByRole('heading', { level: 1 })).toHaveCSS('font-size', '14px');
    await expect(page.getByTestId('selection-action-bar')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/culling-local-fonts-320.png' });
    await expectMobileGalleryViewport(page, 375, 667);
    await expectMobileGalleryViewport(page, 390, 844);
    await expectCompactCountdown(page, 320, 568);
    await expect(page.getByTestId('selection-summary').getByRole('status')).toHaveCount(1);
    await expectCompactCountdown(page, 390, 844);
    await page.screenshot({ path: 'test-results/culling-local-fonts-mobile.png' });
    await expectCompactCountdown(page, 1440, 900);
    await expectToolbarAlignedWithGrid(page);
    await expect(page.getByText('Photo Selection', { exact: true })).toBeVisible();
    await expect(page.getByTestId('gallery-header').getByRole('heading', { level: 1 })).toHaveCSS('font-size', '18px');
    await expect(page.getByTestId('gallery-toolbar').getByRole('button', { name: 'All Photos' })).toHaveCSS('font-size', '15px');
    await expect(page.getByTestId('gallery-toolbar').getByTestId('selection-summary')).toContainText('0/30 selected');
    await expect(page.getByTestId('selection-action-bar')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/culling-local-fonts-desktop.png' });
    await page.setViewportSize({ width: 1920, height: 900 });
    await expectToolbarAlignedWithGrid(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await expectToolbarAlignedWithGrid(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect(page.getByTestId('gallery-header').getByTestId('gallery-countdown')).toBeVisible();
    await expect(page.getByTestId('gallery-toolbar').getByTestId('selection-summary')).toContainText('0/30 selected');
    await page.screenshot({ path: 'test-results/culling-local-fonts-1024.png' });
    await expectMobileGalleryViewport(page, 414, 896);

    const nextPage = page.getByRole('button', { name: 'Next' });
    await nextPage.scrollIntoViewIfNeeded();
    await nextPage.click();
    await expect.poll(() => secondPageRequests).toBeGreaterThan(0);
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(47);

    const lastPhoto = page.getByRole('button', { name: 'Open photo-101.jpg' });
    await lastPhoto.scrollIntoViewIfNeeded();
    await expect(lastPhoto).toBeVisible();
    await lastPhoto.click();

    await expect(page.getByTestId('gallery-lightbox-footer').getByText('photo-101.jpg', { exact: true })).toBeVisible();
    const image = page.getByTestId('gallery-lightbox-image');
    await expect(image).toHaveAttribute('src', /\/file-101\/preview\?/);
    await expectLightboxFrame(page, 1600 / 1067);

    await page.getByRole('button', { name: 'Previous photo' }).click();
    await expect(image).toHaveAttribute('src', /\/file-100\/preview\?/);
    await expectLightboxFrame(page, 1067 / 1600);

    await page.getByRole('button', { name: 'Previous photo' }).click();
    await expect(image).toHaveAttribute('src', /\/file-099\/preview\?/);
    await expectLightboxFrame(page, 1);

    await page.setViewportSize({ width: 375, height: 667 });
    await expectLightboxFrame(page, 1);
    await page.setViewportSize({ width: 414, height: 896 });
    await expectLightboxFrame(page, 1);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expectLightboxFrame(page, 1);
});

test('reveals Request More without adding a toolbar row or shifting the gallery', async ({ page }) => {
    const id = 'request-more-threshold';
    await page.setViewportSize({ width: 320, height: 568 });
    await installSession(page, id);
    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {
        contactWhatsappUrl: '+628123456789', requestMoreMessage: 'Request {{requested_count}} photos',
    } }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({ json: {
        gallery: { ...gallery('2026-09-05T03:00:00.000Z'), maxSelections: 6, photoCount: 6 },
        photos: Array.from({ length: 6 }, (_, index) => photo(index + 1)),
        page: 1, pageSize: 54, total: 6, totalPages: 1, selectedDriveFileIds: [], selectedPhotos: [],
    } }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
    await page.goto(`/culling/${id}`);
    const toolbar = page.getByTestId('gallery-toolbar');
    const moreGroup = page.getByTestId('request-more-group');
    await expect(moreGroup).toHaveAttribute('aria-hidden', 'true');
    const initialToolbar = await toolbar.boundingBox();
    const initialMore = await moreGroup.boundingBox();
    const summary = page.getByTestId('selection-summary');
    await expect(summary).toHaveCSS('translate', '64px');
    const initialSummary = await summary.boundingBox();
    await page.screenshot({ path: 'test-results/request-more-before-threshold-320.png' });
    for (let index = 1; index <= 5; index += 1) {
        await page.getByRole('button', { name: `Select photo-${String(index).padStart(3, '0')}.jpg` }).click();
    }
    await expect(moreGroup).toHaveAttribute('aria-hidden', 'false');
    await expect(moreGroup).toHaveCSS('opacity', '1');
    await expect(summary).toHaveCSS('translate', 'none');
    await expect(page.getByRole('button', { name: 'Request more editing slots' })).toBeVisible();
    const shownToolbar = await toolbar.boundingBox();
    const shownMore = await moreGroup.boundingBox();
    const shownSummary = await summary.boundingBox();
    expect(shownToolbar?.height).toBe(initialToolbar?.height);
    expect(shownMore?.x).toBeCloseTo(initialMore?.x ?? 0, 0);
    expect(shownSummary?.x ?? 0).toBeLessThan(initialSummary?.x ?? 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: 'test-results/request-more-threshold-320.png' });
    await page.getByRole('button', { name: 'Remove photo-005.jpg' }).click();
    await expect(moreGroup).toHaveAttribute('aria-hidden', 'true');
    expect((await toolbar.boundingBox())?.height).toBe(initialToolbar?.height);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Select photo-005.jpg' }).click();
    await expect(moreGroup).toHaveCSS('opacity', '1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(moreGroup).toHaveCSS('transition-property', 'none');
    await expect(summary).toHaveCSS('transition-property', 'none');
});

test('request more refreshes QRIS availability without requiring a new gallery session', async ({ page }) => {
    const id = 'qris-refresh-gallery';
    await installSession(page, id);

    let qrisEnabled = false;
    let photoRequests = 0;
    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({
        json: { contactWhatsappUrl: '+628123456789', requestMoreMessage: 'Request {{requested_count}} photos for {{gallery_title}}' },
    }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => {
        photoRequests += 1;
        return route.fulfill({
            json: {
                gallery: {
                    ...gallery('2026-09-05T03:00:00.000Z'),
                    maxSelections: 1,
                    addon: { enabled: false, qrisEnabled, additionalLimit: 0, unitPrice: 10000, status: 'none' },
                },
                photos: [photo(1)],
                page: 1,
                pageSize: 54,
                total: 1,
                totalPages: 1,
                selectedDriveFileIds: [],
                selectedPhotos: [],
            },
        });
    });
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));

    await page.goto(`/culling/${id}`);
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(page.getByTestId('gallery-header').getByTestId('gallery-countdown')).toBeVisible();
    await expect(page.getByTestId('gallery-countdown-value')).toHaveText(/\d+d \d{2}:\d{2}:\d{2}/);
    await expect(page.getByTestId('gallery-header').getByTestId('selection-summary')).toHaveCount(0);
    await expect(page.getByTestId('selection-summary')).not.toHaveAttribute('aria-live');
    await expect(page.getByTestId('selection-summary')).toContainText('0/1 selected');
    await expect(page.getByTestId('selection-count-announcement')).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByTestId('selection-count-announcement')).toHaveText('0 selected of 1; 1 remaining');
    await expect(page.getByTestId('gallery-toolbar').getByRole('button', { name: 'Request more editing slots' })).toBeVisible();
    await expect(page.getByTestId('gallery-toolbar').getByRole('button', { name: 'Request more editing slots' })).toContainText('More');
    await expect(page.getByTestId('gallery-header').getByRole('button', { name: 'Request more editing slots' })).toHaveCount(0);
    const navBounds = await page.getByRole('navigation', { name: 'Gallery views' }).boundingBox();
    const selectionBounds = await page.getByTestId('selection-summary').boundingBox();
    const moreBounds = await page.getByTestId('gallery-toolbar').getByRole('button', { name: 'Request more editing slots' }).boundingBox();
    expect((navBounds?.x ?? 0) + (navBounds?.width ?? 0)).toBeLessThanOrEqual(selectionBounds?.x ?? 0);
    expect((selectionBounds?.x ?? 0) + (selectionBounds?.width ?? 0)).toBeLessThanOrEqual(moreBounds?.x ?? 0);
    await expect(page.getByTestId('selection-action-bar')).toHaveCount(0);
    expect((await page.getByTestId('gallery-toolbar').boundingBox())?.height).toBeLessThan(65);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: 'test-results/culling-request-more-320.png' });
    await page.getByRole('button', { name: 'Select photo-001.jpg' }).click();
    await expect(page.getByTestId('selection-summary')).toContainText('1/1 selected');
    await expect(page.getByTestId('selection-count-announcement')).toHaveText('1 selected of 1; 0 remaining');
    await expect(page.getByTestId('selection-action-bar').getByRole('button', { name: 'Review Selection' })).toBeInViewport();
    await expect(page.getByTestId('selection-action-bar').getByRole('button', { name: 'Review Selection' })).toBeEnabled();
    await page.getByRole('button', { name: 'Switch to white mode' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('selection-action-bar').getByRole('button', { name: 'Review Selection' })).toBeEnabled();
    expect((await page.getByTestId('gallery-toolbar').boundingBox())?.height).toBeLessThan(65);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: 'test-results/culling-request-more-full-390-white.png' });
    await page.setViewportSize({ width: 640, height: 800 });
    await expect(page.getByTestId('gallery-toolbar').getByRole('button', { name: 'Request more editing slots' })).toBeVisible();
    await expect(page.getByTestId('selection-summary')).toContainText('1/1 selected');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: 'test-results/culling-request-more-640-white.png' });
    await page.setViewportSize({ width: 1280, height: 800 });
    const requestMore = page.getByRole('button', { name: 'Request more editing slots' });
    await expect(requestMore).toBeVisible();
    const headerUtilities = await page.getByTestId('header-utilities').boundingBox();
    const requestMoreGroup = await page.getByTestId('request-more-group').boundingBox();
    expect(Math.abs(((headerUtilities?.x ?? 0) + (headerUtilities?.width ?? 0)) - ((requestMoreGroup?.x ?? 0) + (requestMoreGroup?.width ?? 0)))).toBeLessThanOrEqual(1);
    await expectToolbarAlignedWithGrid(page);
    const gridBounds = await page.getByTestId('gallery-grid').boundingBox();
    expect((requestMoreGroup?.x ?? 0) + (requestMoreGroup?.width ?? 0)).toBeCloseTo((gridBounds?.x ?? 0) + (gridBounds?.width ?? 0), 0);
    await page.screenshot({ path: 'test-results/culling-request-more-desktop.png' });
    for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const footerLink = await page.getByRole('link', { name: '@theorbitphoto on Instagram' }).boundingBox();
        const actionBar = await page.getByTestId('selection-action-bar').boundingBox();
        expect(footerLink).not.toBeNull();
        expect(actionBar).not.toBeNull();
        expect((footerLink?.y ?? 0) + (footerLink?.height ?? 0)).toBeLessThanOrEqual((actionBar?.y ?? 0) + 1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }

    qrisEnabled = true;
    await page.route('**/api/payments/qris/create', (route) => route.fulfill({ json: {
        success: true, orderId: 'request-more-theme', grossAmount: 50000, requestedCount: 5,
        qrUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="224" height="224"%3E%3Crect width="224" height="224" fill="white"/%3E%3C/svg%3E',
    } }));
    await page.route('**/api/payments/status/*', (route) => route.fulfill({ json: { orderId: 'request-more-theme', status: 'pending', grossAmount: 50000 } }));
    await requestMore.click();

    const dialog = page.getByRole('dialog', { name: 'Request More Photos' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Pay via QRIS' })).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Additional photo packages' }).getByRole('button')).toHaveCount(3);
    const summaryHeight = (await dialog.locator('dl').boundingBox())?.height;
    const discountedPackage = dialog.getByRole('button', { name: /\+10 photos/ });
    await discountedPackage.click();
    await expect(discountedPackage).toContainText('Save 10%');
    await expect(discountedPackage.locator('s')).toHaveCount(0);
    await expect(dialog.locator('s')).toHaveCSS('text-decoration-line', 'line-through');
    await expect(dialog.getByText('Bundle discount').locator('..')).toContainText('10%');
    expect((await dialog.locator('dl').boundingBox())?.height).toBeCloseTo(summaryHeight ?? 0, 0);
    await expect(discountedPackage.getByText('Save 10%')).toHaveCSS('color', 'rgb(155, 228, 214)');
    await page.setViewportSize({ width: 320, height: 568 });
    const mobileSummaryHeight = (await dialog.locator('dl').boundingBox())?.height;
    const packageBoxes = await Promise.all([5, 10, 20].map((count) => dialog.getByRole('button', { name: new RegExp(`\\+${count} photos`) }).boundingBox()));
    expect(packageBoxes.map((box) => box?.height)).toEqual([96, 96, 96]);
    expect(packageBoxes.map((box) => box?.y)).toEqual([packageBoxes[0]?.y, packageBoxes[0]?.y, packageBoxes[0]?.y]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: 'test-results/request-more-discount-white-320.png' });
    await dialog.getByRole('button', { name: /\+5 photos/ }).click();
    await expect(dialog.getByRole('button', { name: /\+5 photos/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByText('Bundle discount').locator('..')).toContainText('None');
    expect((await dialog.locator('dl').boundingBox())?.height).toBeCloseTo(mobileSummaryHeight ?? 0, 0);
    const customAmount = dialog.getByRole('spinbutton', { name: 'Custom amount' });
    await customAmount.fill('');
    await expect(customAmount).toHaveValue('');
    await customAmount.blur();
    await expect(customAmount).toHaveValue('5');
    await dialog.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
    const modalBackground = () => dialog.locator('.gallery-modal-panel').evaluate((panel) => getComputedStyle(panel).backgroundColor);
    expect(await modalBackground()).toBe('rgb(255, 255, 255)');
    await page.setViewportSize({ width: 320, height: 568 });
    await page.screenshot({ path: 'test-results/request-more-white-320.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await dialog.locator('.gallery-modal-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(dialog.getByRole('link', { name: 'Request via WhatsApp' })).toBeVisible();
    await page.screenshot({ path: 'test-results/request-more-white-actions-320.png' });
    await dialog.getByRole('button', { name: 'Pay via QRIS' }).click();
    const qrisDialog = page.getByRole('dialog', { name: 'QRIS Payment' });
    await expect(qrisDialog).toBeVisible();
    await expect(qrisDialog.getByAltText('QRIS payment code')).toBeVisible();
    await qrisDialog.locator('.gallery-modal-panel').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    expect(await qrisDialog.locator('.gallery-modal-panel').evaluate((panel) => getComputedStyle(panel).backgroundColor)).toBe('rgb(255, 255, 255)');
    await page.screenshot({ path: 'test-results/qris-white-320.png' });
    await qrisDialog.getByRole('button', { name: 'Close QRIS Payment' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close Request More Photos' }).click();
    await page.getByRole('button', { name: 'Switch to black mode' }).click();
    await requestMore.click();
    await expect(dialog).toBeVisible();
    await dialog.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
    expect(await modalBackground()).toBe('rgb(13, 13, 13)');
    await dialog.getByRole('button', { name: /\+20 photos/ }).click();
    await expect(dialog.getByRole('button', { name: /\+20 photos/ }).getByText('Save 20%')).toHaveCSS('color', 'rgb(8, 108, 97)');
    await expect(dialog.getByText('Bundle discount').locator('..')).toContainText('20%');
    await expect(dialog.getByRole('button', { name: /\+20 photos/ })).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.screenshot({ path: 'test-results/request-more-discount-black-320.png' });
    await dialog.getByRole('button', { name: /\+5 photos/ }).click();
    await page.screenshot({ path: 'test-results/request-more-black-320.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await dialog.getByRole('button', { name: 'Pay via QRIS' }).click();
    await expect(qrisDialog).toBeVisible();
    await qrisDialog.locator('.gallery-modal-panel').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    expect(await qrisDialog.locator('.gallery-modal-panel').evaluate((panel) => getComputedStyle(panel).backgroundColor)).toBe('rgb(13, 13, 13)');
    await page.screenshot({ path: 'test-results/qris-black-320.png' });
    await qrisDialog.getByRole('button', { name: 'Close QRIS Payment' }).click();
    await page.route('**/api/payments/qris/create', (route) => route.fulfill({ json: {
        success: true, orderId: 'missing-qr', grossAmount: 50000, requestedCount: 5,
    } }));
    await dialog.getByRole('button', { name: 'Pay via QRIS' }).click();
    await expect(qrisDialog.getByRole('alert')).toContainText('QR code unavailable');
    expect(photoRequests).toBeGreaterThanOrEqual(2);
});

test('continues the lightbox across page boundaries', async ({ page }) => {
    const id = 'cross-page-lightbox-gallery';
    await page.setViewportSize({ width: 1440, height: 900 });
    await installSession(page, id);

    const requestedPageSizes: string[] = [];
    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, async (route) => {
        const requestUrl = new URL(route.request().url());
        const requestedPage = Number(requestUrl.searchParams.get('page') || 1);
        requestedPageSizes.push(requestUrl.searchParams.get('pageSize') || '');
        await route.fulfill({
            json: {
                gallery: gallery('2026-09-05T03:00:00.000Z'),
                photos: requestedPage === 1
                    ? Array.from({ length: 54 }, (_, index) => photo(index + 1))
                    : Array.from({ length: 47 }, (_, index) => photo(index + 55)),
                page: requestedPage,
                pageSize: 54,
                total: 101,
                totalPages: 2,
                selectedDriveFileIds: [],
                selectedPhotos: [],
            },
        });
    });
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
    await page.route(`**/api/public/galleries/${id}/photos/*/preview?*`, (route) => fulfillImage(route, 1600, 1067));

    await page.goto(`/culling/${id}`);
    await expect.poll(() => requestedPageSizes[0]).toBe('54');
    await page.getByRole('button', { name: 'Open photo-054.jpg' }).click();
    await expect(page.getByTestId('gallery-lightbox-footer').getByText('photo-054.jpg', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close photo preview' })).toBeFocused();

    await page.getByRole('button', { name: 'Next photo' }).click();
    await expect(page.getByTestId('gallery-lightbox-footer').getByText('photo-055.jpg', { exact: true })).toBeVisible();
    await expect(page.getByTestId('gallery-lightbox-footer').getByText('55 / 101')).toBeVisible();
    await expect(page).toHaveURL(/page=2/);

    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('gallery-lightbox-footer').getByText('photo-054.jpg', { exact: true })).toBeVisible();
    await expect(page.getByTestId('gallery-lightbox-footer').getByText('54 / 101')).toBeVisible();
    await expect(page).toHaveURL(/page=1/);

    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('gallery-lightbox-footer').getByText('photo-055.jpg', { exact: true })).toBeVisible();
});

test('locks an open gallery when its countdown reaches zero', async ({ page }) => {
    const id = 'expiring-gallery';
    const serverTime = new Date().toISOString();
    const deadline = new Date(Date.now() + 1_500).toISOString();
    await installSession(page, id);

    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({
        json: {
            gallery: gallery(deadline, serverTime),
            photos: [photo(1)],
            page: 1,
            pageSize: 100,
            total: 1,
            totalPages: 1,
            selectedDriveFileIds: [],
            selectedPhotos: [],
        },
    }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));

    await page.goto(`/culling/${id}`);
    await expect(page.getByTitle('Selection time remaining')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Selection Closed' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('The selection deadline has ended. Please contact the admin if you need more time.')).toBeVisible();
});

test('keeps long Google Drive filenames below the image without covering the photo', async ({ page }) => {
    const id = 'long-name-gallery';
    const longName = 'Copy of P150018-with-a-very-long-google-drive-duplicate-name-that-should-not-cover-the-photo-final-v2.jpg';
    await page.setViewportSize({ width: 375, height: 667 });
    await installSession(page, id);

    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({
        json: {
            gallery: galleryWithTitle('Kevin Prewedding'),
            photos: [{ ...photo(1), filename: longName }],
            page: 1,
            pageSize: 54,
            total: 1,
            totalPages: 1,
            selectedDriveFileIds: [],
            selectedPhotos: [],
        },
    }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));

    await page.goto(`/culling/${id}`);
    const opener = page.getByRole('button', { name: `Open ${longName}` });
    await expect(opener).toBeVisible();
    const filenameLabel = page.locator('p').filter({ hasText: longName }).first();
    await expect(filenameLabel).toBeVisible();
    await expect(filenameLabel).toHaveAttribute('title', longName);

    const layout = await page.evaluate((filename) => {
        const openerElement = [...document.querySelectorAll('button')].find((node) => node.getAttribute('aria-label') === `Open ${filename}`);
        const tile = openerElement?.closest('article')?.getBoundingClientRect();
        const image = openerElement?.getBoundingClientRect();
        const labelElement = [...document.querySelectorAll('p')].find((node) => node.textContent === filename);
        const label = labelElement?.getBoundingClientRect();
        return {
            imageBottom: image?.bottom ?? 0,
            imageHeight: image?.height ?? 0,
            labelTop: label?.top ?? 0,
            tileHeight: tile?.height ?? 0,
            labelIsTruncated: Boolean(labelElement && labelElement.scrollWidth > labelElement.clientWidth),
        };
    }, longName);

    expect(layout.labelTop).toBeGreaterThanOrEqual(layout.imageBottom - 1);
    expect(layout.tileHeight).toBeGreaterThan(layout.imageHeight);
    expect(layout.labelIsTruncated).toBe(true);
});

test('toggles All Photos to the last submitted snapshot without changing the Picked draft', async ({ page }) => {
    const id = 'submitted-toggle-gallery';
    await installSession(page, id);
    const allPhotos = [photo(1), photo(2), photo(3)];
    const submitted = [photo(1), photo(2)];

    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => {
        const submittedRequest = new URL(route.request().url()).searchParams.get('includeSelectedPhotos') === '1';
        return route.fulfill({ json: {
            gallery: { ...gallery('2026-09-05T03:00:00.000Z'), selectionCount: submitted.length },
            photos: submittedRequest ? [] : allPhotos,
            page: 1,
            pageSize: 54,
            total: allPhotos.length,
            totalPages: 1,
            selectedDriveFileIds: submitted.map((item) => item.driveFileId),
            selectedPhotos: submittedRequest ? submitted : [],
        } });
    });
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
    await page.route(`**/api/public/galleries/${id}/photos/*/preview?*`, (route) => fulfillImage(route, 1600, 1067));

    await page.setViewportSize({ width: 360, height: 720 });
    await page.goto(`/culling/${id}`);
    await expect(page.getByTestId('selection-summary')).toContainText('2/30 selected');
    await expect(page.getByTestId('selection-count-announcement')).toContainText('28 remaining');
    const views = page.getByRole('navigation', { name: 'Gallery views' });
    const viewLabelFits = () => views.getByRole('button').first().locator('span').first().evaluate((label) => label.scrollWidth <= label.clientWidth + 1);
    const initialViewBounds = await views.getByRole('button').first().boundingBox();
    const initialEditedBounds = await views.getByRole('button', { name: 'Edited Photos' }).boundingBox();
    expect(await viewLabelFits()).toBe(true);
    await page.getByRole('button', { name: 'All Photos', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Picked', exact: true }).click();
    await page.getByRole('button', { name: 'Remove photo-001.jpg', exact: true }).click();
    await expect(page.getByTestId('selection-summary')).toContainText('1/30 selected');
    await expect(page.getByTestId('selection-count-announcement')).toContainText('29 remaining');
    await expect(page.getByRole('button', { name: 'Picked', exact: true })).toBeVisible();
    const pickedViewBounds = await views.getByRole('button').first().boundingBox();
    expect(pickedViewBounds?.width).toBe(initialViewBounds?.width);
    expect(await viewLabelFits()).toBe(true);
    expect((await views.getByRole('button', { name: 'Edited Photos' }).boundingBox())?.x).toBe(initialEditedBounds?.x);
    await page.setViewportSize({ width: 320, height: 720 });
    expect(await viewLabelFits()).toBe(true);
    await page.setViewportSize({ width: 360, height: 720 });

    await page.getByRole('button', { name: 'Picked', exact: true }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Picked', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('menuitemradio', { name: 'All Photos', exact: true })).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('menuitemradio', { name: 'Submitted', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Submitted', exact: true })).toBeVisible();
    expect((await views.getByRole('button').first().boundingBox())?.width).toBe(initialViewBounds?.width);
    expect(await viewLabelFits()).toBe(true);
    expect((await views.getByRole('button', { name: 'Edited Photos' }).boundingBox())?.x).toBe(initialEditedBounds?.x);
    for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 720 });
        expect(await viewLabelFits()).toBe(true);
        await expect(views.getByRole('button', { name: 'Submitted', exact: true }).getByText('Sent', { exact: true })).toBeVisible();
        const tabWidths = await views.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().width));
        expect(tabWidths[0]).toBeGreaterThanOrEqual(44);
        expect(tabWidths[1]).toBeGreaterThan(tabWidths[0]);
        expect(tabWidths[2]).toBeCloseTo(44, 0);
        const tabEdge = await views.boundingBox();
        const firstPhoto = await page.getByTestId('gallery-grid').locator(':scope > *').first().boundingBox();
        expect(Math.abs((tabEdge?.x ?? 0) + (tabEdge?.width ?? 0) - ((firstPhoto?.x ?? 0) + (firstPhoto?.width ?? 0)))).toBeLessThanOrEqual(1);
        const editedLabel = views.getByRole('button', { name: 'Edited Photos' }).getByText('Edited', { exact: true });
        await expect(editedLabel).toBeVisible();
        expect(await editedLabel.evaluate((label) => label.scrollWidth <= label.clientWidth + 1)).toBe(true);
        await expect(views.getByRole('button', { name: 'Selfie' }).locator('svg').first()).toHaveAttribute('width', '16');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        await expect(page.getByTestId('gallery-toolbar').getByRole('button', { name: 'Submit', exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Open photo-001.jpg', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select photo-001.jpg', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Select photo-001.jpg', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove photo-001.jpg', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Submitted', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'All Photos', exact: true }).click();
    await expect(page.getByRole('button', { name: 'All Photos', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(3);
});

test('keeps draft selections through reload and clears the unsaved status after submit', async ({ page }) => {
    const id = 'draft-safety-gallery';
    await installSession(page, id);

    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({
        json: {
            gallery: gallery('2026-09-05T03:00:00.000Z'),
            photos: [photo(1), photo(2)],
            page: 1,
            pageSize: 54,
            total: 2,
            totalPages: 1,
            selectedDriveFileIds: [],
            selectedPhotos: [],
        },
    }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
    await page.route(`**/api/public/galleries/${id}/selections`, (route) => route.fulfill({
        json: { status: 'submitted', selectionCount: 1, filenames: ['photo-001.jpg'] },
    }));

    await page.goto(`/culling/${id}`);
    await expect(page.getByTestId('selection-action-bar')).toHaveCount(0);
    await page.getByRole('button', { name: 'Select photo-001.jpg' }).click();
    await expect(page.getByTestId('selection-action-bar').getByRole('button', { name: 'Review Selection' })).toBeEnabled();
    await expect(page.getByTestId('selection-summary').getByRole('status')).toHaveText('Not submitted');

    await page.reload();
    await expect(page.getByRole('button', { name: 'Remove photo-001.jpg' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('selection-summary').getByRole('status')).toHaveText('Not submitted');
    await expect(page.getByTestId('selection-action-bar')).toBeVisible();

    await page.getByRole('button', { name: 'Review Selection' }).click();
    const review = page.getByRole('dialog', { name: 'Review Selection' });
    await expect(review.getByRole('img', { name: 'photo-001.jpg' })).toBeVisible();
    await review.getByRole('button', { name: 'Submit for Editing' }).click();
    await expect(page.getByText('Selection saved. 1 filenames submitted.')).toBeVisible();
    await expect(page.getByTestId('selection-summary').getByRole('status')).toHaveText('Submitted');
    await expect(page.getByTestId('gallery-toolbar').getByText('Submitted', { exact: true })).toHaveClass(/sr-only/);
    await expect(page.getByTestId('selection-action-bar')).toHaveCount(0);
});

test('selection action bar enters once, stays stable through six picks, and exits cleanly', async ({ page }) => {
    const id = 'selection-bar-motion';
    await page.setViewportSize({ width: 320, height: 568 });
    await installSession(page, id);
    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({ json: {
        gallery: { ...gallery('2026-09-05T03:00:00.000Z'), maxSelections: 10, photoCount: 6 },
        photos: Array.from({ length: 6 }, (_, index) => photo(index + 1)),
        page: 1, pageSize: 54, total: 6, totalPages: 1, selectedDriveFileIds: [], selectedPhotos: [],
    } }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
    await page.goto(`/culling/${id}`);
    await expect(page.getByTestId('selection-action-bar')).toHaveCount(0);
    await page.getByRole('button', { name: 'Select photo-001.jpg' }).click();
    const bar = page.getByTestId('selection-action-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveCSS('opacity', '1');
    await expect(bar).toHaveCSS('transform', 'none');
    await expect(bar).toHaveCSS('transition-duration', '0.44s, 0.24s');
    const firstBox = await bar.boundingBox();
    for (let index = 2; index <= 6; index += 1) {
        await page.getByRole('button', { name: `Select photo-${String(index).padStart(3, '0')}.jpg` }).click();
    }
    await expect(bar).toContainText('6/10');
    expect((await bar.boundingBox())?.height).toBe(firstBox?.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: 'test-results/selection-action-bar-320.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(bar).toBeInViewport();
    for (let index = 1; index <= 6; index += 1) {
        await page.getByRole('button', { name: `Remove photo-${String(index).padStart(3, '0')}.jpg` }).click();
    }
    await expect(bar).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Select photo-001.jpg' }).click();
    await expect(bar).toBeVisible();
    await expect(bar).toHaveCSS('transition-property', 'none');
    await page.getByRole('button', { name: 'Remove photo-001.jpg' }).click();
    await expect(bar).toHaveCount(0);
});

test('mobile pagination does not keep a second Review bar spacer', async ({ page }) => {
    const id = 'selection-pagination-spacing';
    await page.setViewportSize({ width: 320, height: 700 });
    await installSession(page, id);
    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({ json: {
        gallery: { ...gallery('2026-12-09T03:00:00.000Z'), maxSelections: 70, photoCount: 60 },
        photos: Array.from({ length: 54 }, (_, index) => photo(index + 1)),
        page: 1, pageSize: 54, total: 60, totalPages: 2, selectedDriveFileIds: [], selectedPhotos: [],
    } }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));

    await page.goto(`/culling/${id}`);
    await page.getByRole('button', { name: 'Select photo-001.jpg' }).click();
    const pagination = page.getByRole('navigation', { name: 'Gallery pages' });
    await expect(pagination).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const navBox = await pagination.boundingBox();
    const footerBox = await page.locator('main > footer').boundingBox();
    const barBox = await page.getByTestId('selection-action-bar').boundingBox();
    expect(navBox).not.toBeNull();
    expect(footerBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    expect(footerBox!.y - (navBox!.y + navBox!.height)).toBeLessThanOrEqual(48);
    expect(navBox!.y + navBox!.height).toBeLessThan(barBox!.y);
    await page.screenshot({ path: 'test-results/culling-pagination-action-bar-320.png', animations: 'disabled' });
});

test('review keeps the draft on failure, restores focus on Back, and retries submission', async ({ page }) => {
    const id = 'review-retry-gallery';
    await installSession(page, id);
    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({ json: {
        gallery: gallery('2026-09-05T03:00:00.000Z'), photos: [photo(1), photo(2)],
        page: 1, pageSize: 54, total: 2, totalPages: 1, selectedDriveFileIds: [], selectedPhotos: [],
    } }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
    let attempts = 0;
    await page.route(`**/api/public/galleries/${id}/selections`, (route) => {
        attempts += 1;
        return attempts === 1
            ? route.fulfill({ status: 500, json: { error: 'Please try again.' } })
            : route.fulfill({ json: { status: 'submitted', selectionCount: 1, filenames: ['photo-001.jpg'] } });
    });

    await page.goto(`/culling/${id}`);
    await page.getByRole('button', { name: 'Select photo-001.jpg' }).click();
    const reviewButton = page.getByRole('button', { name: 'Review Selection' });
    await reviewButton.click();
    let dialog = page.getByRole('dialog', { name: 'Review Selection' });
    await expect(dialog.getByRole('img', { name: 'photo-001.jpg' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Back' }).click();
    await expect(reviewButton).toBeFocused();

    await reviewButton.click();
    dialog = page.getByRole('dialog', { name: 'Review Selection' });
    await dialog.getByRole('button', { name: 'Submit for Editing' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Please try again.');
    await expect(dialog.getByRole('alert')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Remove photo-001.jpg' })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: 'Submit for Editing' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Submit for Editing' }).click();
    await expect(page.getByRole('dialog', { name: 'Review Selection' })).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Selection saved. 1 filenames submitted.' })).toBeFocused();
    await expect(page.getByTestId('selection-action-bar')).toHaveCount(0);
    expect(attempts).toBe(2);
});

test('review shows a steady opening state and cancels it when changing views', async ({ page }) => {
    const id = 'review-opening-gallery';
    await installSession(page, id);
    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({ json: {
        gallery: gallery('2026-09-05T03:00:00.000Z'), photos: [photo(1)],
        page: 1, pageSize: 54, total: 1, totalPages: 1, selectedDriveFileIds: [], selectedPhotos: [],
    } }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));

    await page.goto(`/culling/${id}`);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.getByRole('button', { name: 'Select photo-001.jpg' }).click();
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    const reviewWidth = (await page.getByRole('button', { name: 'Review Selection' }).boundingBox())?.width;
    await page.getByRole('button', { name: 'Review Selection' }).click();
    await expect(page.getByRole('button', { name: 'Opening review…' })).toBeDisabled();
    expect((await page.getByRole('button', { name: 'Opening review…' }).boundingBox())?.width).toBe(reviewWidth);
    await page.screenshot({ path: 'test-results/culling-review-opening-320.png' });
    await expect(page.getByTestId('selection-action-bar').getByRole('status')).toHaveText('Opening selection review');
    await expect(page.getByRole('dialog', { name: 'Review Selection' })).toHaveCount(0);
    await page.clock.runFor(299);
    await expect(page.getByRole('dialog', { name: 'Review Selection' })).toHaveCount(0);
    await page.clock.runFor(1);
    await expect(page.getByRole('dialog', { name: 'Review Selection' })).toBeVisible();

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Review Selection' }).click();
    await page.getByRole('button', { name: 'All Photos', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Picked' }).click();
    await page.clock.runFor(300);
    await expect(page.getByRole('dialog', { name: 'Review Selection' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review Selection' })).toBeEnabled();
});

test('review renders only the current page of a 70-photo selection', async ({ page }) => {
    const id = 'large-review-gallery';
    await installSession(page, id);
    const selected = Array.from({ length: 70 }, (_, index) => photo(index + 1));
    await page.addInitScript(({ galleryKey, items }) => {
        localStorage.setItem(`orbit_culling_selected_${galleryKey}`, JSON.stringify(items.map((item) => item.driveFileId)));
        localStorage.setItem(`orbit_culling_selected_photo_meta_${galleryKey}`, JSON.stringify(Object.fromEntries(items.map((item) => [item.driveFileId, item]))));
    }, { galleryKey: id, items: selected });
    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({ json: {
        gallery: { ...gallery('2026-09-05T03:00:00.000Z'), maxSelections: 70, photoCount: 70 },
        photos: [photo(1)], page: 1, pageSize: 54, total: 70, totalPages: 2,
        selectedDriveFileIds: [], selectedPhotos: [],
    } }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/culling/${id}`);
    await page.getByRole('button', { name: 'Review Selection' }).click();
    const dialog = page.getByRole('dialog', { name: 'Review Selection' });
    await expect(dialog).toContainText('70 photos selected');
    await expect(dialog.locator('.gallery-modal-panel')).toHaveCSS('background-color', 'rgb(13, 13, 13)');
    await expect(dialog.getByRole('img')).toHaveCount(10);
    await expect(dialog.getByRole('status')).toHaveText('1–10 of 70');
    await page.screenshot({ path: 'test-results/culling-review-70-390.png', animations: 'disabled' });
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect(dialog.getByRole('button', { name: 'Submit for Editing' })).toBeInViewport();
    await expect(dialog.getByRole('navigation', { name: 'Review pages' })).toBeInViewport();
    await page.screenshot({ path: 'test-results/culling-review-70-320.png', animations: 'disabled' });
    const reviewScroll = dialog.locator('.gallery-modal-scroll');
    await reviewScroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await reviewScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const nextReviewPage = dialog.getByRole('button', { name: 'Next review page' });
    await nextReviewPage.click();
    await expect(dialog.getByRole('status')).toHaveText('11–20 of 70');
    await expect(nextReviewPage).toBeFocused();
    await expect.poll(() => reviewScroll.evaluate((element) => element.scrollTop)).toBe(0);
    await expect(dialog.getByRole('img', { name: 'photo-011.jpg' })).toBeVisible();
    await expect(dialog.getByRole('img', { name: 'photo-001.jpg' })).toHaveCount(0);
    for (let pageNumber = 3; pageNumber <= 7; pageNumber += 1) {
        await nextReviewPage.click();
    }
    await expect(dialog.getByRole('status')).toHaveText('61–70 of 70');
    await expect(dialog.getByRole('img')).toHaveCount(10);
    await expect(dialog.getByRole('button', { name: 'Submit for Editing' })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Close Review Selection' }).click();
    await page.getByRole('button', { name: 'Switch to white mode' }).click();
    await page.getByRole('button', { name: 'Review Selection' }).click();
    await expect(page.getByRole('dialog', { name: 'Review Selection' }).locator('.gallery-modal-panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.screenshot({ path: 'test-results/culling-review-70-white-320.png', animations: 'disabled' });
});

test('review can clear a previous submission without leaving an empty action bar', async ({ page }) => {
    const id = 'review-clear-gallery';
    await installSession(page, id);
    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({ json: {
        gallery: { ...gallery('2026-09-05T03:00:00.000Z'), selectionCount: 1 }, photos: [photo(1)],
        page: 1, pageSize: 54, total: 1, totalPages: 1,
        selectedDriveFileIds: [photo(1).driveFileId], selectedPhotos: [photo(1)],
    } }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
    let submittedIds: string[] | undefined;
    await page.route(`**/api/public/galleries/${id}/selections`, (route) => {
        const body = route.request().postDataJSON() as { selections?: { driveFileId: string }[] };
        submittedIds = body.selections?.map((item) => item.driveFileId);
        return route.fulfill({ json: { status: 'submitted', selectionCount: 0, filenames: [] } });
    });

    await page.goto(`/culling/${id}`);
    await expect(page.getByRole('button', { name: 'Remove photo-001.jpg' })).toBeVisible();
    await expect(page.getByTestId('selection-action-bar')).toHaveCount(0);
    await page.getByRole('button', { name: 'Remove photo-001.jpg' }).click();
    await page.getByRole('button', { name: 'Review Changes' }).click();
    const dialog = page.getByRole('dialog', { name: 'Review Selection Changes' });
    await expect(dialog).toContainText('This removes the previous submission');
    await dialog.getByRole('button', { name: 'Clear Selection' }).click();
    await expect(page.getByTestId('selection-action-bar')).toHaveCount(0);
    expect(submittedIds).toEqual([]);
});

test('keeps PIN header branding and theme toggle in place after unlock', async ({ page }) => {
    const id = 'pin-header-alignment';
    await page.addInitScript((galleryKey) => localStorage.setItem(`orbit_culling_tutorial_${galleryKey}`, '1'), id);
    await page.route(`**/api/public/galleries/${id}/edit-results/status`, (route) => route.fulfill({ json: { workflow: 'selection_delivery', title: 'Full Frame Test Gallery', available: false, photoCount: 0, status: 'draft' } }));
    await page.route(`**/api/public/galleries/${id}/verify`, (route) => route.fulfill({ json: { token, expiresIn: 3600, gallery: gallery('2026-12-09T03:00:00.000Z', '2026-10-09T03:00:00.000Z') } }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({ json: {
        gallery: gallery('2026-12-09T03:00:00.000Z', '2026-10-09T03:00:00.000Z'), photos: [photo(1)],
        page: 1, pageSize: 54, total: 1, totalPages: 1, selectedDriveFileIds: [], selectedPhotos: [],
    } }));
    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));

    for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: width === 320 ? 640 : 900 });
        await page.goto(`/culling/${id}`);
        await expect(page.getByRole('heading', { name: 'Enter Password' })).toBeVisible();
        if (width === 320) await page.getByRole('button', { name: 'Switch to white mode' }).click();
        if (width === 390) await page.getByRole('button', { name: 'Switch to black mode' }).click();
        const gateHeader = page.locator('.gallery-unlock-overlay').getByTestId('gallery-header');
        await expect(gateHeader.getByText('Full Frame Test Gallery')).toBeVisible();
        await expect(gateHeader.getByText('Photo Selection')).toBeVisible();
        await expect(page.locator('form').getByRole('img', { name: 'Orbit Logo' })).toBeVisible();
        const selectionPassword = page.getByLabel('Photo Selection password', { exact: true });
        await expect(selectionPassword).toHaveAttribute('type', 'password');
        if (width === 320) {
            await page.getByRole('button', { name: 'Unlock Photo Selection' }).click();
            await expect(page.getByRole('alert')).toContainText('Enter at least 4 characters.');
            await expect(selectionPassword).toBeFocused();
            await selectionPassword.fill('1234');
            await page.getByRole('button', { name: 'Show photo selection password' }).press('Enter');
            await expect(selectionPassword).toHaveAttribute('type', 'text');
            await page.getByRole('button', { name: 'Hide photo selection password' }).press('Enter');
            await expect(selectionPassword).toHaveAttribute('type', 'password');
        }
        const gateLogo = await gateHeader.getByRole('img', { name: 'Orbit Logo' }).boundingBox();
        const passwordCardLogo = await page.locator('form').getByRole('img', { name: 'Orbit Logo' }).boundingBox();
        const passwordCard = await page.locator('form').boundingBox();
        const gateToggle = await gateHeader.getByRole('button', { name: /Switch to (white|black) mode/ }).boundingBox();
        if (width === 320 || width === 1440) await page.screenshot({ path: `test-results/pin-gate-${width}.png`, animations: 'disabled' });
        await selectionPassword.fill('1234');
        const unlockStartedAt = Date.now();
        await page.getByRole('button', { name: 'Unlock Photo Selection' }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Preparing your gallery' })).toBeVisible();
        await expect(page.locator('.gallery-unlock-spinner')).toHaveCount(0);
        await expect(page.locator('.gallery-unlock-progress > span')).toHaveCSS('animation-name', 'gallery-unlock-sweep');
        await expect(page.locator('.gallery-unlock-loading')).toHaveCSS('opacity', '1');
        const loadingCard = await page.locator('form').boundingBox();
        const loadingTitle = await page.getByRole('status').filter({ hasText: 'Preparing your gallery' }).boundingBox();
        const loadingLine = await page.locator('.gallery-unlock-progress').boundingBox();
        expect(loadingCard!.height).toBeLessThan(passwordCard!.height - 30);
        expect(loadingLine!.y - (loadingTitle!.y + loadingTitle!.height)).toBeGreaterThan(0);
        expect(loadingLine!.y - (loadingTitle!.y + loadingTitle!.height)).toBeLessThan(60);
        const motion = await page.evaluate(async () => {
            const bar = document.querySelector<HTMLElement>('.gallery-unlock-progress > span')!;
            const before = { bar: bar.getBoundingClientRect().x };
            await new Promise((resolve) => setTimeout(resolve, 180));
            return { reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, barMoved: Math.abs(before.bar - bar.getBoundingClientRect().x) > 2 };
        });
        expect(motion).toEqual({ reducedMotion: false, barMoved: true });
        const loadingCardLogo = await page.locator('form').getByRole('img', { name: 'Orbit Logo' }).boundingBox();
        expect(loadingCardLogo?.x).toBeCloseTo(passwordCardLogo!.x, 0);
        expect(loadingCardLogo?.y).toBeCloseTo(passwordCardLogo!.y, 0);
        if (width === 320 || width === 1440) await page.screenshot({ path: `test-results/gallery-waiting-${width}.png` });
        await expect(page.getByTestId('gallery-grid')).toBeVisible();
        expect(Date.now() - unlockStartedAt).toBeGreaterThanOrEqual(1700);
        const cullingHeader = page.getByTestId('gallery-header');
        const cullingLogo = await cullingHeader.getByRole('img', { name: 'Orbit Logo' }).boundingBox();
        const cullingToggle = await cullingHeader.getByRole('button', { name: /Switch to (white|black) mode/ }).boundingBox();
        expect(gateLogo).not.toBeNull();
        expect(gateToggle).not.toBeNull();
        expect(cullingLogo).not.toBeNull();
        expect(cullingToggle).not.toBeNull();
        expect(cullingLogo!.x).toBeCloseTo(gateLogo!.x, 0);
        expect(cullingLogo!.y).toBeCloseTo(gateLogo!.y, 0);
        expect(cullingToggle!.x).toBeCloseTo(gateToggle!.x, 0);
        expect(cullingToggle!.y).toBeCloseTo(gateToggle!.y, 0);
        await page.evaluate((galleryKey) => localStorage.removeItem(`orbit_culling_token_${galleryKey}`), id);
    }
});

test('starts the loading motion as soon as a PIN is submitted', async ({ page }) => {
    const id = 'pin-loading-during-verification';
    await page.addInitScript((galleryKey) => localStorage.setItem(`orbit_culling_tutorial_${galleryKey}`, '1'), id);
    await page.route(`**/api/public/galleries/${id}/edit-results/status`, (route) => route.fulfill({ json: {
        workflow: 'selection_delivery', title: 'PIN Loading Test', available: false, photoCount: 0, status: 'draft',
    } }));
    await page.route(`**/api/public/galleries/${id}/verify`, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 700));
        await route.fulfill({ json: { token, expiresIn: 3600, gallery: gallery('2026-12-09T03:00:00.000Z', '2026-10-09T03:00:00.000Z') } });
    });
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({ json: {
        gallery: gallery('2026-12-09T03:00:00.000Z', '2026-10-09T03:00:00.000Z'), photos: [photo(1)],
        page: 1, pageSize: 54, total: 1, totalPages: 1, selectedDriveFileIds: [], selectedPhotos: [],
    } }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
    await page.goto(`/culling/${id}`);
    await page.getByLabel('Photo Selection password', { exact: true }).fill('1234');
    await page.getByRole('button', { name: 'Unlock Photo Selection' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Preparing your gallery' })).toBeVisible();
    await expect(page.locator('.gallery-unlock-card')).toHaveAttribute('data-phase', 'waiting');
    await expect(page.locator('.gallery-unlock-progress > span')).toHaveCSS('animation-name', 'gallery-unlock-sweep');
    await expect(page.getByRole('status').filter({ hasText: 'Preparing your gallery' })).toBeVisible();
    await expect(page.getByTestId('gallery-grid')).toBeVisible();
});

test('returns from PIN loading to the password form when verification fails', async ({ page }) => {
    const id = 'invalid-pin-loading';
    await page.route(`**/api/public/galleries/${id}/edit-results/status`, (route) => route.fulfill({ json: {
        workflow: 'selection_delivery', title: 'Invalid PIN Test', available: false, photoCount: 0, status: 'draft',
    } }));
    await page.route(`**/api/public/galleries/${id}/verify`, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        await route.fulfill({ status: 401, json: { error: 'Incorrect password.' } });
    });
    await page.goto(`/culling/${id}`);
    await page.getByLabel('Photo Selection password', { exact: true }).fill('wrong');
    await page.getByRole('button', { name: 'Unlock Photo Selection' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Preparing your gallery' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Enter Password' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Incorrect password');
    await expect(page.locator('.gallery-unlock-spinner')).toHaveCount(0);
});

for (const scenario of ['ready', 'slow', 'failed', 'no-samples', 'data-error', 'saved-session', 'reduced-motion', 'thumbnail-slow'] as const) {
    test(`prepares the first visit behind PIN: ${scenario}`, async ({ page }) => {
        const id = `pin-startup-${scenario}`;
        await page.setViewportSize({ width: 390, height: 844 });
        if (scenario === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' });
        if (scenario === 'saved-session') await page.addInitScript(({ id, token }) => localStorage.setItem(`orbit_culling_token_${id}`, token), { id, token });
        const data = { ...gallery('2026-12-09T03:00:00.000Z', '2026-10-09T03:00:00.000Z'), tutorialSampleSlots: scenario === 'no-samples' ? [] : [1], tutorialSampleVersion: 'startup-v2' };
        let attempts = 0;
        const requests: string[] = [];
        let releaseSample!: () => void;
        const sampleGate = new Promise<void>((resolve) => { releaseSample = resolve; });
        let releaseThumbnail!: () => void;
        const thumbnailGate = new Promise<void>((resolve) => { releaseThumbnail = resolve; });
        await page.route(`**/api/public/galleries/${id}/edit-results/status`, (route) => route.fulfill({ json: { workflow: 'selection_delivery', title: data.title, available: false } }));
        await page.route(`**/api/public/galleries/${id}/verify`, (route) => route.fulfill({ json: { token, gallery: data } }));
        await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => {
            attempts += 1;
            if (scenario === 'data-error' && attempts === 1) return route.fulfill({ status: 500, json: { error: 'Temporary failure' } });
            return route.fulfill({ json: { gallery: data, photos: [photo(1)], page: 1, pageSize: 54, total: 1, totalPages: 1, selectedDriveFileIds: [], selectedPhotos: [] } });
        });
        await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
        await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, async (route) => {
            if (scenario === 'thumbnail-slow') await thumbnailGate;
            return fulfillImage(route, 320, 320);
        });
        await page.route(`**/api/public/galleries/${id}/tutorial/**`, async (route) => {
            requests.push(route.request().url());
            if (scenario === 'slow') await sampleGate;
            if (scenario === 'failed') return route.fulfill({ status: 404 });
            return fulfillImage(route, 1067, 1600);
        });
        await page.goto(`/culling/${id}`);
        let started = Date.now();
        if (scenario !== 'saved-session') {
            await page.getByLabel('Photo Selection password', { exact: true }).fill('1234');
            started = Date.now();
            await page.getByRole('button', { name: 'Unlock Photo Selection' }).click();
            await expect(page.locator('.gallery-unlock-card')).toHaveAttribute('data-phase', 'waiting');
            if (scenario === 'ready') {
                const transforms = await page.locator('.gallery-unlock-button').evaluate(async (button) => {
                    const before = getComputedStyle(button, '::before').transform;
                    await new Promise((resolve) => setTimeout(resolve, 200));
                    return [before, getComputedStyle(button, '::before').transform];
                });
                expect(transforms[0]).not.toBe(transforms[1]);
            }
            if (scenario === 'reduced-motion') {
                const progress = page.locator('.gallery-unlock-progress > span');
                await expect(progress).toHaveCSS('animation-duration', '2.4s');
                const moved = await progress.evaluate(async (line) => {
                    const start = line.getBoundingClientRect().x;
                    await new Promise((resolve) => setTimeout(resolve, 180));
                    return Math.abs(start - line.getBoundingClientRect().x) > 2;
                });
                expect(moved).toBe(true);
            }
        }
        if (scenario === 'data-error') {
            await expect(page.getByRole('alert')).toContainText('Unable to load your gallery');
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await page.getByRole('button', { name: 'Retry', exact: true }).click();
        }
        if (scenario === 'slow') {
            await expect(page.getByTestId('tutorial-panel')).toBeHidden();
            expect(await page.evaluate(() => document.body.style.position)).not.toBe('fixed');
            await expect(page.getByTestId('gallery-grid')).toHaveCount(0);
        }
        const textFallback = ['slow', 'failed', 'no-samples'].includes(scenario);
        await expect(page.getByRole('dialog', { name: 'How photo selection works' })).toBeVisible();
        if (scenario === 'thumbnail-slow') {
            expect(Date.now() - started).toBeLessThan(4500);
            releaseThumbnail();
        }
        if (scenario !== 'saved-session') expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
        await expect(page.getByTestId(textFallback ? 'tutorial-submit-step' : 'tutorial-confidence-step')).toBeVisible();
        await expect(page.getByTestId('tutorial-image-loading')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Close tutorial' })).toBeFocused();
        if (!textFallback) await expect(page.getByTestId('tutorial-before-after-slider')).toHaveAttribute('aria-busy', 'false');
        if (scenario === 'slow') {
            releaseSample();
            await page.waitForTimeout(400);
            await expect(page.getByTestId('tutorial-submit-step')).toBeVisible();
        }
        if (scenario !== 'no-samples') {
            expect(requests).toHaveLength(2);
            expect(requests.every((url) => url.includes('startup-v2'))).toBe(true);
        }
        await page.screenshot({ path: `test-results/pin-startup-${scenario}.png` });
        await page.getByRole('button', { name: 'Close tutorial' }).click();
        await expect(page.getByTestId('gallery-grid')).toBeVisible();
    });
}

test('opens Photo Selection after PIN without waiting for slow thumbnails', async ({ page }) => {
    const id = 'pin-slow-thumbnails-returning';
    const data = gallery('2026-12-09T03:00:00.000Z', '2026-10-09T03:00:00.000Z');
    await page.addInitScript((galleryKey) => localStorage.setItem(`orbit_culling_tutorial_${galleryKey}`, '1'), id);
    await page.route(`**/api/public/galleries/${id}/edit-results/status`, (route) => route.fulfill({ json: { workflow: 'selection_delivery', title: data.title, available: false } }));
    await page.route(`**/api/public/galleries/${id}/verify`, (route) => route.fulfill({ json: { token, gallery: data } }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({ json: { gallery: data, photos: [photo(1)], page: 1, pageSize: 54, total: 1, totalPages: 1, selectedDriveFileIds: [], selectedPhotos: [] } }));
    await page.route(`**/api/public/galleries/${id}/face-search/status`, (route) => route.fulfill({ json: { available: false, status: 'unavailable' } }));
    let releaseThumbnail!: () => void;
    const thumbnailGate = new Promise<void>((resolve) => { releaseThumbnail = resolve; });
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, async (route) => {
        await thumbnailGate;
        return fulfillImage(route, 320, 320);
    });

    await page.goto(`/culling/${id}`);
    await page.getByLabel('Photo Selection password', { exact: true }).fill('1234');
    await page.getByRole('button', { name: 'Unlock Photo Selection' }).click();
    await expect(page.getByTestId('gallery-grid')).toBeVisible({ timeout: 4500 });
    await expect(page.getByRole('dialog', { name: 'How photo selection works' })).toHaveCount(0);
    releaseThumbnail();
    await expect(page.getByTestId('gallery-grid').locator('img').first()).toBeVisible();
});

test('returns to the PIN gate when an admin save invalidates the public token', async ({ page }) => {
    const id = 'stale-token-gallery';
    await installSession(page, id);

    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Gallery access expired. Enter the PIN again.' }),
    }));

    await page.goto(`/culling/${id}`);
    await expect(page.getByRole('heading', { name: 'Enter Password' })).toBeVisible();
    await expect(page.evaluate((galleryKey) => localStorage.getItem(`orbit_culling_token_${galleryKey}`), id)).resolves.toBeNull();
});

test('shows the before and edited tutorial slider with pointer and keyboard controls', async ({ page }) => {
    const id = 'tutorial-slider-gallery';
    await page.setViewportSize({ width: 390, height: 844 });
    await installSession(page, id);
    const tutorialRequests = new Set<string>();
    let releaseFirstBefore!: () => void;
    const firstBeforeGate = new Promise<void>((resolve) => { releaseFirstBefore = resolve; });
    let releaseSecondAfter!: () => void;
    const secondAfterGate = new Promise<void>((resolve) => { releaseSecondAfter = resolve; });

    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({
        json: {
            gallery: gallery('2026-09-05T03:00:00.000Z'),
            photos: [photo(1)],
            page: 1,
            pageSize: 54,
            total: 1,
            totalPages: 1,
            selectedDriveFileIds: [],
            selectedPhotos: [],
        },
    }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
    await page.route(`**/api/public/galleries/${id}/tutorial/*/before?*`, (route) => {
        const slot = Number(new URL(route.request().url()).pathname.match(/\/tutorial\/(\d+)\/before$/)?.[1] || 1);
        tutorialRequests.add(`${slot}:before`);
        return (async () => {
            if (slot === 1) await firstBeforeGate;
            if (slot === 2) return fulfillImage(route, 1067, 1600);
            if (slot === 3) return fulfillImage(route, 1200, 1200);
            return fulfillImage(route, 1600, 1067);
        })();
    });
    await page.route(`**/api/public/galleries/${id}/tutorial/*/after?*`, async (route) => {
        const slot = Number(new URL(route.request().url()).pathname.match(/\/tutorial\/(\d+)\/after$/)?.[1] || 1);
        tutorialRequests.add(`${slot}:after`);
        if (slot === 2) {
            await secondAfterGate;
            return fulfillImage(route, 1067, 1600);
        }
        if (slot === 3) return fulfillImage(route, 1200, 1200);
        return fulfillImage(route, 1600, 1067);
    });

    await page.goto(`/culling/${id}`);
    await page.getByRole('button', { name: 'How to Submit' }).click();
    await expect(page.getByTestId('tutorial-confidence-step')).toBeVisible();
    await expect(page.getByText('Sample 1 of 3')).toBeVisible();
    const beforeImage = page.getByAltText('Before editing sample');
    const afterImage = page.getByAltText('Edited result sample');
    await expect(page.getByTestId('tutorial-image-loading')).toBeVisible();
    const loadingSpinner = page.getByTestId('tutorial-image-loading').locator('svg');
    await expect(loadingSpinner).toHaveCSS('animation-name', 'spin');
    await expect(loadingSpinner).toHaveCSS('animation-duration', '0.7s');
    const initialSpinnerTransform = await loadingSpinner.evaluate((element) => getComputedStyle(element).transform);
    await page.waitForTimeout(250);
    await expect.poll(() => loadingSpinner.evaluate((element) => getComputedStyle(element).transform)).not.toBe(initialSpinnerTransform);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(loadingSpinner).toHaveCSS('animation-name', 'spin');
    await expect(loadingSpinner).toHaveCSS('animation-duration', '1.6s');
    const reducedSpinnerTransform = await loadingSpinner.evaluate((element) => getComputedStyle(element).transform);
    await page.waitForTimeout(250);
    await expect.poll(() => loadingSpinner.evaluate((element) => getComputedStyle(element).transform)).not.toBe(reducedSpinnerTransform);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(beforeImage).toHaveCSS('opacity', '0');
    await expect(page.getByTestId('tutorial-slider-handle')).toHaveCount(0);
    await expect.poll(() => tutorialRequests.size).toBe(2);
    await page.screenshot({ path: 'test-results/tutorial-loading-mobile.png' });
    releaseFirstBefore();
    await expect(page.getByTestId('tutorial-image-loading')).toHaveCount(0);
    await expect(beforeImage).toHaveCSS('opacity', '1');
    await expect(afterImage).toHaveCSS('opacity', '1');
    await expect.poll(() => tutorialRequests.size).toBe(2);
    await page.screenshot({ path: 'test-results/tutorial-ready-mobile.png' });

    const panel = page.getByTestId('tutorial-panel');
    const initialPanelBox = await panel.boundingBox();
    expect(initialPanelBox).not.toBeNull();
    const handle = page.getByTestId('tutorial-slider-handle');
    await expect(handle).toHaveAttribute('aria-valuenow', '50');
    const mediaSlot = page.getByTestId('tutorial-media-slot');
    const initialMediaSlotBox = await mediaSlot.boundingBox();
    const slider = page.getByTestId('tutorial-before-after-slider');
    await expect.poll(async () => {
        const box = await slider.boundingBox();
        return (box?.width ?? 0) / (box?.height ?? 1);
    }).toBeCloseTo(1600 / 1067, 1);
    const sliderBox = await slider.boundingBox();
    expect(sliderBox).not.toBeNull();
    expect(initialMediaSlotBox).not.toBeNull();
    await expect(slider).toHaveCSS('touch-action', 'pan-y');
    const dividers = page.getByTestId('tutorial-slider-divider');
    await expect(dividers).toHaveCount(1);
    expect((await dividers.first().boundingBox())?.height).toBeCloseTo(sliderBox?.height ?? 0, 0);
    await page.mouse.move((sliderBox?.x ?? 0) + (sliderBox?.width ?? 0) * 0.25, (sliderBox?.y ?? 0) + (sliderBox?.height ?? 0) / 2);
    await page.mouse.down();
    await page.mouse.move((sliderBox?.x ?? 0) + (sliderBox?.width ?? 0) * 0.75, (sliderBox?.y ?? 0) + (sliderBox?.height ?? 0) / 2);
    await page.mouse.up();
    await expect(handle).toHaveAttribute('aria-valuenow', '75');

    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(handle).toHaveAttribute('aria-valuenow', '70');

    await page.getByRole('button', { name: 'Next sample' }).click();
    await expect(page.getByText('Sample 2 of 3')).toBeVisible();
    await expect.poll(() => tutorialRequests.size).toBe(4);
    await expect(page.getByTestId('tutorial-image-loading')).toHaveCount(1);
    await expect(page.getByTestId('tutorial-before-after-slider')).toHaveCount(2);
    await expect(page.getByTestId('tutorial-before-after-slider').first()).toBeVisible();
    releaseSecondAfter();
    await expect(page.getByTestId('tutorial-image-loading')).toHaveCount(0);
    await expect(page.getByTestId('tutorial-before-after-slider')).toHaveCount(1);
    await expect(page.getByAltText('Before editing sample')).toBeVisible();
    await expect.poll(async () => {
        const box = await slider.boundingBox();
        return (box?.width ?? 0) / (box?.height ?? 1);
    }).toBeCloseTo(1067 / 1600, 1);
    const portraitSliderBox = await slider.boundingBox();
    const portraitMediaSlotBox = await mediaSlot.boundingBox();
    expect(portraitMediaSlotBox?.width).toBeCloseTo(initialMediaSlotBox?.width ?? 0, 0);
    expect(portraitMediaSlotBox?.height).toBeCloseTo(initialMediaSlotBox?.height ?? 0, 0);
    expect(portraitSliderBox?.height ?? 0).toBeGreaterThan((sliderBox?.height ?? 0) * 1.35);
    await page.getByRole('button', { name: 'Next sample' }).click();
    await expect(page.getByText('Sample 3 of 3')).toBeVisible();
    await expect.poll(() => tutorialRequests.size).toBe(6);
    await expect(page.getByTestId('tutorial-before-after-slider')).toHaveCount(1);
    await expect(page.getByTestId('tutorial-image-loading')).toHaveCount(0);
    await expect(page.getByAltText('Before editing sample')).toBeVisible();
    await expect.poll(async () => {
        const box = await slider.boundingBox();
        return (box?.width ?? 0) / (box?.height ?? 1);
    }).toBeCloseTo(1, 1);
    const squareSliderBox = await slider.boundingBox();
    const squareMediaSlotBox = await mediaSlot.boundingBox();
    expect(squareMediaSlotBox?.width).toBeCloseTo(initialMediaSlotBox?.width ?? 0, 0);
    expect(squareMediaSlotBox?.height).toBeCloseTo(initialMediaSlotBox?.height ?? 0, 0);
    expect(squareSliderBox?.height ?? 0).toBeGreaterThan(sliderBox?.height ?? 0);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: 'test-results/tutorial-ready-desktop.png' });
    const desktopPanelBox = await panel.boundingBox();
    const desktopMediaSlotBox = await mediaSlot.boundingBox();
    const desktopFooterBox = await page.getByTestId('tutorial-footer').boundingBox();
    expect(desktopPanelBox?.width).toBeCloseTo(672, 0);
    expect(desktopPanelBox?.height).toBeCloseTo(868, 0);
    expect(desktopMediaSlotBox?.height).toBeCloseTo(448, 0);
    expect((desktopFooterBox?.y ?? 0) + (desktopFooterBox?.height ?? 0)).toBeLessThanOrEqual(900);
    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(page.getByText('Sample 2 of 3')).toBeVisible();
    await expect(page.getByTestId('tutorial-before-after-slider')).toHaveCount(1);
    await expect.poll(async () => {
        const box = await slider.boundingBox();
        return (box?.width ?? 0) / (box?.height ?? 1);
    }).toBeCloseTo(1067 / 1600, 1);
    const desktopPortraitSliderBox = await slider.boundingBox();
    expect(desktopPortraitSliderBox?.height ?? 0).toBeGreaterThanOrEqual((portraitSliderBox?.height ?? 0) - 1);
    await page.getByRole('button', { name: 'Next sample' }).click();
    await expect(page.getByText('Sample 3 of 3')).toBeVisible();
    await expect(page.getByTestId('tutorial-before-after-slider')).toHaveCount(1);

    await page.setViewportSize({ width: 320, height: 568 });
    const compactPanelBox = await panel.boundingBox();
    const compactFooterBox = await page.getByTestId('tutorial-footer').boundingBox();
    expect(compactPanelBox).not.toBeNull();
    expect(compactPanelBox?.height).toBeCloseTo(552, 0);
    expect((compactFooterBox?.y ?? 0) + (compactFooterBox?.height ?? 0)).toBeLessThanOrEqual(568);
    const scrollMetrics = await page.getByTestId('tutorial-scroll-area').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return { clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop };
    });
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
    expect(scrollMetrics.scrollTop).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'How to Submit', exact: true }).last().click();
    await expect(page.getByTestId('tutorial-submit-step')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How to Submit' })).toBeVisible();
    await expect(page.getByTestId('tutorial-submit-steps').getByRole('listitem')).toHaveCount(6);
    await expect.poll(async () => page.getByTestId('tutorial-scroll-area').evaluate((element) => element.scrollTop)).toBe(0);
    const selfieStep = page.getByTestId('tutorial-submit-steps').getByRole('listitem').filter({ hasText: 'Find and Choose Favorites' });
    await expect(selfieStep).toHaveCount(1);
    await expect(selfieStep).toContainText('Use a clear selfie');
    await selfieStep.scrollIntoViewIfNeeded();
    await expect(selfieStep).toBeVisible();
    expect((await panel.boundingBox())?.height).toBeCloseTo(compactPanelBox?.height ?? 0, 0);
    await page.getByRole('button', { name: 'Ready to choose' }).click();
    await expect(page.getByTestId('tutorial-ready-step')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ready to Choose' })).toBeVisible();
    await expect(page.getByTestId('tutorial-ready-step')).toContainText('Mark the photos you want edited, review them in Picked, then submit.');
    await expect(page.getByTestId('tutorial-ready-checklist')).toHaveCount(0);
    expect((await panel.boundingBox())?.height).toBeCloseTo(compactPanelBox?.height ?? 0, 0);

    const dialog = page.getByRole('dialog', { name: 'How photo selection works' });
    const finalFooterBox = await page.getByTestId('tutorial-footer').boundingBox();
    expect((finalFooterBox?.y ?? 0) + (finalFooterBox?.height ?? 0)).toBeLessThanOrEqual(568);

    await page.getByRole('button', { name: 'Start selecting' }).click();
    await expect(dialog).toHaveCount(0);
});

test('shows only complete tutorial sample slots', async ({ page }) => {
    const id = 'partial-tutorial-gallery';
    await installSession(page, id);

    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({
        json: {
            gallery: { ...gallery('2026-09-05T03:00:00.000Z'), tutorialSampleSlots: [1, 3] },
            photos: [photo(1)],
            page: 1,
            pageSize: 54,
            total: 1,
            totalPages: 1,
            selectedDriveFileIds: [],
            selectedPhotos: [],
        },
    }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
    await page.route(`**/api/public/galleries/${id}/tutorial/*/before?*`, (route) => fulfillImage(route, 1067, 1600));
    await page.route(`**/api/public/galleries/${id}/tutorial/*/after?*`, (route) => fulfillImage(route, 1067, 1600));

    await page.goto(`/culling/${id}`);
    await page.getByRole('button', { name: 'How to Submit' }).click();
    await expect(page.getByText('Sample 1 of 2')).toBeVisible();
    await expect(page.getByTestId('tutorial-before-after-slider')).toHaveAttribute('aria-busy', 'false');
    for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 700 });
        const frame = await page.getByTestId('tutorial-media-slot').boundingBox();
        const photo = await page.getByTestId('tutorial-before-after-slider').boundingBox();
        const footer = await page.getByTestId('tutorial-footer').boundingBox();
        expect((photo?.width ?? 0) / (frame?.width ?? 1)).toBeGreaterThan(0.72);
        expect((await page.getByRole('heading', { name: 'Choose with Confidence' }).boundingBox())?.height).toBeLessThanOrEqual(24);
        await expect(page.getByTestId('tutorial-panel').getByText('Before', { exact: true })).toBeInViewport();
        await expect(page.getByTestId('tutorial-panel').getByText('Edited', { exact: true })).toBeInViewport();
        expect((footer?.y ?? 0) + (footer?.height ?? 0)).toBeLessThanOrEqual(700);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
        await page.screenshot({ path: `test-results/tutorial-portrait-${width}.png`, animations: 'disabled' });
    }
    await page.getByRole('button', { name: 'Next sample' }).click();
    await expect(page.getByText('Sample 2 of 2')).toBeVisible();
});

test('skips the awareness step when no tutorial samples are configured', async ({ page }) => {
    const id = 'no-tutorial-gallery';
    await installSession(page, id);

    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({
        json: {
            gallery: { ...gallery('2026-09-05T03:00:00.000Z'), tutorialSampleSlots: [] },
            photos: [photo(1)],
            page: 1,
            pageSize: 54,
            total: 1,
            totalPages: 1,
            selectedDriveFileIds: [],
            selectedPhotos: [],
        },
    }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));

    await page.goto(`/culling/${id}`);
    await page.getByRole('button', { name: 'How to Submit' }).click();
    await expect(page.getByTestId('tutorial-submit-step')).toBeVisible();
    await expect(page.getByTestId('tutorial-confidence-step')).toHaveCount(0);
});

test('opens the guide immediately without a timed splash on mobile and desktop', async ({ page }) => {
    for (const width of [320, 390, 1440]) {
        const id = `guide-immediate-${width}`;
        await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
        await installSession(page, id);
        await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
        await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({
            json: { gallery: { ...gallery('2026-09-05T03:00:00.000Z'), tutorialSampleSlots: [] }, photos: [photo(1)], page: 1, pageSize: 54, total: 1, totalPages: 1, selectedDriveFileIds: [], selectedPhotos: [] },
        }));
        await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
        await page.goto(`/culling/${id}`);
        await page.getByRole('button', { name: 'How to Submit' }).click();
        await expect(page.getByTestId('tutorial-panel')).toBeVisible();
        await expect(page.getByTestId('tutorial-intro')).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'How to Submit' })).toBeVisible();
        const box = await page.getByTestId('tutorial-panel').boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        await page.getByRole('button', { name: 'Close tutorial' }).click();
    }
});

test('opens the first-visit guide directly after gallery access', async ({ page }) => {
    const id = 'guide-first-visit';
    await installSession(page, id);
    await page.addInitScript((galleryKey) => localStorage.removeItem(`orbit_culling_tutorial_${galleryKey}`), id);
    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({
        json: { gallery: { ...gallery('2026-09-05T03:00:00.000Z'), tutorialSampleSlots: [] }, photos: [photo(1)], page: 1, pageSize: 54, total: 1, totalPages: 1, selectedDriveFileIds: [], selectedPhotos: [] },
    }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
    await page.goto(`/culling/${id}`);
    await expect(page.getByTestId('tutorial-panel')).toBeVisible();
    await expect(page.getByTestId('tutorial-intro')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close tutorial' }).click();
    await expect(page.getByTestId('tutorial-panel')).toHaveCount(0);
    await page.getByRole('button', { name: 'How to Submit' }).click();
    await expect(page.getByTestId('tutorial-panel')).toBeVisible();
});

test('shows an in-place tutorial image error and recovers on retry', async ({ page }) => {
    const id = 'tutorial-image-retry';
    await installSession(page, id);
    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({
        json: { gallery: { ...gallery('2026-09-05T03:00:00.000Z'), tutorialSampleSlots: [1] }, photos: [photo(1)], page: 1, pageSize: 54, total: 1, totalPages: 1, selectedDriveFileIds: [], selectedPhotos: [] },
    }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
    let beforeRequests = 0;
    let releaseRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
    await page.route(`**/api/public/galleries/${id}/tutorial/1/before?*`, async (route) => {
        beforeRequests += 1;
        if (beforeRequests === 1) return route.fulfill({ status: 502 });
        await retryGate;
        return fulfillImage(route, 1600, 1067);
    });
    await page.route(`**/api/public/galleries/${id}/tutorial/1/after?*`, (route) => fulfillImage(route, 1600, 1067));

    await page.goto(`/culling/${id}`);
    await page.getByRole('button', { name: 'How to Submit' }).click();
    const error = page.getByRole('alert').filter({ hasText: 'Sample photos unavailable' });
    await expect(error).toBeVisible();
    await expect(page.getByTestId('tutorial-slider-handle')).toHaveCount(0);
    await error.getByRole('button', { name: 'Retry' }).click();
    await expect(error).toHaveCount(0);
    await expect(page.getByTestId('tutorial-image-loading')).toHaveCount(1);
    releaseRetry();
    await expect(page.getByTestId('tutorial-image-loading')).toHaveCount(0);
    await expect(page.getByTestId('tutorial-slider-handle')).toBeVisible();
    expect(beforeRequests).toBe(2);
});

test('filters immediately from a selfie and keeps selection submit working', async ({ page }) => {
    const id = 'face-filter-gallery';
    await page.setViewportSize({ width: 390, height: 844 });
    await installSession(page, id);
    await page.route('**/edit-results/status', (route) => route.fulfill({ json: { available: true, photoCount: 1 } }));
    await page.unroute('**/face-search/status');
    let indexingStarted = false;
    let statusPolls = 0;
    let searchRequests = 0;
    let browserModelRequests = 0;
    const soloOptions: string[] = [];
    const uploadedSelfies: Array<{ width: number; height: number; type: string; size: number; top: number[] }> = [];
    await page.route(`**/api/public/galleries/${id}/face-search/status`, (route) => {
        if (!indexingStarted) return route.fulfill({ json: { available: true, status: 'not_indexed', processed: 0, total: 0 } });
        statusPolls += 1;
        return route.fulfill({
            json: statusPolls === 1
                ? { available: true, status: 'indexing', processed: 55, total: 101 }
                : { available: true, status: 'ready', processed: 101, total: 101 },
        });
    });
    await page.route(`**/api/public/galleries/${id}/face-search`, async (route) => {
        const body = await new Response(new Uint8Array(route.request().postDataBuffer()!), {
            headers: { 'content-type': route.request().headers()['content-type'] },
        }).formData();
        const selfie = body.get('selfie') as File;
        const soloOnly = String(body.get('soloOnly'));
        soloOptions.push(soloOnly);
        const pixels = await page.evaluate(async (bytes) => {
            const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const context = canvas.getContext('2d')!;
            context.drawImage(bitmap, 0, 0);
            const result = { width: bitmap.width, height: bitmap.height, top: Array.from(context.getImageData(20, 20, 1, 1).data) };
            bitmap.close();
            return result;
        }, Array.from(new Uint8Array(await selfie.arrayBuffer())));
        uploadedSelfies.push({ ...pixels, type: selfie.type, size: selfie.size });
        searchRequests += 1;
        if (searchRequests === 1) {
            indexingStarted = true;
            return route.fulfill({ status: 202, json: { status: 'indexing', job: { processed: 0, total: 101 }, matches: [], total: 0 } });
        }
        return route.fulfill({ json: { status: 'complete', total: 101, matches: soloOnly === 'true' ? [photo(2)] : [photo(2), photo(56)] } });
    });
    await page.route(/\/(?:models\/face-api|vendor\/face-api)\//, (route) => {
        browserModelRequests += 1;
        return route.abort();
    });

    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, async (route) => {
        const requestUrl = new URL(route.request().url());
        const requestedPage = Number(requestUrl.searchParams.get('page') || 1);
        await route.fulfill({
            json: {
                gallery: gallery('2026-09-05T03:00:00.000Z'),
                photos: requestedPage === 1
                    ? Array.from({ length: 54 }, (_, index) => photo(index + 1))
                    : Array.from({ length: 47 }, (_, index) => photo(index + 55)),
                page: requestedPage,
                pageSize: 54,
                total: 101,
                totalPages: 2,
                selectedDriveFileIds: [],
                selectedPhotos: [],
            },
        });
    });
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
    await page.route(`**/api/public/galleries/${id}/selections`, (route) => route.fulfill({
        json: { status: 'submitted', selectionCount: 1, filenames: ['photo-002.jpg'] },
    }));

    await page.goto(`/culling/${id}`);
    await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(54);
    await selfieTab(page).click();
    const dialog = page.getByRole('dialog', { name: 'Filter by selfie' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('input[type="checkbox"]')).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Choose selfie' })).toBeEnabled();
    await expect(dialog.getByText('Selecting a selfie starts face matching.', { exact: false })).toBeVisible();
    await page.screenshot({ path: 'test-results/selfie-filter-mobile.png', animations: 'disabled' });

    const jpeg = Buffer.from(await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 2400;
        canvas.height = 1200;
        const context = canvas.getContext('2d')!;
        context.fillStyle = 'red';
        context.fillRect(0, 0, 1200, 1200);
        context.fillStyle = 'blue';
        context.fillRect(1200, 0, 1200, 1200);
        return canvas.toDataURL('image/jpeg', 1).split(',')[1];
    }), 'base64');
    // EXIF orientation 6: rotate the encoded landscape image clockwise to portrait.
    const exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000', 'hex');
    await dialog.locator('input[aria-label="Choose selfie"]').setInputFiles({
        name: 'iphone-selfie.jpg', mimeType: 'image/jpeg',
        buffer: Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]),
    });
    await expect(dialog.getByText('Preparing face search 55 / 101')).toBeVisible();
    await expect(dialog.getByText('2 photos found')).toBeVisible();
    expect(searchRequests).toBe(2);
    expect(soloOptions).toEqual(['false', 'false']);
    expect(uploadedSelfies).toHaveLength(2);
    for (const uploaded of uploadedSelfies) {
        expect(uploaded).toMatchObject({ width: 640, height: 1280, type: 'image/jpeg' });
        expect(uploaded.size).toBeLessThan(4 * 1024 * 1024);
        expect(uploaded.top[0]).toBeGreaterThan(200);
        expect(uploaded.top[2]).toBeLessThan(30);
    }
    expect(browserModelRequests).toBe(0);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: 'test-results/selfie-filter-results-desktop.png', animations: 'disabled' });
    await page.setViewportSize({ width: 320, height: 568 });
    await dialog.locator('summary').click();
    await dialog.getByRole('button', { name: 'Wider', exact: true }).click();
    await expect(dialog.getByText('2 photos found')).toBeVisible();
    const soloCheckbox = dialog.getByRole('checkbox', { name: 'Solo Photos Only' });
    await soloCheckbox.check();
    await expect(dialog.getByText('1 photos found')).toBeVisible();
    expect(soloOptions.at(-1)).toBe('true');
    const box = await dialog.getByRole('button', { name: 'Show 1 photos' }).boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(568);
    expect(await dialog.locator('.gallery-modal-scroll').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: 'test-results/selfie-filter-results-mobile.png', animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Show 1 photos' }).click();
    await page.setViewportSize({ width: 390, height: 844 });

    await expect(selfieTab(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Select photo-002.jpg' }).click();
    await chooseGalleryRefineView(page, 'Picked');
    await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(1);
    await page.getByRole('button', { name: 'Edited Photos', exact: true }).click();
    await expect(page.getByLabel('Edited photos password', { exact: true })).toBeVisible();
    await chooseGalleryRefineView(page, 'Picked');
    await expect(page.getByRole('button', { name: 'Remove photo-002.jpg' })).toBeVisible();
    await selfieTab(page).click();
    await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(1);
    await selfieTab(page).click();
    await expect(page.getByRole('dialog', { name: 'Filter by selfie' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Filter by selfie' }).getByRole('button', { name: 'Reset', exact: true }).click();
    await page.getByRole('button', { name: 'Close Filter by selfie' }).click();
    await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(0);
    await chooseGalleryRefineView(page, 'Picked');
    await selfieTab(page).click();
    await expect(page.getByRole('dialog', { name: 'Filter by selfie' })).toBeVisible();
    await page.getByRole('button', { name: 'Close Filter by selfie' }).click();
    await chooseGalleryRefineView(page, 'All Photos');
    await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(54);
    await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
    await expect(page.getByTestId('selection-summary').getByRole('status')).toHaveText('Not submitted');
    await page.getByRole('button', { name: 'Review Selection' }).click();
    await page.getByRole('dialog', { name: 'Review Selection' }).getByRole('button', { name: 'Submit for Editing' }).click();
    await expect(page.getByText('Selection saved. 1 filenames submitted.')).toBeVisible();

    const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
});

test('selfie search shows index-changed errors and can retry without browser scanning', async ({ page }) => {
    const id = 'changed-face-index';
    await installSession(page, id);
    await mockFaceSearchAvailable(page, id, 'ready');
    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({ json: {
        gallery: gallery('2026-09-05T03:00:00.000Z'), photos: [photo(1)], page: 1, pageSize: 54,
        total: 1, totalPages: 1, selectedDriveFileIds: [], selectedPhotos: [],
    } }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
    let attempts = 0;
    let browserModels = 0;
    await page.route(/\/(?:models\/face-api|vendor\/face-api)\//, (route) => { browserModels++; return route.abort(); });
    await page.route(`**/api/public/galleries/${id}/face-search`, (route) => {
        attempts++;
        return attempts === 1
            ? route.fulfill({ status: 409, json: { code: 'index_changed', error: 'This gallery changed during your search. Please try again.' } })
            : route.fulfill({ json: { status: 'complete', total: 1, matches: [photo(1)] } });
    });
    await page.goto(`/culling/${id}`);
    await selfieTab(page).click();
    const dialog = page.getByRole('dialog', { name: 'Filter by selfie' });
    const file = { name: 'selfie.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=', 'base64') };
    await dialog.getByLabel('Choose selfie', { exact: true }).setInputFiles(file);
    await expect(dialog.getByRole('alert')).toHaveText('This gallery changed during your search. Please try again.');
    await dialog.getByLabel('Choose selfie', { exact: true }).setInputFiles(file);
    await expect(dialog.getByText('1 photos found', { exact: true })).toBeVisible();
    expect(attempts).toBe(2);
    expect(browserModels).toBe(0);
});

for (const theme of ['black', 'white'] as const) {
    test(`selfie modal keeps the ${theme} gallery theme across search states and the body portal`, async ({ page }) => {
        const id = `face-theme-${theme}`;
        const accent = theme === 'black' ? 'rgb(255, 255, 255)' : 'rgb(17, 17, 17)';
        const surface = theme === 'black' ? 'rgb(13, 13, 13)' : 'rgb(255, 255, 255)';
        const inverse = theme === 'black' ? 'rgb(5, 5, 5)' : 'rgb(247, 247, 245)';
        await installSession(page, id);
        await mockFaceSearchAvailable(page, id);
        await page.addInitScript(({ id, theme }) => {
            localStorage.setItem(`orbit_culling_theme_${id}`, theme);
        }, { id, theme });
        await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
        await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({
            json: {
                gallery: gallery('2026-09-05T03:00:00.000Z'), photos: [photo(1)],
                page: 1, pageSize: 54, total: 1, totalPages: 1,
                selectedDriveFileIds: [], selectedPhotos: [],
            },
        }));
        await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));
        await page.goto(`/culling/${id}`);
        // The admin/body theme is deliberately opposite to the gallery's local theme.
        await page.evaluate((theme) => document.documentElement.classList.toggle('light', theme === 'black'), theme);
        const adminAccent = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--accent'));
        await selfieTab(page).click();
        const dialog = page.getByRole('dialog', { name: 'Filter by selfie' });
        const chooser = dialog.getByRole('button', { name: 'Choose selfie', exact: true });
        await expect(chooser).toHaveCSS('background-color', accent);
        await expect(chooser).toHaveCSS('color', inverse);
        await expect(dialog.locator('.gallery-modal-panel')).toHaveCSS('background-color', surface);
        await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await page.keyboard.press('Tab');
        await expect(dialog.getByRole('button', { name: 'Close Filter by selfie' })).toBeFocused();
        await expect(dialog.getByRole('button', { name: 'Close Filter by selfie' })).toHaveCSS('outline-color', accent);
        await page.keyboard.press('Tab');
        await expect(chooser).toBeFocused();
        await expect(chooser).toHaveCSS('outline-color', accent);

        for (const [width, height] of [[1280, 800], [390, 844], [320, 568]]) {
            await page.setViewportSize({ width, height });
            await expect(dialog.locator('.gallery-modal-panel')).toBeVisible();
            expect(await dialog.locator('.gallery-modal-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
            const footer = await dialog.locator('footer').boundingBox();
            expect(footer!.y + footer!.height).toBeLessThanOrEqual(height);
            await page.screenshot({ path: `test-results/selfie-${theme}-${width}.png`, animations: 'disabled' });
        }
        await dialog.locator('summary').click();
        await expect(dialog.getByRole('button', { name: 'Balanced', exact: true })).toHaveCSS('background-color', accent);
        const soloCheckbox = dialog.getByRole('checkbox', { name: 'Solo Photos Only' });
        await expect(soloCheckbox).not.toBeChecked();
        await expect(soloCheckbox).toHaveCSS('accent-color', accent);
        await soloCheckbox.focus();
        await expect(soloCheckbox).toBeFocused();
        await dialog.getByRole('button', { name: 'Wider', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'Wider', exact: true })).toHaveCSS('background-color', accent);
        await expect(dialog.getByRole('button', { name: 'Wider', exact: true })).toHaveAttribute('aria-pressed', 'true');

        await page.evaluate((matchedPhoto) => {
            window.__ORBIT_FACE_SEARCH_TEST__ = async ({ selfieFile, onProgress }) => {
                onProgress?.({ phase: 'worker', processed: 1, total: 2, matches: 0 });
                await new Promise<void>((resolve) => {
                    (window as Window & { finishFaceSearch?: () => void }).finishFaceSearch = resolve;
                });
                if (selfieFile.name === 'error.png') throw new Error('Unable to read this selfie.');
                return {
                    status: 'complete',
                    total: 2,
                    matches: selfieFile.name === 'empty.png' ? [] : [{ photo: matchedPhoto, distance: 0.42 }],
                } satisfies FaceSearchResult;
            };
        }, photo(2));
        const upload = async (name: string) => {
            await dialog.locator('input[aria-label="Choose selfie"]').setInputFiles({
                name, mimeType: 'image/png',
                buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=', 'base64'),
            });
            await expect(dialog.getByRole('progressbar')).toHaveCSS('accent-color', accent);
            await expect(dialog.getByRole('button', { name: 'Change selfie' })).toBeDisabled();
            await expect(dialog.getByRole('button', { name: 'Cancel search' })).toBeVisible();
        };
        const finish = () => page.evaluate(() => (window as Window & { finishFaceSearch?: () => void }).finishFaceSearch?.());
        await upload('match.png');
        await page.screenshot({ path: `test-results/selfie-${theme}-scanning.png`, animations: 'disabled' });
        await finish();
        await expect(dialog.getByText('1 photos found')).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Show 1 photos' })).toHaveCSS('background-color', accent);
        await page.screenshot({ path: `test-results/selfie-${theme}-results.png`, animations: 'disabled' });

        await upload('empty.png');
        await finish();
        await expect(dialog.getByText('No matching photos yet')).toBeVisible();
        await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await upload('error.png');
        await finish();
        await expect(dialog.getByRole('alert')).toHaveText('Unable to read this selfie.');

        await page.emulateMedia({ reducedMotion: 'reduce' });
        const reset = dialog.getByRole('button', { name: 'Reset', exact: true });
        await expect(reset).toHaveCSS('transition-property', 'none');
        await reset.hover();
        await page.mouse.down();
        await expect(reset).toHaveCSS('transform', 'none');
        await page.mouse.up();
        await expect(dialog.getByRole('button', { name: 'Choose selfie', exact: true })).toBeEnabled();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(selfieTab(page)).toBeFocused();
        expect(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--accent'))).toBe(adminAccent);
    });
}

test('hides selfie filtering offline and reveals its mobile label when the worker recovers', async ({ page }) => {
    const id = 'face-worker-offline-gallery';
    await page.setViewportSize({ width: 320, height: 740 });
    await installSession(page, id);
    await page.unroute('**/face-search/status');
    let ready = false;
    let statusRequests = 0;
    await page.route(`**/api/public/galleries/${id}/face-search/status`, (route) => {
        statusRequests += 1;
        return route.fulfill({ json: {
            available: ready, status: ready ? 'not_indexed' : 'unavailable', processed: 0, total: 0,
        } });
    });
    await page.route(`**/api/public/galleries/${id}/contact`, (route) => route.fulfill({ json: {} }));
    await page.route(`**/api/public/galleries/${id}/photos?*`, (route) => route.fulfill({
        json: {
            gallery: gallery('2026-09-05T03:00:00.000Z'), photos: [photo(1)],
            page: 1, pageSize: 54, total: 1, totalPages: 1,
            selectedDriveFileIds: [], selectedPhotos: [],
        },
    }));
    await page.route(`**/api/public/galleries/${id}/photos/*/thumbnail?*`, (route) => fulfillImage(route, 320, 320));

    await page.goto(`/culling/${id}`);
    await expect.poll(() => statusRequests).toBeGreaterThan(0);
    await expect(selfieTab(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(1);
    ready = true;
    const filter = selfieTab(page);
    await expect(filter).toBeEnabled({ timeout: 8_000 });
    await expect(filter).toHaveAttribute('title', 'Selfie');
    for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 740 });
        const bounds = await filter.boundingBox();
        const tabs = await page.getByRole('navigation', { name: 'Gallery views' }).boundingBox();
        expect(bounds).not.toBeNull();
        expect(tabs).not.toBeNull();
        expect(bounds!.y).toBeCloseTo(tabs!.y, 0);
        expect(bounds!.height).toBeGreaterThanOrEqual(44);
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: `test-results/selfie-toolbar-${width}.png`, animations: 'disabled' });
    }
    await filter.click();
    await expect(page.getByRole('dialog', { name: 'Filter by selfie' })).toBeVisible();
});
