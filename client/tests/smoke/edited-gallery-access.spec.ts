import { expect, test } from '@playwright/test';

for (const state of ['closed', 'expired', 'draft'] as const) {
    test(`edited ${state} access does not ask for a password`, async ({ page }) => {
        await page.route('**/api/public/galleries/closed-edited/**', (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: false, status: state === 'expired' ? 'closed' : state, isExpired: state === 'expired', photoCount: 3 } });
            return route.fulfill({ status: 403, json: { error: 'Access closed', code: state === 'expired' ? 'EDIT_RESULTS_EXPIRED' : 'EDIT_RESULTS_CLOSED' } });
        });
        await page.goto('/culling/closed-edited?view=edit-results');
        await expect(page.getByRole('heading', { name: state === 'expired' ? 'Edited Photos access expired' : 'Edited Photos unavailable', exact: true })).toBeVisible();
        await expect(page.getByLabel('Edited photos password', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Download All (.zip)' })).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Having trouble? Download backup ZIP' })).toHaveCount(0);
    });
}

for (const access of ['edited-only', 'expired', 'closed', 'invalid', 'open'] as const) {
    test(`edited gallery navigation with ${access} selection access`, async ({ page }) => {
        const id = 'edited-access';
        await page.addInitScript(({ id, access }) => {
            localStorage.setItem(`orbit:edit-results-token:${id}`, 'edited-token');
            localStorage.setItem(`orbit_culling_tutorial_${id}`, '1');
            if (access !== 'edited-only') localStorage.setItem(`orbit_culling_token_${id}`, 'selection-token');
        }, { id, access });
        await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: true } });
            if (path.endsWith('/edit-results')) return route.fulfill({ json: { photos: [], archive: null } });
            if (path.endsWith('/photos')) {
                if (access === 'invalid') return route.fulfill({ status: 401, json: { error: 'Session expired' } });
                if (access === 'closed' || access === 'expired') return route.fulfill({ status: 403, json: { error: 'Selection unavailable', code: access === 'closed' ? 'GALLERY_CLOSED' : 'GALLERY_EXPIRED' } });
                return route.fulfill({ json: { gallery: { id: 1, title: 'Access test', status: 'open', maxSelections: 30, hasEditResults: true }, photos: [], page: 1, total: 0, totalPages: 1, selectedDriveFileIds: [] } });
            }
            return route.fulfill({ json: {} });
        });
        await page.goto(`/culling/${id}?view=edit-results&page=3&filter=submitted`);
        await expect(page.getByText('No edited photos are available.')).toBeVisible();
        const allPhotos = page.getByRole('button', { name: 'All Photos', exact: true });
        const selfie = page.getByRole('button', { name: 'Selfie', exact: true });
        if (access === 'open') {
            const selectionView = page.getByRole('button', { name: 'Submitted', exact: true });
            await expect(selectionView).toBeEnabled();
            await selectionView.click();
            await expect(page).toHaveURL(/page=3/);
            await expect(page).toHaveURL(/filter=submitted/);
            await expect(page.getByText('No Submitted Photos')).toBeVisible();
        } else if (access === 'edited-only' || access === 'invalid') {
            await expect(allPhotos).toBeEnabled();
            await allPhotos.click();
            await expect(page.getByLabel('Gallery PIN', { exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Back to Edited Photos', exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Have an edited photos password?' })).toHaveCount(0);
            await page.getByRole('button', { name: 'Back to Edited Photos', exact: true }).click();
            await expect(page.getByText('No edited photos are available.')).toBeVisible();
            await expect.poll(() => page.evaluate((galleryId) => localStorage.getItem(`orbit:edit-results-token:${galleryId}`), id)).toBe('edited-token');
        } else {
            await expect(allPhotos).toBeDisabled();
            await expect(selfie).toBeDisabled();
            await expect(page.getByRole('button', { name: 'Back to gallery', exact: true })).toHaveCount(0);
            await page.reload();
            await expect(page.getByText('No edited photos are available.')).toBeVisible();
            await expect(allPhotos).toBeDisabled();
        }
    });
}
