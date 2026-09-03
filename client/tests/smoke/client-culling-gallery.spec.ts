import { expect, test, type Page, type Route } from '@playwright/test';

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
    };
}

async function installSession(page: Page, id = galleryId) {
    await page.addInitScript(({ galleryKey, galleryToken }) => {
        localStorage.setItem(`orbit_culling_token_${galleryKey}`, galleryToken);
        localStorage.setItem(`orbit_culling_tutorial_${galleryKey}`, '1');
    }, { galleryKey: id, galleryToken: token });
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
    await expect(page.getByRole('button', { name: 'Submit', exact: true })).toBeVisible();

    const layout = await page.evaluate(() => {
        const grid = document.querySelector('[data-testid="gallery-grid"]')?.getBoundingClientRect();
        const submit = [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Submit')?.getBoundingClientRect();
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
            submitRight: submit?.right ?? 0,
            visibleTiles,
        };
    });

    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.submitRight).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.gridTop).toBeLessThan(125);
    expect(layout.visibleTiles).toBeGreaterThanOrEqual(6);
}

test('opens photo 101 on page 2 by driveFileId and keeps the full frame above the footer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installSession(page);

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
                    ? Array.from({ length: 50 }, (_, index) => photo(index + 1))
                    : Array.from({ length: 51 }, (_, index) => photo(index + 51)),
                page: requestedPage,
                pageSize: 50,
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
    await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(50);
    await expectMobileGalleryViewport(page, 375, 667);
    await expectMobileGalleryViewport(page, 390, 844);
    await expectMobileGalleryViewport(page, 414, 896);

    const nextPage = page.getByRole('button', { name: 'Next' });
    await nextPage.scrollIntoViewIfNeeded();
    await nextPage.click();
    await expect.poll(() => secondPageRequests).toBeGreaterThan(0);
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Open photo-/ })).toHaveCount(51);

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
