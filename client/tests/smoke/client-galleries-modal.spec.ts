import { expect, test } from '@playwright/test';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5174' });

const user = {
    id: 1,
    email: 'gallery-admin@orbit.test',
    name: 'Gallery Admin',
    role: 'admin',
    featurePermissions: {
        view_market_insights: true,
        view_billing_history: true,
        edit_billing_history: true,
        view_audit_logs: true,
        view_feedback_inbox: true,
        manage_client_galleries: true,
    },
};

test('create gallery dialog stays compact on desktop and mobile', async ({ page }) => {
    await page.addInitScript((storedUser) => {
        localStorage.setItem('orbit_user', JSON.stringify(storedUser));
    }, user);
    await page.route('**/api/users/1/permissions', (route) => route.fulfill({
        json: {
            userId: 1,
            role: 'admin',
            permissions: [],
            permissionOverrides: {},
            featurePermissions: user.featurePermissions,
        },
    }));
    await page.route('**/api/galleries?*', (route) => route.fulfill({
        json: { items: [], page: 1, pageSize: 10, total: 0, totalPages: 1 },
    }));

    await page.goto('/galleries');
    await page.getByRole('button', { name: 'Create gallery' }).click();

    const dialog = page.getByRole('dialog', { name: 'Create gallery' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Before photo')).toHaveCount(3);
    await expect(dialog.getByLabel('Edited photo')).toHaveCount(3);
    const desktopBox = await dialog.locator(':scope > div').boundingBox();
    expect(desktopBox).not.toBeNull();
    expect(desktopBox?.width ?? 0).toBeLessThanOrEqual(520);
    expect(desktopBox?.height ?? 0).toBeLessThanOrEqual(620);
    await page.screenshot({ path: 'test-results/create-gallery-modal-desktop.png', animations: 'disabled' });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Create gallery', exact: true }).last()).toBeVisible();
    const mobileBox = await dialog.locator(':scope > div').boundingBox();
    expect(mobileBox).not.toBeNull();
    expect(mobileBox?.width ?? 0).toBeLessThanOrEqual(358);
    expect(mobileBox?.height ?? 0).toBeLessThanOrEqual(760);
    await page.screenshot({ path: 'test-results/create-gallery-modal-mobile.png', animations: 'disabled' });
    await dialog.locator('summary').click();
    await page.setViewportSize({ width: 320, height: 568 });
    await dialog.getByLabel('Edited photo').last().scrollIntoViewIfNeeded();
    expect(await dialog.locator('.gallery-modal-scroll').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const footerBox = await dialog.getByRole('button', { name: 'Create gallery', exact: true }).boundingBox();
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(568);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await dialog.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
});

const exampleGallery = {
    id: 7, title: 'Kevin & Putri Prewedding', driveFolderId: 'drive-folder', status: 'draft',
    createdAt: '2026-09-18T00:00:00Z', updatedAt: '2026-09-18T00:00:00Z',
    photoCount: 24, selectionCount: 0, maxSelections: 50, additionalLimit: 0,
    selectionDurationHours: 72, selectionDurationDays: 3, addonStatus: 'none',
};

test.beforeEach(async ({ page }) => {
    await page.addInitScript((storedUser) => localStorage.setItem('orbit_user', JSON.stringify(storedUser)), user);
    await page.route('**/api/**', async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/api/auth/me') return route.fulfill({ json: { user } });
        if (pathname.includes('/permissions')) return route.fulfill({ json: { userId: 1, role: 'admin', permissions: [], permissionOverrides: {}, featurePermissions: user.featurePermissions } });
        return route.fulfill({ json: {} });
    });
});

test('failed create keeps draft and puts actionable toast above the modal on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [], total: 0, totalPages: 1 } }));
    await page.route('**/api/galleries', (route) => route.fulfill({ status: 400, json: { error: 'Drive folder is unavailable.' } }));
    await page.goto('/galleries');
    const trigger = page.getByRole('button', { name: 'Create gallery', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Gallery name').fill('New gallery');
    await dialog.getByLabel('Google Drive folder').fill('https://drive.google.com/drive/folders/test');
    await dialog.getByLabel('Client PIN').fill('1234');
    await dialog.getByRole('button', { name: 'Create gallery', exact: true }).click();
    const toast = page.getByRole('alert').filter({ hasText: 'Drive folder is unavailable.' });
    await expect(toast).toBeVisible();
    expect(await toast.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
    await expect(dialog.getByLabel('Gallery name')).toHaveValue('New gallery');
    expect(await dialog.getByLabel('Gallery name').evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');
    await page.screenshot({ path: 'test-results/gallery-create-error-mobile.png', animations: 'disabled' });
    await toast.getByRole('button', { name: 'Dismiss notification' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.body.style.position)).not.toBe('fixed');
});

test('modal status stays a draft until Save changes and remains open after saving', async ({ page }) => {
    let gallery = { ...exampleGallery };
    let patches = 0;
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: patches ? [] : [gallery], total: patches ? 0 : 1, totalPages: 1 } }));
    await page.route('**/api/galleries/7', async (route) => {
        if (route.request().method() === 'PATCH') {
            patches++;
            gallery = { ...gallery, ...route.request().postDataJSON(), updatedAt: '2026-09-19T00:00:00Z' };
            await route.fulfill({ json: { ok: true } });
        } else await route.fulfill({ json: { gallery, photos: [], selections: [] } });
    });
    await page.goto('/galleries');
    await page.getByText(gallery.title, { exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Gallery title').fill('My unsaved title');
    await dialog.getByRole('button', { name: 'open', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'open', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByLabel('Gallery title')).toHaveValue('My unsaved title');
    expect(patches).toBe(0);
    await expect(dialog.getByText('Unsaved changes', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/gallery-edit-desktop.png', animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 667 });
    await dialog.getByLabel('Gallery title').fill('My saved title');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toHaveAttribute('aria-label', 'My saved title');
    expect(patches).toBe(1);
    expect(gallery.status).toBe('open');
    await page.getByRole('button', { name: 'Dismiss notification' }).click();
    const saveBox = await dialog.getByRole('button', { name: 'Save changes' }).boundingBox();
    expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(667);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: 'test-results/gallery-edit-mobile.png', animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Close My saved title' }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeFocused();
});

test('failed Save keeps status and add-on drafts; reset PIN does not save them', async ({ page }) => {
    const patches: Record<string, unknown>[] = [];
    let resets = 0;
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [exampleGallery], total: 1, totalPages: 1 } }));
    await page.route('**/api/galleries/7', (route) => {
        if (route.request().method() === 'PATCH') {
            patches.push(route.request().postDataJSON());
            return route.fulfill({ status: 400, json: { error: 'Unable to save this folder.' } });
        }
        return route.fulfill({ json: { gallery: exampleGallery, photos: [], selections: [] } });
    });
    await page.route('**/api/galleries/7/reset-pin-lock', (route) => { resets++; return route.fulfill({ json: { status: 'reset' } }); });
    await page.goto('/galleries');
    await page.getByText(exampleGallery.title, { exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'open', exact: true }).click();
    await dialog.getByRole('button', { name: 'Additional Photos & Payment' }).click();
    await dialog.getByLabel('Butuh QRIS self-service?').check();
    await dialog.getByLabel('Add-on edited photos', { exact: true }).fill('10');
    await dialog.getByRole('button', { name: 'Paid', exact: true }).click();
    await dialog.getByRole('button', { name: 'Reset PIN Attempts' }).click();
    await expect.poll(() => resets).toBe(1);
    expect(patches).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Unable to save this folder.');
    expect(patches[0]).toMatchObject({ status: 'open', additionalSelectionLimit: 10, editAddonStatus: 'paid', qrisEnabled: true });
    await expect(dialog.getByRole('button', { name: 'open', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByLabel('Add-on edited photos', { exact: true })).toHaveValue('10');
    page.once('dialog', (confirmation) => confirmation.dismiss());
    await dialog.getByRole('button', { name: `Close ${exampleGallery.title}` }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeEnabled();
});

test('created gallery opens even when it is absent from the active page', async ({ page }) => {
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [], total: 0, totalPages: 1 } }));
    await page.route('**/api/galleries', (route) => route.fulfill({ json: exampleGallery }));
    await page.route('**/api/galleries/7', (route) => route.fulfill({ json: { gallery: exampleGallery, photos: [], selections: [] } }));
    await page.goto('/galleries');
    await page.getByRole('button', { name: 'Create gallery' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Gallery name').fill(exampleGallery.title);
    await dialog.getByLabel('Google Drive folder').fill('drive-folder');
    await dialog.getByLabel('Client PIN').fill('1234');
    await dialog.getByRole('button', { name: 'Create gallery', exact: true }).click();
    await expect(page.getByRole('dialog', { name: exampleGallery.title })).toBeVisible();
    await expect(page.getByLabel('Gallery title')).toHaveValue(exampleGallery.title);
});

test('edited results folder can be published with an admin-defined password', async ({ page }) => {
    let gallery = { ...exampleGallery, editResultsFolderId: null, editResultsZipFileId: null as string | null, hasEditResults: false, editResultsPhotoCount: 0, editResultsPublishedAt: null as string | null };
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [gallery], total: 1, totalPages: 1 } }));
    await page.route('**/api/galleries/7', async (route) => {
        if (route.request().method() === 'PATCH') {
            gallery = { ...gallery, ...route.request().postDataJSON() };
            await route.fulfill({ json: { status: 'updated' } });
        } else await route.fulfill({ json: { gallery, photos: [], selections: [] } });
    });
    await page.route('**/api/galleries/7/edit-results/publish', (route) => {
        expect(route.request().postDataJSON()).toEqual({ password: 'delivery-secret' });
        gallery = { ...gallery, hasEditResults: true, editResultsPhotoCount: 2, editResultsPublishedAt: '2026-10-01T00:00:00.000Z' };
        return route.fulfill({ status: 201, json: { publishedAt: gallery.editResultsPublishedAt, photoCount: 2 } });
    });

    await page.goto('/galleries');
    await page.getByText(gallery.title, { exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Edited photos Drive folder').fill('https://drive.google.com/drive/folders/edited-folder');
    await dialog.getByLabel('Edited Photos ZIP (optional)').fill('https://drive.google.com/file/d/edited-archive/view');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(() => gallery.editResultsFolderId).toBe('https://drive.google.com/drive/folders/edited-folder');
    await expect.poll(() => gallery.editResultsZipFileId).toBe('https://drive.google.com/file/d/edited-archive/view');
    await dialog.getByLabel('Edited Photos password').fill('delivery-secret');
    await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(dialog.getByLabel('Edited Photos password')).toHaveValue('');
    await expect(dialog.getByText('2 published')).toBeVisible();
});

for (const sameCount of [true, false]) {
    test(`comparison pairing uses confirmed drafts with ${sameCount ? 'equal' : 'different'} counts`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const before = Array.from({ length: 2 }, (_, index) => ({ driveFileId: `before-${index}`, filename: `source-${index}.jpg`, thumbnailUrl: `/pair-image/before-${index}` }));
        const edited = Array.from({ length: sameCount ? 2 : 3 }, (_, index) => ({ driveFileId: `edited-${index}`, filename: `final-${index}.jpg`, thumbnailUrl: `/pair-image/edited-${index}` }));
        let gallery = { ...exampleGallery, editResultsFolderId: 'edited-folder', comparisonEnabled: false, comparisonPairs: [] as Array<{ editedDriveFileId: string; beforeDriveFileId: string }> };
        let saves = 0;
        await page.route('**/pair-image/*', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#718578"/></svg>' }));
        await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [gallery], total: 1, totalPages: 1 } }));
        await page.route('**/api/galleries/7', (route) => {
            if (route.request().method() === 'PATCH') { saves++; gallery = { ...gallery, ...route.request().postDataJSON() }; return route.fulfill({ json: { status: 'updated' } }); }
            return route.fulfill({ json: { gallery, photos: [], selections: [] } });
        });
        await page.route('**/api/galleries/7/edit-results/pairing', (route) => route.fulfill({ json: { submitted: before, edited, comparisonPairs: gallery.comparisonPairs } }));
        await page.goto('/galleries');
        await page.getByText(gallery.title, { exact: true }).click();
        await page.getByRole('checkbox', { name: 'Enable Before / After' }).check();
        await page.getByRole('button', { name: 'Manage Pairs', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Manage Pairs', exact: true });
        await expect(dialog.getByRole('article')).toHaveCount(edited.length);
        if (sameCount) {
            await expect(dialog.getByText('Suggested by Order')).toHaveCount(2);
            await dialog.getByRole('button', { name: 'Confirm All (2)' }).click();
        } else {
            await expect(dialog.getByRole('button', { name: /Confirm All/ })).toHaveCount(0);
            for (const name of ['final-0.jpg', 'final-1.jpg']) {
                await dialog.getByRole('article', { name: `Pair ${name}` }).getByRole('button', { name: 'Choose Before' }).click();
                await dialog.getByRole('textbox', { name: 'Search Submitted Photos' }).fill('source-0');
                await dialog.getByRole('textbox', { name: 'Search Submitted Photos' }).press('Enter');
                await expect(dialog.getByRole('textbox', { name: 'Search Submitted Photos' })).toBeVisible();
                await dialog.getByRole('button', { name: 'Use source-0.jpg' }).click();
            }
        }
        await page.screenshot({ path: testInfo.outputPath('admin-pairs.png') });
        for (const theme of ['black', 'white']) {
            await page.evaluate((theme) => document.documentElement.classList.toggle('light', theme === 'white'), theme);
            for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
                await page.setViewportSize(viewport);
                expect(await dialog.locator('.gallery-modal-scroll').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
                await expect(dialog.getByRole('button', { name: 'Apply Pairs' })).toBeInViewport();
                await page.screenshot({ path: testInfo.outputPath(`admin-pairs-${theme}-${viewport.width}.png`) });
            }
        }
        expect(saves).toBe(0);
        await dialog.getByRole('button', { name: 'Apply Pairs' }).click();
        await page.getByLabel('Edited Photos password').fill('delivery-secret');
        await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
        expect(saves).toBe(0);
        await page.getByRole('button', { name: 'Save changes', exact: true }).click();
        await expect.poll(() => saves).toBe(1);
        expect(gallery.comparisonPairs).toHaveLength(2);
        if (!sameCount) expect(new Set(gallery.comparisonPairs.map((pair) => pair.beforeDriveFileId)).size).toBe(1);
        await page.getByRole('button', { name: 'Manage Pairs', exact: true }).click();
        await expect(dialog.getByText('Confirmed', { exact: true })).toHaveCount(2);
        await dialog.getByRole('button', { name: 'Close Manage Pairs', exact: true }).click();
        await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
        await expect(page.getByRole('button', { name: 'Manage Pairs', exact: true })).toBeFocused();
        await page.getByRole('button', { name: 'Manage Pairs', exact: true }).click();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: 'Manage Pairs', exact: true })).toBeFocused();
        await page.getByRole('button', { name: 'Manage Pairs', exact: true }).click();
        await page.setViewportSize({ width: 320, height: 568 });
        expect(await dialog.locator('.gallery-modal-scroll').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        await dialog.getByRole('button', { name: 'Remove pair for final-0.jpg' }).click();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: 'Manage Pairs', exact: true }).click();
        await expect(dialog.getByText('Confirmed', { exact: true })).toHaveCount(2);
    });
}
