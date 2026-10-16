import { expect, test } from '@playwright/test';

const editedTestImage = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#78877f"/></svg>';

test('Edited password gate has Orbit branding and a responsive footer', async ({ page }) => {
    const id = 'edited-gate-branding';
    await page.route(`**/api/public/galleries/${id}/edit-results/status`, (route) => route.fulfill({ json: { available: true, title: 'Vira & Mus Prewedding' } }));
    await page.route(`**/api/public/galleries/${id}/edit-results/verify`, (route) => route.fulfill({ json: { token: 'short-password-token', expiresAt: null, expiresIn: null } }));
    await page.route(`**/api/public/galleries/${id}/edit-results?*`, (route) => route.fulfill({ json: { photos: [], folders: [], archive: null, expiresAt: null } }));
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/culling/${id}?view=edit-results`);
    await expect(page).toHaveURL(new RegExp(`/culling/${id}/edited$`));
    const card = page.getByTestId('edited-access-card');
    await expect(card.getByRole('img', { name: 'Orbit Logo' })).toBeVisible();
    await expect(card.getByRole('heading', { name: 'View Your Edited Photos' })).toBeVisible();
    await expect(card.getByText('Edited Gallery')).toBeVisible();
    await expect(card.getByText('Enter your password to view and download your finished gallery.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use Photo Selection password' })).toBeVisible();
    const footer = page.getByTestId('gallery-footer');
    await expect(footer.getByRole('link', { name: '@theorbitphoto on Instagram' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Switch to white mode' }).click();
    await expect(page.getByRole('button', { name: 'Switch to black mode' })).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(card).toBeVisible();
    await expect(footer).toBeVisible();
    const cardBox = await card.boundingBox();
    const footerBox = await footer.boundingBox();
    expect(cardBox && footerBox && footerBox.y >= cardBox.y + cardBox.height).toBe(true);

    await page.getByLabel('Edited photos password', { exact: true }).fill('a1');
    await page.getByRole('button', { name: 'Unlock Edited Photos' }).click();
    await expect(page.getByRole('heading', { name: 'Preparing your gallery…' })).toBeVisible();
    await expect(page.getByText('No edited photos are available.')).toBeVisible();
});

for (const state of ['closed', 'expired', 'draft'] as const) {
    test(`edited ${state} access does not ask for a password`, async ({ page }) => {
        await page.route('**/api/public/galleries/closed-edited/**', (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { available: false, status: state === 'expired' ? 'closed' : state, isExpired: state === 'expired', photoCount: 3 } });
            return route.fulfill({ status: 403, json: { error: 'Access closed', code: state === 'expired' ? 'EDIT_RESULTS_EXPIRED' : 'EDIT_RESULTS_CLOSED' } });
        });
        await page.goto('/culling/closed-edited?view=edit-results');
        await expect(page).toHaveURL(/\/culling\/closed-edited\/edited$/);
        await expect(page.getByRole('heading', { name: state === 'expired' ? 'Edited Photos access expired' : 'Edited Photos unavailable', exact: true })).toBeVisible();
        await expect(page.getByLabel('Edited photos password', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Download All Photos' })).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Having trouble? Download backup ZIP' })).toHaveCount(0);
    });
}

for (const access of ['edited-only', 'expired', 'closed', 'invalid', 'open'] as const) {
    test(`edited gallery navigation with ${access} selection access`, async ({ page }) => {
        const id = 'edited-access';
        await page.addInitScript(({ id, access }) => {
            localStorage.setItem(`orbit:edit-results-token:${id}`, 'edited-token');
            localStorage.setItem(`orbit:edit-results-guide:${id}`, 'seen');
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
        await expect(page).toHaveURL(`/culling/${id}/edited`);
        await expect(page.getByText('No edited photos are available.')).toBeVisible();
        const allPhotos = page.getByRole('navigation', { name: 'Gallery views' }).getByRole('button').first();
        if (access === 'open') {
            const selectionView = page.getByRole('button', { name: 'Submitted', exact: true });
            await expect(selectionView).toBeEnabled();
            await selectionView.click();
            await expect(page).toHaveURL(/filter=submitted/);
            await expect(page).not.toHaveURL(/page=3/);
            await expect(page.getByText('No Submitted Photos')).toBeVisible();
        } else if (access === 'edited-only' || access === 'invalid') {
            await expect(allPhotos).toBeEnabled();
            await allPhotos.click();
            await expect(page.getByLabel('Photo Selection password', { exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Back to Edited Photos', exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Use Edited Photos password' })).toHaveCount(0);
            await page.getByRole('button', { name: 'Back to Edited Photos', exact: true }).click();
            await expect(page.getByText('No edited photos are available.')).toBeVisible();
            await expect.poll(() => page.evaluate((galleryId) => localStorage.getItem(`orbit:edit-results-token:${galleryId}`), id)).toBe('edited-token');
        } else {
            const selectionView = page.getByRole('navigation', { name: 'Gallery views' }).getByRole('button').first();
            await selectionView.click();
            await expect(page.getByRole('heading', { name: access === 'expired' ? 'Selection Closed' : 'Gallery Locked' })).toBeVisible();
            await page.getByRole('button', { name: 'Access edited photos' }).click();
            await expect(page.getByText('No edited photos are available.')).toBeVisible();
            await page.reload();
            await expect(page.getByText('No edited photos are available.')).toBeVisible();
        }
    });
}

for (const theme of ['black', 'white']) {
    for (const width of [320, 390, 1440]) {
    test(`Wedding Edited Photos uses two aligned bars at ${width}px in ${theme}`, async ({ page }, testInfo) => {
        const id = `wedding-bars-${width}`;
        await page.setViewportSize({ width, height: 844 });
        await page.addInitScript(({ galleryId, theme }) => {
            localStorage.setItem(`orbit:edit-results-token:${galleryId}`, 'edited-token');
            localStorage.setItem(`orbit:edit-results-guide:${galleryId}`, 'seen');
            localStorage.setItem(`orbit_culling_theme_${galleryId}`, theme);
        }, { galleryId: id, theme });
        await page.route(`**/api/public/galleries/${id}/**`, (route) => {
            const path = new URL(route.request().url()).pathname;
            if (/\/(thumbnail|preview)$/.test(path)) return route.fulfill({ contentType: 'image/svg+xml', body: editedTestImage });
            if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { workflow: 'delivery_only', title: 'Kevin & Putri Wedding', available: true, photoCount: 1 } });
            if (path.endsWith('/edit-results')) return route.fulfill({ json: { photos: [{ driveFileId: 'edited-1', filename: 'edited-1.jpg', thumbnailUrl: `/api/public/galleries/${id}/edit-results/photos/edited-1/thumbnail`, previewUrl: `/api/public/galleries/${id}/edit-results/photos/edited-1/preview`, downloadResolveUrl: '/download' }], archive: { filename: 'wedding.zip', downloadResolveUrl: '/download' }, folders: [], expiresAt: null } });
            return route.fulfill({ json: {} });
        });
        await page.goto(`/culling/${id}?view=edit-results`);
        const header = page.getByTestId('gallery-header');
        const toolbar = page.getByTestId('gallery-toolbar');
        await expect(header.getByRole('heading', { name: 'Kevin & Putri Wedding' })).toBeVisible();
        await expect(toolbar.getByText('Edited Photos', { exact: true })).toBeVisible();
        await expect(toolbar.getByRole('button', { name: 'Download All Photos' })).toBeVisible();
        await expect(page.getByTestId('edited-gallery-grid')).toBeVisible();
        await expect(page.getByTestId('edited-gallery-grid').locator('img')).toHaveJSProperty('complete', true);
        await expect(page.getByTestId('edited-gallery-grid').getByText('Failed to load')).toHaveCount(0);
        await expect(page.getByRole('navigation', { name: 'Gallery views' })).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath('wedding-toolbar.png') });
        const headerBox = await header.boundingBox();
        const toolbarBox = await toolbar.boundingBox();
        expect(toolbarBox?.y).toBeCloseTo((headerBox?.y ?? 0) + (headerBox?.height ?? 0), 0);
    });
    }
}

test('Wedding access expires without leaving cached photos or downloads visible', async ({ page }) => {
    const id = 'wedding-access-deadline';
    const expiresAt = new Date(Date.now() + 5000).toISOString();
    await page.addInitScript((galleryId) => localStorage.setItem(`orbit:edit-results-token:${galleryId}`, 'edited-token'), id);
    await page.route(`**/api/public/galleries/${id}/**`, (route) => {
        const path = new URL(route.request().url()).pathname;
        if (/\/(thumbnail|preview)$/.test(path)) return route.fulfill({ contentType: 'image/svg+xml', body: editedTestImage });
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { workflow: 'delivery_only', title: 'Wedding Delivery', available: Date.now() < Date.parse(expiresAt), isExpired: Date.now() >= Date.parse(expiresAt), photoCount: 1 } });
        if (path.endsWith('/edit-results')) return route.fulfill({ json: { photos: [{ driveFileId: 'edited-1', filename: 'edited-1.jpg', thumbnailUrl: `/api/public/galleries/${id}/edit-results/photos/edited-1/thumbnail`, previewUrl: `/api/public/galleries/${id}/edit-results/photos/edited-1/preview`, downloadResolveUrl: '/download' }], archive: { filename: 'wedding.zip', downloadResolveUrl: '/download' }, folders: [], expiresAt } });
        return route.fulfill({ json: {} });
    });
    await page.goto(`/culling/${id}?view=edit-results`);
    await expect(page.getByTestId('edited-gallery-grid')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download All Photos' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Edited Photos access expired' })).toBeVisible();
    await expect(page.getByTestId('edited-gallery-grid')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Download All Photos' })).toHaveCount(0);
    await expect(page.getByTestId('gallery-toolbar')).toContainText('Expired');
});

test('expired Edited Photos is muted while Photo Selection stays available', async ({ page }) => {
    const id = 'expired-edited-tab';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((galleryId) => {
        localStorage.setItem(`orbit_culling_token_${galleryId}`, 'selection-token');
        localStorage.setItem(`orbit_culling_tutorial_${galleryId}`, '1');
    }, id);
    await page.route(`**/api/public/galleries/${id}/**`, (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/edit-results/status')) return route.fulfill({ json: { workflow: 'selection_delivery', title: 'Kevin & Putri Wedding', available: false, status: 'closed', isExpired: true, photoCount: 4 } });
        if (path.endsWith('/photos')) return route.fulfill({ json: { gallery: { id: 1, title: 'Kevin & Putri Wedding', status: 'open', maxSelections: 30, selectionDeadlineAt: '2099-01-01T00:00:00Z', serverTime: new Date().toISOString() }, photos: [], page: 1, total: 0, totalPages: 0, selectedDriveFileIds: [] } });
        return route.fulfill({ json: {} });
    });
    await page.goto(`/culling/${id}`);
    const editedTab = page.getByRole('button', { name: 'Edited Photos access expired' });
    await expect(editedTab).toBeDisabled();
    await expect(editedTab).toContainText('Expired');
    await expect(page.getByTestId('gallery-header').getByRole('heading', { name: 'Kevin & Putri Wedding' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All Photos' })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
