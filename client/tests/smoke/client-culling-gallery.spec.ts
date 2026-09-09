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
        tutorialSampleSlots: [1, 2, 3],
    };
}

function galleryWithTitle(title: string, deadline = '2026-09-05T03:00:00.000Z') {
    return { ...gallery(deadline), title };
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
        const visibleTiles = [...document.querySelectorAll('button[aria-label^="Open Full Frame Test Gallery"]')]
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
    await expect(page.getByRole('button', { name: /^Open Full Frame Test Gallery/ })).toHaveCount(54);
    await expectMobileGalleryViewport(page, 375, 667);
    await expectMobileGalleryViewport(page, 390, 844);
    await expectMobileGalleryViewport(page, 414, 896);

    const nextPage = page.getByRole('button', { name: 'Next' });
    await nextPage.scrollIntoViewIfNeeded();
    await nextPage.click();
    await expect.poll(() => secondPageRequests).toBeGreaterThan(0);
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Open Full Frame Test Gallery/ })).toHaveCount(47);

    const lastPhoto = page.getByRole('button', { name: 'Open Full Frame Test Gallery 101' });
    await lastPhoto.scrollIntoViewIfNeeded();
    await expect(lastPhoto).toBeVisible();
    await lastPhoto.click();

    await expect(page.getByTestId('gallery-lightbox-footer').getByText('Full Frame Test Gallery 101', { exact: true })).toBeVisible();
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
    await page.getByRole('button', { name: 'Open Full Frame Test Gallery 54' }).click();
    await expect(page.getByTestId('gallery-lightbox-footer').getByText('Full Frame Test Gallery 54', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Next photo' }).click();
    await expect(page.getByTestId('gallery-lightbox-footer').getByText('Full Frame Test Gallery 55', { exact: true })).toBeVisible();
    await expect(page.getByTestId('gallery-lightbox-footer').getByText('55 / 101')).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('gallery-lightbox-footer').getByText('Full Frame Test Gallery 54', { exact: true })).toBeVisible();
    await expect(page.getByTestId('gallery-lightbox-footer').getByText('54 / 101')).toBeVisible();

    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('gallery-lightbox-footer').getByText('Full Frame Test Gallery 55', { exact: true })).toBeVisible();
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

test('keeps long Google Drive filenames below the image and uses a short client label', async ({ page }) => {
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
    const opener = page.getByRole('button', { name: 'Open Kevin Prewedding 01' });
    await expect(opener).toBeVisible();
    await expect(page.getByText('Kevin Prewedding 01', { exact: true })).toBeVisible();
    await expect(page.getByText(longName)).toHaveCount(0);

    const layout = await page.evaluate(() => {
        const openerElement = document.querySelector('button[aria-label="Open Kevin Prewedding 01"]');
        const tile = openerElement?.closest('article')?.getBoundingClientRect();
        const image = openerElement?.getBoundingClientRect();
        const label = [...document.querySelectorAll('p')].find((node) => node.textContent === 'Kevin Prewedding 01')?.getBoundingClientRect();
        return {
            imageBottom: image?.bottom ?? 0,
            imageHeight: image?.height ?? 0,
            labelTop: label?.top ?? 0,
            tileHeight: tile?.height ?? 0,
        };
    });

    expect(layout.labelTop).toBeGreaterThanOrEqual(layout.imageBottom - 1);
    expect(layout.tileHeight).toBeGreaterThan(layout.imageHeight);
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
    await page.getByRole('button', { name: 'Select Full Frame Test Gallery 01' }).click();
    await expect(page.getByText('Not submitted')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: 'Remove Full Frame Test Gallery 01' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Not submitted')).toBeVisible();

    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.getByRole('button', { name: 'Submit 1' }).click();
    await expect(page.getByText('Selection saved. 1 filenames submitted.')).toBeVisible();
    await expect(page.getByText('Not submitted')).toHaveCount(0);
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
    await expect(page.getByRole('heading', { name: 'Enter PIN' })).toBeVisible();
    await expect(page.evaluate((galleryKey) => localStorage.getItem(`orbit_culling_token_${galleryKey}`), id)).resolves.toBeNull();
});

test('shows the before and edited tutorial slider with pointer and keyboard controls', async ({ page }) => {
    const id = 'tutorial-slider-gallery';
    await page.setViewportSize({ width: 390, height: 844 });
    await installSession(page, id);

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
    await page.route(`**/api/public/galleries/${id}/tutorial/*/before?*`, (route) => fulfillImage(route, 1600, 1067));
    await page.route(`**/api/public/galleries/${id}/tutorial/*/after?*`, (route) => fulfillImage(route, 1600, 1067));

    await page.goto(`/culling/${id}`);
    await page.getByRole('button', { name: 'How to submit' }).click();
    await expect(page.getByTestId('tutorial-confidence-step')).toBeVisible();
    await expect(page.getByText('Sample 01 / 03')).toBeVisible();
    await expect(page.getByAltText('Before editing sample')).toBeVisible();
    await expect(page.getByAltText('Edited result sample')).toBeVisible();

    const handle = page.getByTestId('tutorial-slider-handle');
    await expect(handle).toHaveAttribute('aria-valuenow', '50');
    const slider = page.getByTestId('tutorial-before-after-slider');
    const sliderBox = await slider.boundingBox();
    expect(sliderBox).not.toBeNull();
    await page.mouse.move((sliderBox?.x ?? 0) + (sliderBox?.width ?? 0) * 0.25, (sliderBox?.y ?? 0) + (sliderBox?.height ?? 0) / 2);
    await page.mouse.down();
    await page.mouse.move((sliderBox?.x ?? 0) + (sliderBox?.width ?? 0) * 0.75, (sliderBox?.y ?? 0) + (sliderBox?.height ?? 0) / 2);
    await page.mouse.up();
    await expect(handle).toHaveAttribute('aria-valuenow', '75');

    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(handle).toHaveAttribute('aria-valuenow', '70');

    await page.getByRole('button', { name: 'Next sample' }).click();
    await expect(page.getByText('Sample 02 / 03')).toBeVisible();
    await page.getByRole('button', { name: 'Next sample' }).click();
    await expect(page.getByText('Sample 03 / 03')).toBeVisible();
    await page.getByRole('button', { name: 'How to submit', exact: true }).last().click();
    await expect(page.getByTestId('tutorial-submit-step')).toBeVisible();
    await page.getByRole('button', { name: 'Ready to choose' }).click();
    await expect(page.getByTestId('tutorial-ready-step')).toBeVisible();

    const dialog = page.getByRole('dialog', { name: 'How photo selection works' });
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(844);

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
    await page.route(`**/api/public/galleries/${id}/tutorial/*/before?*`, (route) => fulfillImage(route, 1600, 1067));
    await page.route(`**/api/public/galleries/${id}/tutorial/*/after?*`, (route) => fulfillImage(route, 1600, 1067));

    await page.goto(`/culling/${id}`);
    await page.getByRole('button', { name: 'How to submit' }).click();
    await expect(page.getByText('Sample 01 / 02')).toBeVisible();
    await page.getByRole('button', { name: 'Next sample' }).click();
    await expect(page.getByText('Sample 02 / 02')).toBeVisible();
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
    await page.getByRole('button', { name: 'How to submit' }).click();
    await expect(page.getByTestId('tutorial-submit-step')).toBeVisible();
    await expect(page.getByTestId('tutorial-confidence-step')).toHaveCount(0);
});
