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

test('filters immediately from a selfie and keeps selection submit working', async ({ page }) => {
    const id = 'face-filter-gallery';
    await page.setViewportSize({ width: 390, height: 844 });
    await installSession(page, id);
    await page.unroute('**/face-search/status');
    let indexingStarted = false;
    let statusPolls = 0;
    let searchRequests = 0;
    let browserModelRequests = 0;
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
        return route.fulfill({ json: { status: 'complete', total: 101, matches: [photo(2), photo(56)] } });
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
    await expect(page.getByRole('button', { name: /^Open Full Frame Test Gallery/ })).toHaveCount(54);
    await page.getByRole('button', { name: 'Filter by selfie' }).click();
    const dialog = page.getByRole('dialog', { name: 'Filter by selfie' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
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
    const box = await dialog.getByRole('button', { name: 'Show 2 photos' }).boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(568);
    expect(await dialog.locator('.gallery-modal-scroll').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: 'test-results/selfie-filter-results-mobile.png', animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Show 2 photos' }).click();
    await page.setViewportSize({ width: 390, height: 844 });

    await expect(page.getByRole('button', { name: 'Face (2)' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Open Full Frame Test Gallery/ })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Select Full Frame Test Gallery 02' }).click();
    await expect(page.getByText('Not submitted')).toBeVisible();
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await page.getByRole('button', { name: 'Submit 1' }).click();
    await expect(page.getByText('Selection saved. 1 filenames submitted.')).toBeVisible();

    await page.getByRole('button', { name: 'Face (2)' }).click();
    await dialog.getByRole('button', { name: 'Reset' }).click();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Filter by selfie' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();

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
    await page.getByRole('button', { name: 'Filter by selfie' }).click();
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
        await page.getByRole('button', { name: 'Filter by selfie' }).click();
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
        await expect(page.getByRole('button', { name: 'Filter by selfie' })).toBeFocused();
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
    await expect(page.getByRole('button', { name: 'Filter by selfie' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Open Full Frame Test Gallery/ })).toHaveCount(1);
    ready = true;
    const filter = page.getByRole('button', { name: 'Filter by selfie' });
    await expect(filter).toBeVisible({ timeout: 8_000 });
    await expect(filter.getByText('Selfie', { exact: true })).toBeVisible();
    for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 740 });
        const bounds = await filter.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: `test-results/selfie-toolbar-${width}.png`, animations: 'disabled' });
    }
    await filter.click();
    await expect(page.getByRole('dialog', { name: 'Filter by selfie' })).toBeVisible();
});
