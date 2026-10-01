import { expect, test } from '@playwright/test';

for (const theme of ['black', 'white']) {
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        test(`comparison is opt-in and navigates safely: ${theme} ${viewport.width}`, async ({ page }, testInfo) => {
            await page.setViewportSize(viewport);
            await page.addInitScript((theme) => {
                localStorage.setItem('orbit:edit-results-token:comparison', 'delivery-token');
                localStorage.setItem('orbit_culling_theme_comparison', theme);
            }, theme);
            const photos = Array.from({ length: 3 }, (_, index) => ({
                driveFileId: `edited-${index}`, filename: `edited-${index}.jpg`, displayOrder: index, width: index === 1 ? 900 : 1200, height: index === 1 ? 1200 : 900,
                thumbnailUrl: `/fixture/edited-${index}/thumbnail`, previewUrl: `/fixture/edited-${index}/preview`, downloadUrl: 'https://drive.google.com/uc?id=test',
                comparison: index === 2 ? null : { thumbnailUrl: '/fixture/before/thumbnail', previewUrl: '/fixture/before/preview' },
            }));
            let beforeRequests = 0;
            let fail = true;
            await page.route('**/edit-results/photos/**', async (route) => {
                if (route.request().url().includes('/before/')) {
                    beforeRequests += 1;
                    if (fail) return route.fulfill({ status: 502, body: 'unavailable' });
                }
                const portrait = route.request().url().includes('edited-1');
                return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${portrait ? 900 : 1200}" height="${portrait ? 1200 : 900}"><rect width="100%" height="100%" fill="#58796f"/><circle cx="450" cy="400" r="200" fill="#b5d2c8"/></svg>` });
            });
            await page.route('**/edit-results/status', (route) => route.fulfill({ json: { available: true, photoCount: 3 } }));
            await page.route('**/edit-results?token=delivery-token', (route) => route.fulfill({ json: { photos, archive: { filename: 'all.zip', downloadUrl: 'https://drive.google.com/uc?id=zip' } } }));
            await page.goto('/culling/comparison');
            await page.getByRole('button', { name: 'Open edited-0.jpg', exact: true }).click();
            const checkbox = page.getByRole('checkbox', { name: 'Before / After' });
            await expect(checkbox).not.toBeChecked();
            expect(beforeRequests).toBe(0);
            await checkbox.check();
            await expect(page.getByText('Comparison Unavailable', { exact: false })).toBeVisible();
            await expect(page.getByTestId('gallery-lightbox-image')).toHaveAttribute('src', /edited-0\/preview/);
            fail = false;
            await page.getByRole('button', { name: 'Retry', exact: true }).click();
            const handle = page.getByRole('slider', { name: 'Compare before and edited photo' });
            await expect(handle).toHaveAttribute('aria-valuenow', '50');
            await handle.focus();
            await page.keyboard.press('ArrowRight');
            await expect(handle).toHaveAttribute('aria-valuenow', '55');
            await expect(page.getByTestId('gallery-lightbox-image')).toHaveAttribute('src', /edited-0\/preview/);
            const stage = page.getByTestId('delivery-before-after-slider');
            const bounds = await stage.boundingBox();
            await page.mouse.move(bounds!.x + bounds!.width * .4, bounds!.y + bounds!.height * .5);
            await page.mouse.down();
            await page.mouse.move(bounds!.x + bounds!.width * .7, bounds!.y + bounds!.height * .5);
            await page.mouse.up();
            await expect(page.getByTestId('gallery-lightbox-image')).toHaveAttribute('src', /edited-0\/preview/);
            await page.getByRole('button', { name: 'Next photo', exact: true }).click();
            await expect(checkbox).toBeChecked();
            await expect(handle).toHaveAttribute('aria-valuenow', '50');
            const footer = await page.getByTestId('gallery-lightbox-footer').boundingBox();
            const media = await stage.boundingBox();
            expect(media!.y + media!.height).toBeLessThanOrEqual(footer!.y);
            expect(media!.width / media!.height).toBeCloseTo(900 / 1200, 2);
            await page.screenshot({ path: testInfo.outputPath('comparison.png') });
            await page.getByRole('button', { name: 'Next photo', exact: true }).click();
            await expect(checkbox).toHaveCount(0);
            await expect(stage).toHaveCount(0);
            await page.getByRole('button', { name: 'Previous photo', exact: true }).click();
            await expect(checkbox).toBeChecked();
            await page.keyboard.press('Escape');
            await expect(page.getByTestId('gallery-lightbox-stage')).toHaveCount(0);
            await page.getByRole('button', { name: 'Open edited-0.jpg', exact: true }).click();
            await expect(checkbox).not.toBeChecked();
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await checkbox.check();
            await expect(handle).toHaveAttribute('aria-valuenow', '50');
        });
    }
}
