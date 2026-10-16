import { expect, test } from '@playwright/test';

const id = 'wedding-workflow';
const weddingClientTitle = 'Alya & Rafi Wedding Celebration at The Grand Ballroom Jakarta';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6z7QAAAAASUVORK5CYII=', 'base64');
const photos = Array.from({ length: 55 }, (_, index) => ({ driveFileId: `wedding-${index}`, filename: `Wedding-${index}.jpg`, folderId: 'ceremony', width: 1200, height: 900, displayOrder: index, downloadUrl: 'https://drive.google.com/file' }));

for (const width of [320, 390, 1280]) {
    test(`Wedding client opens only Edited and restores folder state at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 844 });
        const selectionRequests: string[] = [];
        let passwordAttempts = 0;
        let failDownload = true;
        let releaseMetadata!: () => void;
        const metadataReady = new Promise<void>((resolve) => { releaseMetadata = resolve; });
        await page.route(`**/api/public/galleries/${id}/**`, async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/edit-results/face-search/status')) return route.fulfill({ json: { available: false, status: 'unavailable', total: 0, processed: 0 } });
            if (path.endsWith('/edit-results/status')) {
                await metadataReady;
                return route.fulfill({ json: { workflow: 'delivery_only', title: weddingClientTitle, available: true, status: 'open', photoCount: 55 } });
            }
            if (path.endsWith('/edit-results/verify')) {
                passwordAttempts++;
                return passwordAttempts === 1 ? route.fulfill({ status: 401, json: { error: 'Invalid edited photos password.' } }) : route.fulfill({ json: { token: 'wedding-token', expiresAt: null } });
            }
            if (path.endsWith('/edit-results')) return route.fulfill({ json: { photos, folders: [{ id: 'ceremony', parentId: null, name: 'Ceremony' }], expiresAt: null, archive: { filename: 'wedding.zip', downloadUrl: 'https://drive.google.com/zip' } } });
            if (path.endsWith('/download-url')) {
                if (failDownload) return route.fulfill({ status: 502, json: { error: 'Check Drive sharing and retry.', code: 'DRIVE_DOWNLOAD_UNAVAILABLE' } });
                return route.fulfill({ status: 200, json: { filename: 'wedding.zip', downloadUrl: 'https://drive.google.com/download/wedding.zip' } });
            }
            if (path.includes('/edit-results/photos/')) return route.fulfill({ contentType: 'image/png', body: image });
            selectionRequests.push(path);
            return route.fulfill({ status: 403, json: { code: 'SELECTION_NOT_AVAILABLE', error: 'Selection unavailable.' } });
        });
        await page.goto(`/culling/${id}?view=picked`);
        await expect(page.getByRole('status')).toContainText('Loading gallery');
        await expect(page.getByLabel('Photo Selection password', { exact: true })).toHaveCount(0);
        releaseMetadata();
        const password = page.getByLabel('Edited photos password', { exact: true });
        await expect(password).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`/culling/${id}/edited$`));
        await password.fill('wrong-password');
        await page.getByRole('button', { name: 'Unlock Edited Photos' }).click();
        await expect(page.getByRole('alert')).toContainText('Invalid edited photos password');
        await password.fill('wedding-password');
        await page.getByRole('button', { name: 'Show edited photos password' }).click();
        await expect(password).toHaveAttribute('type', 'text');
        await page.getByRole('button', { name: 'Unlock Edited Photos' }).click();
        const galleryHeading = page.getByRole('heading', { level: 1, name: weddingClientTitle });
        await expect(galleryHeading).toHaveCount(1);
        await expect(page.getByTestId('gallery-header').getByText('Edited Photos', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Close Edited Photos guide' }).click();
        const titleButton = page.getByRole('button', { name: weddingClientTitle });
        await titleButton.click();
        await expect(page.getByRole('region', { name: 'Full event title' })).toHaveText(weddingClientTitle);
        if (width === 320) {
            await page.screenshot({ path: testInfo.outputPath('wedding-full-title-mobile.png') });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        }
        await page.keyboard.press('Escape');
        await expect(titleButton).toBeFocused();
        await expect(page.getByRole('region', { name: 'Full event title' })).toHaveCount(0);
        await page.getByRole('link', { name: 'Open folder Ceremony' }).click();
        await expect(page.getByRole('heading', { level: 1, name: weddingClientTitle })).toBeVisible();
        const grid = page.getByTestId('edited-gallery-grid');
        await expect(grid.locator('img')).toHaveCount(54);
        await page.getByRole('button', { name: 'Next page', exact: true }).click();
        await expect(page).toHaveURL(/editedPage=2/);
        await expect(grid.locator('img')).toHaveCount(1);
        await page.goBack();
        await expect(page).toHaveURL(/editedPage=1/);
        await page.goForward();
        await expect(grid.locator('img')).toHaveCount(1);
        await page.reload();
        await expect(grid.locator('img')).toHaveCount(1);
        await expect(page).toHaveURL(/folder=ceremony/);
        for (const name of ['All Photos', 'Submit', 'Request More', 'Back to gallery']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Selfie', exact: true })).toBeDisabled();
        await expect(page.getByText('Before / After', { exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: 'Download All Photos' }).click();
        await expect(page.getByRole('alert')).toContainText('Check Drive sharing and retry');
        await expect(page.getByRole('alert')).toBeFocused();
        const downloads: string[] = [];
        await page.route('https://drive.google.com/download/**', (route) => { downloads.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'application/zip', headers: { 'Content-Disposition': 'attachment; filename=wedding.zip' }, body: 'test archive' }); });
        failDownload = false;
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Download All Photos' }).click();
        expect((await download).suggestedFilename()).toBe('wedding.zip');
        expect(downloads).toHaveLength(1);
        await expect(grid).toBeVisible();
        expect(selectionRequests).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: `test-results/wedding-client-${width}.png`, fullPage: true });
    });

    test(`Create Wedding, Sync and Save without selection fields at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        const user = { id: 1, role: 'superadmin', email: 'admin@orbit.test', name: 'Admin', featurePermissions: { manage_client_galleries: true } };
        await page.addInitScript((value) => localStorage.setItem('orbit_user', JSON.stringify(value)), user);
        let gallery = { id: 21, publicKey: id, workflow: 'delivery_only', title: 'Alya & Rafi Wedding', editResultsFolderId: 'wedding-root', editResultsStatus: 'draft', hasEditResults: false, editResultsPhotoCount: 0, editResultsAccessDurationHours: 168, createdAt: '2026-10-01', updatedAt: '2026-10-01' };
        const creates: Record<string, unknown>[] = [];
        const patches: Record<string, unknown>[] = [];
        let syncs = 0;
        let publishes = 0;
        await page.route('**/api/**', async (route) => {
            const url = new URL(route.request().url());
            if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user } });
            if (url.pathname.endsWith('/permissions')) return route.fulfill({ json: { featurePermissions: user.featurePermissions } });
            if (url.pathname === '/api/galleries' && route.request().method() === 'GET') {
                const items = creates.length && url.searchParams.get('mode') === 'wedding' ? [gallery] : [];
                return route.fulfill({ json: { items, total: items.length, totalPages: 1 } });
            }
            if (url.pathname === '/api/galleries') {
                creates.push(route.request().postDataJSON());
                return creates.length === 1 ? route.fulfill({ status: 400, json: { error: 'Check the edited folder URL.' } }) : route.fulfill({ json: gallery });
            }
            if (url.pathname === '/api/galleries/21') {
                if (route.request().method() === 'PATCH') {
                    const payload = route.request().postDataJSON();
                    patches.push(payload);
                    gallery = { ...gallery, ...payload };
                    return route.fulfill({ json: { status: 'updated' } });
                }
                return route.fulfill({ json: { gallery, photos: [], selections: [] } });
            }
            if (url.pathname.endsWith('/edit-results/sync')) { syncs++; return route.fulfill({ json: { status: 'synced', photoCount: 55, folderCount: 1 } }); }
            if (url.pathname.endsWith('/edit-results/publish')) {
                publishes++;
                if (publishes === 1) return route.fulfill({ status: 502, json: { error: 'Unable to read the edited Drive folder. Retry Sync.' } });
                gallery = { ...gallery, editResultsStatus: 'open', hasEditResults: true, editResultsPhotoCount: 55 };
                return route.fulfill({ status: 201, json: { photoCount: 55, folderCount: 1 } });
            }
            if (url.pathname.endsWith('/settings/contact')) return route.fulfill({ json: { contactWhatsappUrl: '', message: '', requestMoreMessage: '' } });
            return route.fulfill({ json: {} });
        });
        await page.goto('/galleries');
        await page.getByRole('button', { name: 'Create gallery', exact: true }).click();
        const createDialog = page.getByRole('dialog', { name: 'Create gallery' });
        await createDialog.getByRole('button', { name: 'Wedding', exact: true }).click();
        await expect(createDialog.getByRole('button', { name: 'Wedding', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(createDialog.getByLabel('Photo Selection password', { exact: true })).toHaveCount(0);
        await expect(createDialog.getByLabel('Selection window')).toHaveCount(0);
        await createDialog.getByLabel('Gallery name').fill(gallery.title);
        await createDialog.getByLabel('Edited photos Drive folder').fill(gallery.editResultsFolderId);
        await page.screenshot({ path: `test-results/wedding-create-${width}.png` });
        await createDialog.getByRole('button', { name: 'Create gallery', exact: true }).click();
        await expect(createDialog.getByRole('alert')).toContainText('Check the edited folder URL');
        await expect(createDialog.getByLabel('Gallery name')).toHaveValue(gallery.title);
        await createDialog.getByRole('button', { name: 'Create gallery', exact: true }).click();
        await expect(page).toHaveURL(/mode=wedding/);
        await expect(page.locator('#gallery-list-wedding-tab')).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('#gallery-list-selection-tab')).toBeVisible();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('tab', { name: 'Edited Photos', exact: true })).toHaveAttribute('aria-selected', 'true');
        await expect(dialog.getByRole('tab', { name: 'Photo Selection', exact: true })).toHaveCount(0);
        await expect(dialog.getByRole('tab', { name: 'Preview Samples', exact: true })).toHaveCount(0);
        for (const label of ['Photo Selection password', 'Selection window', 'Master limit']) await expect(dialog.getByLabel(label, { exact: true })).toHaveCount(0);
        await expect(dialog.getByRole('button', { name: 'Manage Pairs' })).toHaveCount(0);
        await expect(dialog.getByText('Additional Photos & Payment')).toHaveCount(0);
        expect(creates[1]).toEqual({ workflow: 'delivery_only', title: 'Alya & Rafi Wedding', editResultsFolderId: 'wedding-root' });
        const save = dialog.getByRole('button', { name: 'Save Edited Photos' });
        await expect(save).toBeDisabled();
        await dialog.getByRole('button', { name: 'Sync', exact: true }).click();
        await expect.poll(() => syncs).toBe(1);
        await dialog.getByRole('tab', { name: 'Edited Photos', exact: true }).focus();
        await page.keyboard.press('ArrowRight');
        await expect(dialog.getByRole('tab', { name: 'Edited Photos', exact: true })).toBeFocused();
        await dialog.getByLabel('Gallery title').fill('Alya & Rafi Wedding Updated');
        await dialog.getByLabel('Password for publication').fill('pass');
        await dialog.getByRole('button', { name: 'open', exact: true }).click();
        await expect(save).toBeEnabled();
        await save.click();
        await expect(dialog.getByRole('alert')).toContainText('Unable to read the edited Drive folder');
        await expect(save).toBeEnabled();
        await save.click();
        await expect.poll(() => publishes).toBe(2);
        expect(patches).toHaveLength(2);
        for (const payload of patches) expect(payload).toEqual({ title: 'Alya & Rafi Wedding Updated', editResultsStatus: 'draft', editResultsFolderId: 'wedding-root', editResultsZipFileId: '', editResultsAccessDurationHours: 168 });
        await expect(dialog).toHaveAttribute('aria-label', 'Alya & Rafi Wedding Updated');
        await expect(save).toBeDisabled();
        expect(await dialog.locator('.gallery-modal-scroll').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        await expect(save).toBeInViewport();
        while (await page.getByRole('button', { name: 'Dismiss notification' }).count()) {
            await page.getByRole('button', { name: 'Dismiss notification' }).first().click();
        }
        await dialog.locator('.gallery-modal-scroll').evaluate((element) => element.scrollTo({ top: 0 }));
        await page.screenshot({ path: `test-results/wedding-detail-${width}.png` });
    });
}

for (const width of [320, 390, 1280]) {
test(`Admin lists Selection Events once and keeps Wedding separate at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const user = { id: 1, role: 'superadmin', email: 'admin@orbit.test', name: 'Admin', featurePermissions: { manage_client_galleries: true } };
    await page.addInitScript((value) => localStorage.setItem('orbit_user', JSON.stringify(value)), user);
    const prewed = { id: 1, publicKey: 'prewed', workflow: 'selection_delivery', title: 'Alya & Rafi Prewedding', driveFolderId: 'source-folder', editResultsFolderId: 'edited-folder', status: 'open', editResultsStatus: 'draft', hasEditResults: true, editResultsPhotoCount: 70, photoCount: 70, selectionCount: 70, createdAt: '2026-10-01', updatedAt: '2026-10-01' };
    const wedding = { id: 2, publicKey: 'wedding', workflow: 'delivery_only', title: 'Alya & Rafi Wedding', editResultsStatus: 'draft', hasEditResults: false, editResultsPhotoCount: 0, createdAt: '2026-10-02', updatedAt: '2026-10-02' };
    const patches: Record<string, unknown>[] = [];
    let editedUnlocks = 0;
    await page.route('**/api/**', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user } });
        if (url.pathname.endsWith('/permissions')) return route.fulfill({ json: { featurePermissions: user.featurePermissions } });
        if (url.pathname === '/api/galleries') {
            const mode = url.searchParams.get('mode');
            const status = url.searchParams.get('status');
            const items = mode === 'wedding' ? status && status !== 'draft' ? [] : [wedding] : status && status !== prewed.status ? [] : [prewed];
            return route.fulfill({ json: { items, total: items.length, totalPages: 1 } });
        }
        if (url.pathname === '/api/galleries/1' && route.request().method() === 'PATCH') {
            const patch = route.request().postDataJSON();
            patches.push(patch);
            Object.assign(prewed, patch);
            return route.fulfill({ json: { status: 'updated' } });
        }
        if (url.pathname === '/api/galleries/2/edit-results/reset-lock') {
            editedUnlocks++;
            return route.fulfill({ json: { status: 'reset' } });
        }
        return route.fulfill({ json: {} });
    });
    await page.goto('/galleries?mode=wedding');
    const tabs = page.getByRole('tablist', { name: 'Gallery area' });
    await expect(tabs.getByRole('tab', { name: 'Wedding' })).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.getByRole('tab', { name: 'Wedding' })).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'Wedding', exact: true })).toBeVisible();
    await expect(page.getByText(wedding.title, { exact: true })).toBeVisible();
    await expect(page.getByText(prewed.title, { exact: true })).toHaveCount(0);
    const statusFilter = page.getByRole('group', { name: 'Edited Photos status filter' });
    await expect(statusFilter.getByRole('button', { name: 'Filter All' })).toHaveAttribute('aria-pressed', 'true');
    expect(await statusFilter.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect(statusFilter.getByRole('button', { name: 'Filter Closed' })).toBeInViewport();
    await page.screenshot({ path: `test-results/admin-wedding-list-${width}.png` });
    await page.getByRole('button', { name: `${wedding.title} Edited Photos maintenance actions` }).click();
    await expect(page.getByRole('button', { name: 'Delete gallery' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlock Selection PIN' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Unlock Edited access' }).click();
    await expect.poll(() => editedUnlocks).toBe(1);
    await page.getByRole('button', { name: 'Filter Closed' }).click();
    await expect(page.getByText(wedding.title, { exact: true })).toHaveCount(0);
    await tabs.getByRole('tab', { name: 'Selection Events' }).click();
    await expect(page).toHaveURL(/mode=selection/);
    await expect(page.getByText(prewed.title, { exact: true })).toBeVisible();
    await expect(page.getByText(wedding.title, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Published' })).toBeVisible();
    await page.screenshot({ path: `test-results/admin-selection-list-${width}.png` });
    await page.getByRole('button', { name: `${prewed.title} Edited Photos status: Draft` }).click();
    await page.getByRole('group', { name: `${prewed.title} Edited Photos status options` }).getByRole('button', { name: 'Open', exact: true }).click();
    await expect.poll(() => patches).toEqual([{ editResultsStatus: 'open' }]);
    expect(prewed.status).toBe('open');
    await page.getByRole('button', { name: `${prewed.title} Photo Selection status: Open` }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('group', { name: `${prewed.title} Photo Selection status options` }).getByRole('button', { name: 'Draft', exact: true }).click();
    await expect.poll(() => patches).toEqual([{ editResultsStatus: 'open' }, { status: 'draft' }]);
    expect(prewed.editResultsStatus).toBe('open');
    await page.goBack();
    await expect(page).toHaveURL(/mode=wedding/);
    await expect(page.getByText(wedding.title, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
}

test('Wedding expired token restores the edited gate without opening a stored selection session', async ({ page }) => {
    await page.addInitScript((galleryId) => {
        localStorage.setItem(`orbit:edit-results-token:${galleryId}`, 'expired-token');
        localStorage.setItem(`orbit_culling_token_${galleryId}`, 'selection-token');
    }, id);
    const selectionRequests: string[] = [];
    await page.route(`**/api/public/galleries/${id}/**`, (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/edit-results/face-search/status')) return route.fulfill({ json: { available: false, status: 'unavailable', total: 0, processed: 0 } });
        if (url.pathname.endsWith('/edit-results/status')) return route.fulfill({ json: { workflow: 'delivery_only', available: true, photoCount: 55, title: 'Wedding' } });
        if (url.pathname.endsWith('/edit-results/verify')) return route.fulfill({ json: { token: 'fresh-token', expiresAt: null } });
        if (url.pathname.endsWith('/edit-results')) return url.searchParams.get('token') === 'expired-token'
            ? route.fulfill({ status: 401, json: { error: 'Enter your edited password again.', code: 'EDIT_RESULTS_TOKEN_INVALID' } })
            : route.fulfill({ json: { photos, folders: [{ id: 'ceremony', parentId: null, name: 'Ceremony' }], archive: null } });
        if (url.pathname.includes('/edit-results/photos/')) return route.fulfill({ contentType: 'image/png', body: image });
        selectionRequests.push(url.pathname);
        return route.fulfill({ status: 403, json: { code: 'SELECTION_NOT_AVAILABLE' } });
    });
    await page.goto(`/culling/${id}?view=gallery&folder=ceremony&editedPage=2`);
    await page.getByLabel('Edited photos password', { exact: true }).fill('new-password');
    await page.getByRole('button', { name: 'Unlock Edited Photos' }).click();
    await expect(page.getByTestId('edited-gallery-grid').locator('img')).toHaveCount(1);
    await expect(page).toHaveURL(/editedPage=2/);
    await expect(page.getByRole('button', { name: 'Download All Photos' })).toHaveCount(0);
    expect(selectionRequests).toEqual([]);
});

for (const state of ['draft', 'closed', 'expired'] as const) {
    test(`Wedding ${state} access has no password or selection navigation`, async ({ page }) => {
        await page.route(`**/api/public/galleries/${id}/**`, (route) => route.fulfill({ json: { workflow: 'delivery_only', title: 'Alya & Rafi Wedding', available: false, status: state === 'expired' ? 'closed' : state, isExpired: state === 'expired', photoCount: 0 } }));
        await page.goto(`/culling/${id}`);
        await expect(page.getByRole('heading', { name: state === 'expired' ? 'Edited Photos access expired' : 'Edited Photos unavailable', exact: true })).toBeVisible();
        await expect(page.getByLabel('Edited photos password', { exact: true })).toHaveCount(0);
        await expect(page.getByLabel('Photo Selection password', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'All Photos', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Download All Photos' })).toHaveCount(0);
    });
}
