import { expect, test } from '@playwright/test';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5174' });

for (const withArchive of [true, false]) {
test(`edited photos reuse culling tiles and lightbox ${withArchive ? 'with' : 'without'} a ZIP`, async ({ page, context }) => {
    const archive = withArchive ? {
        filename: 'edited-photos.zip',
        downloadUrl: 'https://drive.google.com/uc?export=download&id=edited-archive&resourcekey=archive-key',
        downloadResolveUrl: '/api/public/galleries/edited-gallery/edit-results/archive/download-url?token=edit-results-token',
    } : null;
    const photos = Array.from({ length: 55 }, (_, index) => ({
        driveFileId: `edited-file-${index + 1}`,
        filename: index === 0 ? 'final-photo.jpg' : `final-photo-${index + 1}.jpg`,
        mimeType: 'image/jpeg',
        thumbnailUrl: `/api/public/galleries/edited-gallery/edit-results/photos/edited-file-${index + 1}/thumbnail?token=edit-results-token`,
        previewUrl: `/api/public/galleries/edited-gallery/edit-results/photos/edited-file-${index + 1}/preview?token=edit-results-token`,
        downloadUrl: `https://drive.google.com/uc?export=download&id=edited-file-${index + 1}`,
        downloadResolveUrl: `/api/public/galleries/edited-gallery/edit-results/photos/edited-file-${index + 1}/download-url?token=edit-results-token`,
        width: 3000,
        height: 2000,
        displayOrder: index,
    }));
    await page.route('**/edit-results/status', (route) => route.fulfill({ json: { available: true, photoCount: photos.length } }));
    await page.route('**/api/public/galleries/edited-gallery/verify', (route) => route.fulfill({
        status: 403,
        json: { error: 'The selection deadline has ended.', code: 'GALLERY_EXPIRED', contactUrl: null },
    }));
    await page.route('**/edit-results/verify', async (route) => {
        const body = route.request().postDataJSON() as { password?: string };
        expect(body.password).toBe('orbit-delivery-key');
        await route.fulfill({ json: { token: 'edit-results-token', expiresIn: 3600 } });
    });
    await page.route('**/edit-results?token=edit-results-token', (route) => route.fulfill({
        json: {
            publishedAt: '2026-10-01T00:00:00.000Z',
            photos,
            archive,
        },
    }));
    await page.route('**/edit-results/photos/*/*?token=edit-results-token', (route) => route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#777"/></svg>',
    }));
    await page.route('**/edit-results/photos/*/download-url?token=edit-results-token', (route) => {
        const fileId = new URL(route.request().url()).pathname.split('/').at(-2)!;
        return route.fulfill({ json: { downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`, filename: `${fileId}.jpg` } });
    });
    await page.route('**/edit-results/archive/download-url?token=edit-results-token', (route) => route.fulfill({
        json: { downloadUrl: archive?.downloadUrl, filename: archive?.filename },
    }));
    const driveDownloads: string[] = [];
    await context.route('https://drive.google.com/uc?**', async (route) => {
        driveDownloads.push(route.request().url());
        await route.fulfill({ contentType: 'application/octet-stream', headers: { 'Content-Disposition': 'attachment; filename="download.jpg"' }, body: 'download' });
    });

    await page.goto('/culling/edited-gallery');
    await page.getByPlaceholder('Gallery PIN').fill('1234');
    await page.getByRole('button', { name: 'Unlock gallery', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Selection Closed' })).toBeVisible();
    await page.getByRole('button', { name: 'Have an edited photos password?' }).click();
    await expect(page.getByText('The selection deadline has ended. Please contact the admin if you need more time.')).toHaveCount(0);
    await page.getByPlaceholder('Edited photos password').fill('orbit-delivery-key');
    await page.getByRole('button', { name: 'Open Edited Photos' }).click();

    await expect(page.getByRole('heading', { name: 'Edited Photos' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Gallery views' }).getByRole('button')).toHaveCount(3);
    await expect(page.getByText('55 photos', { exact: true })).toHaveCount(0);
    await expect(page.getByText('FINAL DELIVERY', { exact: true })).toHaveCount(0);
    await expect(page.getByText('final-photo.jpg')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download final-photo.jpg' })).toBeVisible();
    const downloadAll = page.getByRole('button', { name: 'Download All (.zip)' });
    if (archive) {
        await expect(page.getByTestId('gallery-toolbar').getByRole('button', { name: 'Download All (.zip)' })).toBeVisible();
    } else {
        await expect(downloadAll).toHaveCount(0);
    }
    const grid = page.getByTestId('edited-gallery-grid');
    await expect(grid.locator('article')).toHaveCount(54);
    await expect(grid.locator('img').first()).toHaveAttribute('src', /\/thumbnail\?/);
    await expect(page.getByRole('button', { name: /^Select / })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open final-photo-54.jpg', exact: true }).click();
    await expect(page.getByTestId('gallery-lightbox-image')).toHaveAttribute('src', /edited-file-54\/preview\?/);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('gallery-lightbox-image')).toHaveAttribute('src', /edited-file-55\/preview\?/);
    await expect(page.getByTestId('gallery-lightbox-stage').locator('img').first()).toHaveAttribute('src', /edited-file-55\/thumbnail\?/);
    await page.getByRole('button', { name: 'Download Original', exact: true }).click();
    await expect.poll(() => driveDownloads.at(-1)).toContain('id=edited-file-55');
    const stage = page.getByTestId('gallery-lightbox-stage');
    await stage.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 100 });
    await stage.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 220 });
    await expect(page.getByTestId('gallery-lightbox-image')).toHaveAttribute('src', /edited-file-54\/preview\?/);
    await stage.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 220 });
    await stage.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 100 });
    await expect(page.getByTestId('gallery-lightbox-image')).toHaveAttribute('src', /edited-file-55\/preview\?/);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('gallery-lightbox-stage')).toHaveCount(0);
    await expect(grid.locator('article')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: 'Edited photos pages' })).toContainText('Page 2 of 2');

    if (!archive) return;
    await downloadAll.click();
    await expect.poll(() => driveDownloads.at(-1)).toBe(archive.downloadUrl);
});
}

test('download resolver failure announces a retryable error without opening a blank tab', async ({ page, context }) => {
    const galleryId = 'download-error';
    await page.addInitScript((id) => localStorage.setItem(`orbit:edit-results-token:${id}`, 'edited-token'), galleryId);
    await page.route('**/edit-results/status', (route) => route.fulfill({ json: { available: true, photoCount: 0 } }));
    await page.route('**/edit-results?token=edited-token', (route) => route.fulfill({ json: {
        photos: [],
        archive: {
            filename: 'edited.zip',
            downloadUrl: 'https://drive.google.com/uc?export=download&id=legacy',
            downloadResolveUrl: `/api/public/galleries/${galleryId}/edit-results/archive/download-url?token=edited-token`,
        },
    } }));
    await page.route('**/edit-results/archive/download-url?token=edited-token', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        await route.fulfill({ status: 502, json: { error: 'Google Drive cannot prepare this ZIP right now.', code: 'DRIVE_DOWNLOAD_UNAVAILABLE' } });
    });

    await page.goto(`/culling/${galleryId}?view=edit-results`);
    const pageCount = context.pages().length;
    await page.getByRole('button', { name: 'Download All (.zip)' }).click();
    await expect(page.getByText('Preparing download…')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Google Drive cannot prepare this ZIP right now.');
    await expect.poll(() => context.pages().length).toBe(pageCount);
    await expect(page.getByRole('button', { name: 'Download All (.zip)' })).toBeEnabled();
});
