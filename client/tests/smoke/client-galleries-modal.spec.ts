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
    await expect(dialog.getByLabel('Before photo')).toHaveCount(0);
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
    await page.setViewportSize({ width: 320, height: 568 });
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

test('gallery list uses mobile cards without horizontal scrolling', async ({ page }) => {
    await page.addInitScript((storedUser) => localStorage.setItem('orbit_user', JSON.stringify(storedUser)), user);
    await page.route('**/api/users/1/permissions', (route) => route.fulfill({ json: { userId: 1, role: 'admin', permissions: [], permissionOverrides: {}, featurePermissions: user.featurePermissions } }));
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [{ ...exampleGallery, status: 'open', editResultsStatus: 'draft', selectionCount: 7 }], total: 1, totalPages: 1 } }));
    for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto('/galleries');
        const card = page.getByRole('article', { name: exampleGallery.title });
        await expect(card).toBeVisible();
        await expect(card.getByText('Submitted')).toBeVisible();
        await expect(card.getByText('7', { exact: true })).toBeVisible();
        await expect(page.locator('table')).toBeHidden();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const box = await card.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        if (width === 390) await page.screenshot({ path: 'test-results/client-galleries-mobile-cards.png', fullPage: true, animations: 'disabled' });
        await page.getByRole('tab', { name: 'Wedding', exact: true }).click();
        await expect(card.getByText('Access ends')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
});

test('Selection Events row keeps both statuses and client links independent', async ({ page }) => {
    const gallery = { ...exampleGallery, status: 'open', editResultsStatus: 'closed', editResultsFolderId: 'edited-folder', hasEditResults: true, editResultsPhotoCount: 9 };
    const queries: URL[] = [];
    const patches: Record<string, unknown>[] = [];
    let editedUnlocks = 0;
    let pinUnlocks = 0;
    await page.route('**/api/galleries?*', (route) => {
        queries.push(new URL(route.request().url()));
        return route.fulfill({ json: { items: [gallery], total: 1, totalPages: 1 } });
    });
    await page.route('**/api/galleries/7', (route) => {
        if (route.request().method() === 'PATCH') {
            patches.push(route.request().postDataJSON());
            Object.assign(gallery, route.request().postDataJSON());
            return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({ json: { gallery, photos: [], selections: [] } });
    });
    await page.route('**/api/galleries/7/edit-results/reset-lock', (route) => { editedUnlocks++; return route.fulfill({ json: { status: 'reset' } }); });
    await page.route('**/api/galleries/7/reset-pin-lock', (route) => { pinUnlocks++; return route.fulfill({ json: { status: 'reset' } }); });
    await page.goto('/galleries');
    await page.getByRole('button', { name: 'Filter Open', exact: true }).click();
    await expect.poll(() => queries.at(-1)?.searchParams.get('status')).toBe('open');
    await expect(page.getByRole('tab', { name: 'Selection Events', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => queries.at(-1)?.searchParams.get('mode')).toBe('selection');
    expect(queries.at(-1)?.searchParams.get('page')).toBe('1');
    await expect(page.getByRole('columnheader', { name: 'Submitted', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Published', exact: true })).toBeVisible();
    await page.getByRole('button', { name: `${gallery.title} Edited Photos status: Closed`, exact: true }).click();
    await page.getByRole('group', { name: `${gallery.title} Edited Photos status options` }).getByRole('button', { name: 'Open', exact: true }).click();
    await expect.poll(() => patches).toEqual([{ editResultsStatus: 'open' }]);
    expect(gallery.status).toBe('open');
    await page.getByRole('button', { name: `${gallery.title} Photo Selection status: Open` }).click();
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('group', { name: `${gallery.title} Photo Selection status options` }).getByRole('button', { name: 'Draft', exact: true }).click();
    expect(patches).toEqual([{ editResultsStatus: 'open' }]);
    const selectionActions = page.getByRole('group', { name: `${gallery.title} Photo Selection actions` });
    const editedActions = page.getByRole('group', { name: `${gallery.title} Edited Photos actions` });
    const selectionLinkButton = selectionActions.getByRole('button', { name: `${gallery.title} Photo Selection client link actions` });
    const selectionMenu = page.getByRole('group', { name: 'Photo Selection link options' });
    const editedMenu = page.getByRole('group', { name: 'Edited Photos link options' });
    await selectionLinkButton.click();
    await expect(selectionMenu.getByRole('link', { name: `Open source Drive folder for ${gallery.title}` })).toHaveAttribute('href', /\/folders\/drive-folder$/);
    const selectionTriggerBox = await selectionLinkButton.boundingBox();
    const selectionCopyBox = await selectionMenu.getByRole('button', { name: 'Copy Photo Selection link' }).boundingBox();
    expect(selectionCopyBox!.y).toBeGreaterThan(selectionTriggerBox!.y + selectionTriggerBox!.height);
    await expect(selectionMenu.getByRole('button', { name: 'Copy Photo Selection link' })).toBeInViewport();
    await expect(selectionMenu.getByRole('link', { name: 'Open Photo Selection link' })).toHaveAttribute('href', /\/culling\/[^?]+$/);
    await expect(selectionMenu.getByRole('link', { name: 'Open Edited Photos link' })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/admin-selection-link-menu.png' });
    await page.keyboard.press('Escape');
    await editedActions.getByRole('button', { name: `${gallery.title} Edited Photos client link actions` }).click();
    await expect(editedMenu.getByRole('link', { name: `Open edited Drive folder for ${gallery.title}` })).toHaveAttribute('href', /\/folders\/edited-folder$/);
    await expect(editedMenu.getByRole('button', { name: 'Copy Edited Photos link' })).toBeInViewport();
    await expect(editedMenu.getByRole('link', { name: 'Open Edited Photos link' })).toHaveAttribute('href', /\/culling\/[^?]+\/edited$/);
    await expect(editedMenu.getByRole('link', { name: 'Open Photo Selection link' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await editedActions.getByRole('button', { name: `${gallery.title} Edited Photos maintenance actions` }).click();
    await expect(page.getByRole('button', { name: 'Delete gallery' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlock Selection PIN' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Unlock Edited access' }).click();
    await expect.poll(() => editedUnlocks).toBe(1);
    expect(pinUnlocks).toBe(0);
    await selectionActions.getByRole('button', { name: `${gallery.title} Photo Selection maintenance actions` }).click();
    await expect(page.getByRole('button', { name: 'Unlock Selection access', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unlock Edited access' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    for (const { width, height } of [{ width: 320, height: 568 }, { width: 320, height: 844 }, { width: 390, height: 844 }]) {
        await page.setViewportSize({ width, height });
        await selectionLinkButton.click();
        await expect(selectionMenu.getByRole('button', { name: 'Copy Photo Selection link' })).toBeInViewport();
        await expect(selectionMenu.getByRole('link', { name: 'Open Photo Selection link' })).toBeInViewport();
        const selectionMenuBox = await selectionMenu.boundingBox();
        expect(selectionMenuBox!.x).toBeGreaterThanOrEqual(0);
        expect(selectionMenuBox!.x + selectionMenuBox!.width).toBeLessThanOrEqual(width);
        expect(selectionMenuBox!.y).toBeGreaterThanOrEqual(0);
        expect(selectionMenuBox!.y + selectionMenuBox!.height).toBeLessThanOrEqual(height);
        await page.screenshot({ path: `test-results/admin-selection-link-menu-${width}-${height}.png` });
        await page.keyboard.press('Escape');
        await editedActions.getByRole('button', { name: `${gallery.title} Edited Photos client link actions` }).click();
        const editedMenuBox = await editedMenu.boundingBox();
        expect(editedMenuBox!.x).toBeGreaterThanOrEqual(0);
        expect(editedMenuBox!.x + editedMenuBox!.width).toBeLessThanOrEqual(width);
        expect(editedMenuBox!.y).toBeGreaterThanOrEqual(0);
        expect(editedMenuBox!.y + editedMenuBox!.height).toBeLessThanOrEqual(height);
        await page.keyboard.press('Escape');
        await editedActions.getByRole('button', { name: `${gallery.title} Edited Photos maintenance actions` }).click();
        const maintenanceBox = await page.getByRole('button', { name: 'Unlock Edited access' }).locator('..').boundingBox();
        expect(maintenanceBox!.x).toBeGreaterThanOrEqual(0);
        expect(maintenanceBox!.x + maintenanceBox!.width).toBeLessThanOrEqual(width);
        expect(maintenanceBox!.y).toBeGreaterThanOrEqual(0);
        expect(maintenanceBox!.y + maintenanceBox!.height).toBeLessThanOrEqual(height);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: `${gallery.title} Photo Selection status: Open` }).click();
        const statusBox = await page.getByRole('group', { name: `${gallery.title} Photo Selection status options` }).boundingBox();
        expect(statusBox!.x).toBeGreaterThanOrEqual(0);
        expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(width);
        expect(statusBox!.y).toBeGreaterThanOrEqual(0);
        expect(statusBox!.y + statusBox!.height).toBeLessThanOrEqual(height);
        await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.reload();
    await expect(page.getByRole('tab', { name: 'Selection Events', exact: true })).toHaveAttribute('aria-selected', 'true');
    const keyboardLinkButton = page.getByRole('button', { name: `${gallery.title} Photo Selection client link actions` });
    await keyboardLinkButton.focus();
    await keyboardLinkButton.press('Enter');
    await expect(page.getByRole('button', { name: 'Copy Photo Selection link' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(keyboardLinkButton).toBeFocused();
    const row = page.locator('tr.gallery-area-row');
    await row.locator('td[data-gallery-area="edited"]').nth(1).click();
    await expect(page.getByRole('dialog').getByRole('tab', { name: 'Edited Photos', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: `Close ${gallery.title}` }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await row.locator('td[data-gallery-area="selection"]').nth(1).click();
    await expect(page.getByRole('dialog').getByRole('tab', { name: 'Photo Selection', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: `Close ${gallery.title}` }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await row.getByRole('button', { name: `Open Edited Photos for ${gallery.title}` }).press('Enter');
    await expect(page.getByRole('dialog').getByRole('tab', { name: 'Edited Photos', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: `Close ${gallery.title}` }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByText(gallery.title, { exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('tab', { name: 'Photo Selection', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('dialog').getByRole('tab', { name: 'Preview Samples', exact: true })).toHaveCount(0);
    await page.getByRole('dialog').getByRole('tab', { name: 'Edited Photos', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Unlock Edited Access' }).click();
    await expect.poll(() => editedUnlocks).toBe(2);
    expect(pinUnlocks).toBe(0);
});

test('last gallery link menu does not stretch the table or push its footer', async ({ page }) => {
    const first = { ...exampleGallery, id: 8, title: 'First Gallery' };
    const last = { ...exampleGallery, id: 9, title: 'Last Gallery' };
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [first, last], total: 2, totalPages: 1 } }));
    await page.goto('/galleries');
    const tableViewport = page.locator('table').locator('..');
    const footer = page.getByText('Showing 1-2 of 2 galleries');
    const before = await tableViewport.evaluate((element) => element.scrollHeight);
    const footerY = (await footer.boundingBox())!.y;
    await page.getByRole('button', { name: `${last.title} Photo Selection client link actions` }).click();
    const menu = page.getByRole('group', { name: 'Photo Selection link options' });
    await expect(menu).toBeVisible();
    expect(await tableViewport.evaluate((element) => element.scrollHeight)).toBe(before);
    expect((await footer.boundingBox())!.y).toBe(footerY);
    const menuBox = await menu.boundingBox();
    expect(menuBox!.y).toBeGreaterThanOrEqual(0);
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test('expired Selection Open routes to the window field instead of a rejected quick save', async ({ page }) => {
    const gallery = { ...exampleGallery, status: 'closed', isExpired: true, selectionDeadlineAt: '2026-09-01T00:00:00Z' };
    const patches: unknown[] = [];
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [gallery], total: 1, totalPages: 1 } }));
    await page.route('**/api/galleries/7', (route) => {
        if (route.request().method() === 'PATCH') {
            const patch = route.request().postDataJSON();
            patches.push(patch);
            Object.assign(gallery, patch, { isExpired: false, selectionDeadlineAt: '2026-11-01T00:00:00Z' });
            return route.fulfill({ json: { status: 'updated' } });
        }
        return route.fulfill({ json: { gallery, photos: [], selections: [] } });
    });
    await page.goto('/galleries');
    await page.getByRole('button', { name: `${gallery.title} Photo Selection status: Expired` }).click();
    await page.getByRole('group', { name: `${gallery.title} Photo Selection status options` }).getByRole('button', { name: 'Reset window to open…' }).click();
    const dialog = page.getByRole('dialog', { name: gallery.title });
    await expect(dialog.locator('input[name="selection-duration"]')).toBeFocused();
    expect(patches).toEqual([]);
    await dialog.getByRole('button', { name: 'Save Photo Selection' }).click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toMatchObject({ status: 'closed', selectionDurationHours: 72 });
    await dialog.getByRole('group', { name: 'Photo Selection status' }).getByRole('button', { name: 'open', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save Photo Selection' }).click();
    await expect.poll(() => patches.length).toBe(2);
    expect(patches[1]).toMatchObject({ status: 'open' });
});

test('each detail tab saves only its fields and preserves the other draft', async ({ page }) => {
    const gallery = { ...exampleGallery, editResultsStatus: 'draft', editResultsFolderId: 'edited-source' };
    const patches: Record<string, unknown>[] = [];
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [gallery], total: 1, totalPages: 1 } }));
    await page.route('**/api/galleries/7', (route) => {
        if (route.request().method() === 'PATCH') {
            patches.push(route.request().postDataJSON());
            Object.assign(gallery, route.request().postDataJSON());
            return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({ json: { gallery, photos: [], selections: [] } });
    });
    await page.goto('/galleries');
    await page.getByText(gallery.title, { exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Gallery title').fill('Unsaved selection title');
    await dialog.getByRole('button', { name: 'closed', exact: true }).click();
    const selectionTabs = await dialog.getByRole('tablist', { name: 'Gallery area' }).boundingBox();
    const selectionSync = await dialog.getByRole('button', { name: 'Sync', exact: true }).boundingBox();
    await dialog.getByRole('tab', { name: 'Edited Photos', exact: true }).click();
    const editedTabs = await dialog.getByRole('tablist', { name: 'Gallery area' }).boundingBox();
    const editedSync = await dialog.getByRole('button', { name: 'Sync', exact: true }).boundingBox();
    expect(Math.abs(((selectionSync?.y ?? 0) - (selectionTabs?.y ?? 0)) - ((editedSync?.y ?? 0) - (editedTabs?.y ?? 0)))).toBeLessThanOrEqual(1);
    await expect(dialog.getByText('Edited Photos not published', { exact: true })).toBeVisible();
    await dialog.getByLabel('Edited photos Drive folder').fill('edited-draft');
    await dialog.getByRole('button', { name: 'closed', exact: true }).click();
    for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        expect(await dialog.locator('.gallery-modal-scroll').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        const duration = await dialog.getByLabel('Download access duration').boundingBox();
        const password = await dialog.getByLabel('Password for publication').boundingBox();
        expect(duration).not.toBeNull();
        expect(password).not.toBeNull();
        if (width >= 640) {
            expect(Math.abs((duration?.y ?? 0) - (password?.y ?? 0))).toBeLessThanOrEqual(1);
            expect(duration?.x).toBeGreaterThan((password?.x ?? 0) + (password?.width ?? 0));
        } else {
            expect(duration?.y).toBeGreaterThan((password?.y ?? 0) + (password?.height ?? 0));
        }
        await expect(dialog.getByRole('button', { name: 'Save Edited Photos', exact: true })).toBeInViewport();
        await page.screenshot({ path: `test-results/admin-edited-${width}.png`, animations: 'disabled' });
    }
    await dialog.getByRole('button', { name: 'Save Edited Photos', exact: true }).click();
    await expect(dialog.getByText('Changes saved', { exact: true })).toBeVisible();
    expect(patches[0]).toMatchObject({ editResultsStatus: 'closed', editResultsFolderId: 'edited-draft' });
    expect(patches[0]).not.toHaveProperty('title');
    expect(patches[0]).not.toHaveProperty('status');
    expect(patches[0]).not.toHaveProperty('pin');
    await dialog.getByRole('tab', { name: 'Photo Selection', exact: true }).click();
    await expect(dialog.getByLabel('Gallery title')).toHaveValue('Unsaved selection title');
    await expect(dialog.getByRole('status').filter({ hasText: /^Unsaved changes/ })).toBeVisible();
    await dialog.getByRole('button', { name: 'Save Photo Selection', exact: true }).click();
    await expect(dialog.getByText('Changes saved', { exact: true })).toBeVisible();
    expect(patches[1]).toMatchObject({ status: 'closed', title: 'Unsaved selection title' });
    expect(patches[1]).not.toHaveProperty('editResultsFolderId');
    expect(patches[1]).not.toHaveProperty('editResultsStatus');
});

test.beforeEach(async ({ page }) => {
    await page.addInitScript((storedUser) => localStorage.setItem('orbit_user', JSON.stringify(storedUser)), user);
    await page.route('**/api/**', async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/api/auth/me') return route.fulfill({ json: { user } });
        if (pathname.includes('/permissions')) return route.fulfill({ json: { userId: 1, role: 'admin', permissions: [], permissionOverrides: {}, featurePermissions: user.featurePermissions } });
        return route.fulfill({ json: {} });
    });
});

test('saving a new edited folder requires Sync before client photos are marked updated', async ({ page }) => {
    let gallery = { ...exampleGallery, status: 'open', editResultsStatus: 'open', editResultsFolderId: 'old-folder', hasEditResults: true, editResultsPhotoCount: 3 };
    let syncs = 0;
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [gallery], total: 1, totalPages: 1 } }));
    await page.route('**/api/galleries/7', (route) => {
        if (route.request().method() === 'PATCH') {
            gallery = { ...gallery, ...route.request().postDataJSON() };
            return route.fulfill({ json: { status: 'updated', editedSourceChanged: true } });
        }
        return route.fulfill({ json: { gallery, photos: [], selections: [] } });
    });
    await page.route('**/api/galleries/7/edit-results/sync', (route) => {
        syncs++;
        gallery = { ...gallery, editResultsPhotoCount: 5 };
        return route.fulfill({ json: { status: 'synced', published: true, photoCount: 5, folderCount: 0 } });
    });
    await page.goto('/galleries?mode=selection');
    await page.getByText(gallery.title, { exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Edited Photos', exact: true }).click();
    await dialog.getByLabel('Edited photos Drive folder').fill('new-folder');
    await dialog.getByRole('button', { name: 'Save Edited Photos', exact: true }).click();
    await expect(dialog.getByText('Saved · Sync to update client photos')).toBeVisible();
    await expect(dialog.getByText('Folder saved. Sync to replace the photos clients see.')).toBeVisible();
    await expect(dialog.getByLabel('Password for publication')).toHaveValue('');
    await dialog.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect.poll(() => syncs).toBe(1);
    await expect(dialog.getByText('Folder saved. Sync to replace the photos clients see.')).toHaveCount(0);
    await expect(page.getByText('Published snapshot updated with 5 edited items. Access settings unchanged.')).toBeVisible();
});

test('Preview Samples saves globally without appearing in gallery details', async ({ page }) => {
    let settings = {
        contactWhatsappUrl: '081234567890', message: 'Access message', requestMoreMessage: 'Request message',
        tutorialBeforeDriveFileId: '', tutorialAfterDriveFileId: '', tutorialBefore2DriveFileId: '',
        tutorialAfter2DriveFileId: '', tutorialBefore3DriveFileId: '', tutorialAfter3DriveFileId: '',
    };
    const patches: Record<string, unknown>[] = [];
    let failPreviewOnce = true;
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [exampleGallery], total: 1, totalPages: 1 } }));
    await page.route('**/api/galleries/7', (route) => route.fulfill({ json: { gallery: exampleGallery, photos: [], selections: [] } }));
    await page.route('**/api/galleries/settings/contact', (route) => {
        if (route.request().method() === 'PATCH') {
            const patch = route.request().postDataJSON();
            patches.push(patch);
            if ('tutorialBeforeDriveFileId' in patch && failPreviewOnce) {
                failPreviewOnce = false;
                return route.fulfill({ status: 503, json: { error: 'Preview settings unavailable.' } });
            }
            settings = { ...settings, ...patch };
            return route.fulfill({ json: settings });
        }
        return route.fulfill({ json: settings });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/galleries');
    await page.getByRole('button', { name: 'Admin WhatsApp' }).click();
    const contactDialog = page.getByRole('dialog', { name: 'Admin WhatsApp' });
    await expect(contactDialog.getByText('Global Before')).toHaveCount(0);
    await contactDialog.getByLabel('Access / unlock message template').fill('Changed access message');
    await contactDialog.getByRole('button', { name: 'Save settings' }).click();
    await expect.poll(() => patches.length).toBe(1);
    await expect(contactDialog).not.toBeVisible();
    expect(patches[0]).toEqual({ contactWhatsappUrl: '081234567890', message: 'Changed access message', requestMoreMessage: 'Request message' });
    await page.getByText(exampleGallery.title, { exact: true }).click();
    const detail = page.getByRole('dialog', { name: exampleGallery.title });
    await expect(detail.getByRole('tab', { name: 'Preview Samples' })).toHaveCount(0);
    await detail.getByRole('button', { name: `Close ${exampleGallery.title}` }).click();
    const previewTab = page.getByRole('tab', { name: 'Preview Samples', exact: true });
    await previewTab.click();
    await expect(page.getByText('Changes here apply to every client gallery.')).toBeVisible();
    const save = page.getByRole('button', { name: 'Save Preview Samples' });
    await expect(save).toBeDisabled();
    const before = page.getByRole('textbox', { name: 'Sample 1 before photo' });
    await before.fill('before-file');
    await expect(save).toBeEnabled();
    await expect(page.getByText('Needs both photos')).toBeVisible();
    await before.fill('');
    await expect(save).toBeDisabled();
    await before.fill('before-file');
    page.once('dialog', (confirmation) => confirmation.dismiss());
    await page.getByRole('tab', { name: 'Selection Events' }).click();
    await expect(previewTab).toHaveAttribute('aria-selected', 'true');
    for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await expect(save).toBeInViewport();
        await page.screenshot({ path: `test-results/admin-preview-${width}.png`, animations: 'disabled' });
    }
    await save.click();
    await expect(page.getByRole('alert')).toContainText('Add both photos for sample 1');
    const after = page.getByRole('textbox', { name: 'Sample 1 edited photo' });
    await expect(after).toBeFocused();
    await after.fill('after-file');
    await expect(page.getByText('Complete', { exact: true })).toBeVisible();
    await save.click();
    await expect(page.getByRole('alert')).toContainText('Preview settings unavailable.');
    await expect(save).toBeEnabled();
    await save.click();
    await expect.poll(() => patches.length).toBe(3);
    expect(patches[2]).toEqual({ tutorialBeforeDriveFileId: 'before-file', tutorialAfterDriveFileId: 'after-file', tutorialBefore2DriveFileId: '', tutorialAfter2DriveFileId: '', tutorialBefore3DriveFileId: '', tutorialAfter3DriveFileId: '' });
    expect(settings.message).toBe('Changed access message');
    await expect(page.getByText('Preview samples saved', { exact: true })).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(before).toHaveValue('before-file');
});

test('Preview Samples offers Retry when global settings cannot load', async ({ page }) => {
    let recover = false;
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [exampleGallery], total: 1, totalPages: 1 } }));
    await page.route('**/api/galleries/7', (route) => route.fulfill({ json: { gallery: exampleGallery, photos: [], selections: [] } }));
    await page.route('**/api/galleries/settings/contact', (route) => {
        if (!recover) return route.fulfill({ status: 503, json: { error: 'Settings unavailable' } });
        return route.fulfill({ json: { contactWhatsappUrl: '', message: '', requestMoreMessage: '', tutorialBeforeDriveFileId: '', tutorialAfterDriveFileId: '', tutorialBefore2DriveFileId: '', tutorialAfter2DriveFileId: '', tutorialBefore3DriveFileId: '', tutorialAfter3DriveFileId: '' } });
    });
    await page.goto('/galleries');
    await page.getByRole('tab', { name: 'Preview Samples', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Unable to load preview samples.');
    await expect(page.getByRole('button', { name: 'Save Preview Samples' })).toBeDisabled();
    recover = true;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('textbox', { name: 'Sample 1 before photo' })).toBeVisible();
});

test('Preview Samples is available as a persistent top-level gallery tab', async ({ page }) => {
    let settings = {
        contactWhatsappUrl: '081234567890', message: 'Access message', requestMoreMessage: 'Request message',
        tutorialBeforeDriveFileId: '', tutorialAfterDriveFileId: '', tutorialBefore2DriveFileId: '',
        tutorialAfter2DriveFileId: '', tutorialBefore3DriveFileId: '', tutorialAfter3DriveFileId: '',
    };
    const patches: Record<string, unknown>[] = [];
    let listRequests = 0;
    await page.route('**/api/galleries?*', (route) => { listRequests++; return route.fulfill({ json: { items: [exampleGallery], total: 1, totalPages: 1 } }); });
    await page.route('**/api/galleries/settings/contact', (route) => {
        if (route.request().method() === 'PATCH') {
            const patch = route.request().postDataJSON();
            patches.push(patch);
            settings = { ...settings, ...patch };
            return route.fulfill({ json: settings });
        }
        return route.fulfill({ json: settings });
    });
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/galleries');
    const previewTab = page.getByRole('tab', { name: 'Preview Samples', exact: true });
    await expect(previewTab).toBeVisible();
    await previewTab.click();
    await expect(page).toHaveURL(/mode=preview/);
    await expect(previewTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Preview Samples', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Preview Samples' })).toBeInViewport();
    await page.screenshot({ path: 'test-results/admin-preview-top-level-320.png', animations: 'disabled' });
    const requestsAtPreview = listRequests;
    const before = page.getByRole('textbox', { name: 'Sample 1 before photo' });
    const after = page.getByRole('textbox', { name: 'Sample 1 edited photo' });
    await before.fill('top-level-before');
    await after.fill('top-level-after');
    await page.getByRole('button', { name: 'Save Preview Samples' }).click();
    await expect.poll(() => patches.length).toBe(1);
    expect(patches[0]).toEqual({ tutorialBeforeDriveFileId: 'top-level-before', tutorialAfterDriveFileId: 'top-level-after', tutorialBefore2DriveFileId: '', tutorialAfter2DriveFileId: '', tutorialBefore3DriveFileId: '', tutorialAfter3DriveFileId: '' });
    expect(listRequests).toBe(requestsAtPreview);
    await page.reload();
    await expect(previewTab).toHaveAttribute('aria-selected', 'true');
    await expect(before).toHaveValue('top-level-before');
    expect(await page.locator('#gallery-list-panel').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
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
    await dialog.getByLabel('Photo Selection password', { exact: true }).fill('1234');
    await expect(dialog.getByLabel('Photo Selection password', { exact: true })).toHaveAttribute('type', 'password');
    await dialog.getByRole('button', { name: 'Show Photo Selection password' }).click();
    await expect(dialog.getByLabel('Photo Selection password', { exact: true })).toHaveAttribute('type', 'text');
    await dialog.getByRole('button', { name: 'Hide Photo Selection password' }).click();
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
    await page.addInitScript(() => localStorage.setItem('darkMode', 'false'));
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
    await expect(dialog.getByRole('status').filter({ hasText: /^Unsaved changes/ })).toBeVisible();
    await page.screenshot({ path: 'test-results/gallery-edit-desktop.png', animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 667 });
    await dialog.getByLabel('Gallery title').fill('My saved title');
    await dialog.getByRole('button', { name: 'Save Photo Selection' }).click();
    await expect(dialog).toHaveAttribute('aria-label', 'My saved title');
    expect(patches).toBe(1);
    expect(gallery.status).toBe('open');
    await page.getByRole('button', { name: 'Dismiss notification' }).click();
    const saveBox = await dialog.getByRole('button', { name: 'Save Photo Selection' }).boundingBox();
    expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(667);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: 'test-results/gallery-edit-mobile.png', animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Close My saved title' }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Save Photo Selection' })).toBeDisabled();
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
});

test('status controls clear dirty state when restored to their saved value', async ({ page }) => {
    const gallery = { ...exampleGallery, editResultsStatus: 'draft', editResultsFolderId: 'edited-folder', hasEditResults: false };
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [gallery], total: 1, totalPages: 1 } }));
    await page.route('**/api/galleries/7', (route) => route.fulfill({ json: { gallery, photos: [], selections: [] } }));
    await page.goto('/galleries');
    await page.getByText(gallery.title, { exact: true }).click();
    const dialog = page.getByRole('dialog');
    const selectionSave = dialog.getByRole('button', { name: 'Save Photo Selection' });
    await expect(selectionSave).toBeDisabled();
    await dialog.getByRole('button', { name: 'open', exact: true }).click();
    await expect(selectionSave).toBeEnabled();
    const openColor = await dialog.getByRole('button', { name: 'open', exact: true }).evaluate((button) => getComputedStyle(button).borderColor);
    const draftColor = await dialog.getByRole('button', { name: 'draft', exact: true }).evaluate((button) => getComputedStyle(button).borderColor);
    expect(openColor).not.toBe(draftColor);
    await dialog.getByRole('button', { name: 'draft', exact: true }).click();
    await expect(selectionSave).toBeDisabled();
    await expect(dialog.getByRole('group', { name: 'Photo Selection status' }).getByRole('button', { name: 'draft', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await dialog.getByRole('tab', { name: 'Edited Photos', exact: true }).click();
    const editedSave = dialog.getByRole('button', { name: 'Save Edited Photos' });
    await expect(editedSave).toBeDisabled();
    await dialog.getByRole('button', { name: 'closed', exact: true }).click();
    await expect(editedSave).toBeEnabled();
    await dialog.getByRole('button', { name: 'draft', exact: true }).click();
    await expect(editedSave).toBeDisabled();
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
    await dialog.getByRole('button', { name: 'Unlock Selection Access' }).click();
    await expect.poll(() => resets).toBe(1);
    expect(patches).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Save Photo Selection' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Unable to save this folder.');
    expect(patches[0]).toMatchObject({ status: 'open', additionalSelectionLimit: 10, editAddonStatus: 'paid', qrisEnabled: true });
    await expect(dialog.getByRole('button', { name: 'open', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByLabel('Add-on edited photos', { exact: true })).toHaveValue('10');
    page.once('dialog', (confirmation) => confirmation.dismiss());
    await dialog.getByRole('button', { name: `Close ${exampleGallery.title}` }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save Photo Selection' })).toBeEnabled();
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
    await dialog.getByLabel('Photo Selection password', { exact: true }).fill('1234');
    await dialog.getByRole('button', { name: 'Create gallery', exact: true }).click();
    await expect(page.getByRole('dialog', { name: exampleGallery.title })).toBeVisible();
    await expect(page.getByLabel('Gallery title')).toHaveValue(exampleGallery.title);
    await page.setViewportSize({ width: 320, height: 700 });
    const selectionPassword = page.getByLabel('Photo Selection password', { exact: true });
    await expect(selectionPassword).toHaveAttribute('placeholder', 'New password');
    const inputBox = await selectionPassword.boundingBox();
    const eyeBox = await page.getByRole('button', { name: 'Show Photo Selection password' }).boundingBox();
    const rightPadding = await selectionPassword.evaluate((input) => parseFloat(getComputedStyle(input).paddingRight));
    expect(inputBox).not.toBeNull();
    expect(eyeBox).not.toBeNull();
    expect(inputBox!.x + inputBox!.width - rightPadding).toBeLessThanOrEqual(eyeBox!.x);
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
        expect(route.request().postDataJSON()).toEqual({ password: 'pass' });
        gallery = { ...gallery, hasEditResults: true, editResultsPhotoCount: 2, editResultsPublishedAt: '2026-10-01T00:00:00.000Z' };
        return route.fulfill({ status: 201, json: { publishedAt: gallery.editResultsPublishedAt, photoCount: 2 } });
    });

    await page.goto('/galleries?mode=selection');
    await page.getByText(gallery.title, { exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Edited Photos' }).click();
    await dialog.getByLabel('Edited photos Drive folder').fill('https://drive.google.com/drive/folders/edited-folder');
    await dialog.getByLabel('Edited Photos ZIP (optional)').fill('https://drive.google.com/file/d/edited-archive/view');
    await dialog.getByRole('button', { name: 'Save Edited Photos' }).click();
    await expect.poll(() => gallery.editResultsFolderId).toBe('https://drive.google.com/drive/folders/edited-folder');
    await expect.poll(() => gallery.editResultsZipFileId).toBe('https://drive.google.com/file/d/edited-archive/view');
    await dialog.getByLabel('Password for publication').fill('pass');
    await expect(dialog.getByLabel('Password for publication')).toHaveAttribute('type', 'password');
    await dialog.getByRole('button', { name: 'Show password', exact: true }).click();
    await expect(dialog.getByLabel('Password for publication')).toHaveAttribute('type', 'text');
    await expect(dialog.getByLabel('Password for publication')).toHaveValue('pass');
    await dialog.getByRole('button', { name: 'Hide password', exact: true }).click();
    await expect(dialog.getByLabel('Password for publication')).toHaveAttribute('type', 'password');
    await dialog.getByRole('button', { name: 'Show password', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save Edited Photos', exact: true }).click();
    await expect(dialog.getByLabel('Password for publication')).toHaveValue('');
    await expect(dialog.getByLabel('Password for publication')).toHaveAttribute('type', 'password');
    await expect(page.getByText('Published 2 edited items across 1 folders with your delivery password.')).toBeVisible();
});

test('admin sees ZIP prebuild progress and can retry failed archives', async ({ page }) => {
    const gallery = { ...exampleGallery, hasEditResults: true, editResultsStatus: 'open', editResultsFolderId: 'edited-folder', editResultsPhotoCount: 8 };
    let retries = 0;
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [gallery], total: 1, totalPages: 1 } }));
    await page.route('**/api/galleries/7', (route) => route.fulfill({ json: { gallery, photos: [], selections: [] } }));
    await page.route('**/api/galleries/7/edit-results/archive/status', (route) => route.fulfill({ json: retries ? { enabled: true, available: true, ready: true, total: 3, completed: 3 } : { enabled: true, available: true, ready: false, total: 3, completed: 1, failed: 1, queued: 1 } }));
    await page.route('**/api/galleries/7/edit-results/archive/rebuild', (route) => { retries++; return route.fulfill({ status: 202, json: { queued: true } }); });
    await page.goto('/galleries?mode=edited');
    await page.getByText(gallery.title, { exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Edited Photos' }).click();
    await expect(dialog.getByText('Preparing ZIPs (1/3), 1 failed')).toBeVisible();
    await dialog.getByRole('button', { name: 'Retry ZIP preparation' }).click();
    await expect.poll(() => retries).toBe(1);
    await expect(dialog.getByText('ZIPs ready (3/3)')).toBeVisible();
});

test('admin actions explain save prerequisites and preserve drafts on API failures', async ({ page }) => {
    let gallery = { ...exampleGallery, editResultsFolderId: 'edited-folder', hasEditResults: true };
    let publishes = 0;
    let syncs = 0;
    let patches = 0;
    let failSave = true;
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [gallery], total: 1, totalPages: 1 } }));
    await page.route('**/api/galleries/7', (route) => {
        if (route.request().method() === 'PATCH') {
            patches++;
            if (failSave) return route.fulfill({ status: 400, json: { error: 'Unable to update client PIN.' } });
            if (route.request().postDataJSON().pin) expect(route.request().postDataJSON().pin).toBe('9876');
            gallery = { ...gallery, ...route.request().postDataJSON() };
            return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({ json: { gallery, photos: [], selections: [] } });
    });
    await page.route('**/api/galleries/7/edit-results/publish', (route) => {
        publishes++;
        expect(route.request().postDataJSON().password).toBe('pass');
        return route.fulfill({ status: 400, json: { error: 'Edited folder cannot be read. Check Drive sharing.' } });
    });
    await page.route('**/api/galleries/7/sync', (route) => { syncs++; return route.fulfill({ status: 500, json: { error: 'Drive sync unavailable.' } }); });
    await page.route('**/api/galleries/7/reset-pin-lock', (route) => route.fulfill({ status: 500, json: { error: 'PIN reset unavailable.' } }));
    await page.goto('/galleries');
    await page.getByText(gallery.title, { exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Photo Selection password', { exact: true }).fill('9876');
    await dialog.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Sync not started. Save changes first');
    await dialog.getByRole('button', { name: 'Unlock Selection Access' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Reset password attempts failed');
    await dialog.getByRole('button', { name: 'Save Photo Selection' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Unable to update client PIN.');
    await dialog.getByRole('tab', { name: 'Edited Photos', exact: true }).click();
    await dialog.getByLabel('Password for publication').fill('pass');
    failSave = false;
    await dialog.getByRole('button', { name: 'Save Edited Photos', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Republish failed. Edited folder cannot be read. Check Drive sharing.');
    expect(publishes).toBe(1);
    await dialog.getByLabel('Edited photos Drive folder').fill('new-edited-folder');
    await dialog.getByRole('tab', { name: 'Photo Selection', exact: true }).click();
    await expect(dialog.getByLabel('Photo Selection password', { exact: true })).toHaveValue('9876');
    await expect(dialog.getByRole('alert')).toHaveText('Unable to update client PIN.');
    await dialog.getByRole('button', { name: 'Save Photo Selection' }).click();
    await expect(dialog.getByLabel('Photo Selection password', { exact: true })).toHaveValue('');
    await dialog.getByRole('button', { name: 'Sync', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Sync failed. Drive sync unavailable.');
    await dialog.getByRole('tab', { name: 'Edited Photos', exact: true }).click();
    await expect(dialog.getByText('Unsaved changes', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Password for publication')).toHaveValue('pass');
    await expect(dialog.getByLabel('Edited photos Drive folder')).toHaveValue('new-edited-folder');
    await dialog.getByRole('button', { name: 'Save Edited Photos' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Republish failed. Edited folder cannot be read. Check Drive sharing.');
    expect([publishes, syncs, patches]).toEqual([2, 1, 4]);
});

test('publishing validates the folder and password before sending a request', async ({ page }) => {
    const gallery = { ...exampleGallery, editResultsFolderId: '' };
    let publishes = 0;
    await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [gallery], total: 1, totalPages: 1 } }));
    await page.route('**/api/galleries/7', (route) => {
        if (route.request().method() === 'PATCH') { Object.assign(gallery, route.request().postDataJSON()); return route.fulfill({ json: { ok: true } }); }
        return route.fulfill({ json: { gallery, photos: [], selections: [] } });
    });
    await page.route('**/api/galleries/7/edit-results/publish', (route) => { publishes++; return route.fulfill({ json: {} }); });
    await page.goto('/galleries?mode=selection');
    await page.getByText(gallery.title, { exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Edited Photos' }).click();
    await dialog.getByLabel('Password for publication').fill('pass');
    await dialog.getByRole('button', { name: 'Save Edited Photos' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Add an Edited photos Drive folder');
    await dialog.getByLabel('Edited photos Drive folder').fill('edited-folder');
    await dialog.getByLabel('Password for publication').fill('short');
    await dialog.getByRole('button', { name: 'Save Edited Photos' }).click();
    await expect(dialog.getByLabel('Password for publication')).toHaveAttribute('maxlength', '4');
    await dialog.getByLabel('Password for publication').fill('12345');
    await expect(dialog.getByLabel('Password for publication')).toHaveValue('1234');
    await dialog.getByRole('button', { name: 'Save Edited Photos' }).click();
    await expect.poll(() => publishes).toBe(1);
});

test('comparison pairing auto-pairs equal counts without a confirmation step', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const before = Array.from({ length: 2 }, (_, index) => ({ driveFileId: `before-${index}`, filename: `source-${index}.jpg`, thumbnailUrl: `/pair-image/before-${index}` }));
        const edited = Array.from({ length: 2 }, (_, index) => ({ driveFileId: `edited-${index}`, filename: `final-${index}.jpg`, thumbnailUrl: `/pair-image/edited-${index}` }));
        let gallery = { ...exampleGallery, editResultsFolderId: 'edited-folder', comparisonEnabled: false, comparisonPairs: [] as Array<{ editedDriveFileId: string; beforeDriveFileId: string }> };
        let transientThumbnailRequests = 0;
        let manualThumbnailRequests = 0;
        await page.route('**/pair-image/*', (route) => {
            const url = route.request().url();
            if (url.includes('edited-0') && transientThumbnailRequests++ === 0) return route.fulfill({ status: 503, body: 'busy' });
            if (url.includes('edited-1') && manualThumbnailRequests++ < 2) return route.fulfill({ status: 503, body: 'busy' });
            return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#718578"/></svg>' });
        });
        await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [gallery], total: 1, totalPages: 1 } }));
        await page.route('**/api/galleries/7', (route) => {
            if (route.request().method() === 'PATCH') {
                const update = route.request().postDataJSON();
                gallery = { ...gallery, ...update };
                return route.fulfill({ json: { status: 'updated', ...(update.comparisonPairs ? { comparisonApplied: true, comparisonCount: update.comparisonPairs.length } : {}) } });
            }
            return route.fulfill({ json: { gallery, photos: [], selections: [] } });
        });
        await page.route('**/api/galleries/7/edit-results/pairing', (route) => route.fulfill({ json: { submitted: before, edited, comparisonEnabled: gallery.comparisonEnabled, comparisonPairs: gallery.comparisonPairs } }));
        await page.goto('/galleries?mode=selection');
        await page.getByText(gallery.title, { exact: true }).click();
        await page.getByRole('dialog').getByRole('tab', { name: 'Edited Photos' }).click();
        await page.getByText('Before & After Comparison', { exact: true }).click();
        await expect(page.getByRole('checkbox', { name: 'Before & After Comparison' })).toBeChecked();
        await page.getByRole('button', { name: /^Manage Pairs/ }).click();
        const dialog = page.getByRole('dialog', { name: 'Manage Pairs', exact: true });
        await expect(dialog.getByAltText('final-0.jpg')).toBeVisible();
        await expect.poll(() => transientThumbnailRequests).toBe(2);
        const retryThumbnail = dialog.getByRole('button', { name: 'Retry thumbnail for final-1.jpg' });
        await expect(retryThumbnail).toBeVisible();
        await retryThumbnail.click();
        await expect(dialog.getByAltText('final-1.jpg')).toBeVisible();
        await expect(dialog.getByText('Auto-paired by order')).toHaveCount(2);
        await expect(dialog.getByRole('button', { name: /Confirm All/ })).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Remove pair for final-1.jpg' }).click();
        await expect(dialog.getByRole('article', { name: 'Pair final-1.jpg' })).toContainText('Edited only · No Before / After');
        await dialog.getByRole('button', { name: 'Apply Pairs' }).click();
        await page.getByRole('button', { name: 'Save Edited Photos', exact: true }).click();
        await expect(page.getByRole('status').filter({ hasText: 'Before / After live on 1 photo' })).toBeVisible();
        await expect.poll(() => gallery.comparisonPairs).toEqual([
            { editedDriveFileId: 'edited-0', beforeDriveFileId: 'before-0' },
        ]);
        await page.getByRole('button', { name: /^Manage Pairs/ }).click();
        await expect(dialog.getByRole('article', { name: 'Pair final-1.jpg' })).toContainText('Edited only · No Before / After');
        await dialog.getByRole('button', { name: 'All Sources' }).click();
        await expect(dialog.getByRole('article', { name: 'Pair final-1.jpg' })).toContainText('Auto-paired by order');
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: /^Manage Pairs/ }).click();
        await expect(dialog.getByRole('article', { name: 'Pair final-1.jpg' })).toContainText('Edited only');
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('Manage Pairs explains an empty Edited Photos folder', async ({ page }) => {
        const gallery = { ...exampleGallery, editResultsFolderId: 'edited-folder', comparisonEnabled: false, comparisonPairs: [] };
        await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [gallery], total: 1, totalPages: 1 } }));
        await page.route('**/api/galleries/7', (route) => route.fulfill({ json: { gallery, photos: [], selections: [] } }));
        await page.route('**/api/galleries/7/edit-results/pairing', (route) => route.fulfill({ json: { submitted: [], edited: [], comparisonEnabled: false, comparisonPairs: [] } }));
        await page.goto('/galleries?mode=selection');
        await page.getByText(gallery.title, { exact: true }).click();
        await page.getByRole('dialog').getByRole('tab', { name: 'Edited Photos' }).click();
        await page.getByText('Before & After Comparison', { exact: true }).click();
        await expect(page.getByRole('checkbox', { name: 'Before & After Comparison' })).toBeChecked();
        await page.getByRole('button', { name: /^Manage Pairs/ }).click();
        const dialog = page.getByRole('dialog', { name: 'Manage Pairs', exact: true });
        await expect(dialog.getByRole('status').filter({ hasText: 'No Edited Photos Found' })).toContainText('Sync the Edited Photos folder');
        await expect(dialog.getByRole('navigation', { name: 'Pairing Pages' })).toHaveCount(0);
});

test('pairing presets keep 14 B&W variants aligned across 84 edited photos', async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const before = Array.from({ length: 70 }, (_, index) => ({ driveFileId: `before-${index}`, filename: `source-${index}.jpg`, thumbnailUrl: `/pair-image/before-${index}` }));
        const edited = Array.from({ length: 84 }, (_, index) => ({ driveFileId: `edited-${index}`, filename: `final-${index}.jpg`, thumbnailUrl: `/pair-image/edited-${index}` }));
        const variantIndexes = new Set([1, 3, 5, 7, 9, 11, 12, 14, 16, 18, 20, 22, 24, 83]);
        let gallery = { ...exampleGallery, editResultsFolderId: 'edited-folder', comparisonEnabled: false, comparisonPairs: [] as Array<{ editedDriveFileId: string; beforeDriveFileId: string }> };
        await page.route('**/pair-image/*', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" />' }));
        await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [gallery], total: 1, totalPages: 1 } }));
        await page.route('**/api/galleries/7', (route) => {
            if (route.request().method() === 'PATCH') { gallery = { ...gallery, ...route.request().postDataJSON() }; return route.fulfill({ json: { status: 'updated' } }); }
            return route.fulfill({ json: { gallery, photos: [], selections: [] } });
        });
        await page.route('**/api/galleries/7/edit-results/pairing', (route) => route.fulfill({ json: { submitted: before, edited, comparisonEnabled: gallery.comparisonEnabled, comparisonPairs: gallery.comparisonPairs } }));
        await page.goto('/galleries?mode=selection');
        await page.getByText(gallery.title, { exact: true }).click();
        await page.getByRole('dialog').getByRole('tab', { name: 'Edited Photos' }).click();
        await page.getByText('Before & After Comparison', { exact: true }).click();
        await expect(page.getByRole('checkbox', { name: 'Before & After Comparison' })).toBeChecked();
        await page.getByRole('button', { name: /^Manage Pairs/ }).click();
        const dialog = page.getByRole('dialog', { name: 'Manage Pairs', exact: true });
        await expect(dialog.getByText('14 extra edited photos. Mark their B&W variants to keep the order aligned.')).toBeVisible();
        await dialog.getByRole('button', { name: 'All Sources' }).click();
        for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
            await page.setViewportSize(viewport);
            await dialog.locator('.gallery-modal-scroll').evaluate((element) => { element.scrollTop = 0; });
            expect(await dialog.locator('.gallery-modal-scroll').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
            await expect(dialog.getByRole('button', { name: 'Apply Pairs' })).toBeInViewport();
            await page.screenshot({ path: testInfo.outputPath(`pairing-preset-${viewport.width}.png`) });
        }
        await page.setViewportSize({ width: 390, height: 844 });
        const firstVariant = dialog.getByRole('article', { name: 'Pair final-1.jpg' }).getByRole('button', { name: 'B&W Variant' });
        await firstVariant.focus();
        await page.keyboard.press('Space');
        await expect(firstVariant).toHaveAttribute('aria-pressed', 'true');

        for (let pairPage = 0; pairPage < 7; pairPage++) {
            for (const index of variantIndexes) {
                if (index === 1) continue;
                if (Math.floor(index / 12) !== pairPage) continue;
                await dialog.getByRole('article', { name: `Pair final-${index}.jpg` }).getByRole('button', { name: 'B&W Variant' }).click();
            }
            if (pairPage < 6) await dialog.getByRole('button', { name: 'Next Pairs' }).click();
        }
        await expect(dialog.getByText('Paired').locator('..').getByText('84', { exact: true })).toBeVisible();
        await expect(dialog.getByText('B&W', { exact: true }).locator('..').getByText('14', { exact: true })).toBeVisible();
        await expect(dialog.getByRole('article', { name: 'Pair final-83.jpg' })).toContainText('#70 source-69.jpg');
        await expect(dialog.locator('[aria-live="polite"]').filter({ hasText: '14 B&W variants marked.' })).toHaveCount(1);

        await dialog.getByRole('button', { name: 'First 10 Sources' }).click();
        await expect(dialog.getByRole('status').filter({ hasText: 'Using suggestions for the first 10 sources.' })).toBeVisible();
        await expect(dialog.getByText('Mark B&W variants within the first 10 sources. Remaining edited photos stay Edited Only.')).toBeVisible();
        await expect(dialog.getByText('Paired').locator('..').getByText('21', { exact: true })).toBeVisible();
        await expect(dialog.getByText('B&W', { exact: true }).locator('..').getByText('14', { exact: true })).toBeVisible();
        for (let index = 0; index < 5; index++) await dialog.getByRole('button', { name: 'Previous Pairs' }).click();
        await expect(dialog.getByRole('article', { name: 'Pair final-20.jpg' })).toContainText('#10 source-9.jpg');
        await expect(dialog.getByRole('article', { name: 'Pair final-21.jpg' })).toContainText('Edited only');
        await dialog.getByRole('article', { name: 'Pair final-20.jpg' }).getByRole('button', { name: 'Choose Before' }).click();
        await expect(dialog.getByRole('button', { name: 'Use source-10.jpg' })).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Back to Pairs' }).click();

        await dialog.getByRole('button', { name: 'All Sources' }).click();
        await expect(dialog.getByText('Paired').locator('..').getByText('84', { exact: true })).toBeVisible();
        await expect(dialog.getByRole('article', { name: 'Pair final-20.jpg' }).getByRole('button', { name: 'B&W Variant' })).toHaveAttribute('aria-pressed', 'true');
        await dialog.getByRole('article', { name: 'Pair final-21.jpg' }).getByRole('button', { name: 'Choose Before' }).click();
        await dialog.getByRole('textbox', { name: 'Search Submitted Photos' }).fill('source-12.jpg');
        await dialog.getByRole('button', { name: 'Use source-12.jpg' }).click();
        await expect(dialog.getByRole('article', { name: 'Pair final-21.jpg' })).toContainText('#13 source-12.jpg');
        await expect(dialog.getByRole('article', { name: 'Pair final-22.jpg' })).toContainText('#13 source-12.jpg');
        await expect(dialog.getByRole('article', { name: 'Pair final-23.jpg' })).toContainText('#14 source-13.jpg');
        const earlierVariant = dialog.getByRole('article', { name: 'Pair final-19.jpg' }).getByRole('button', { name: 'B&W Variant' });
        await earlierVariant.click();
        await expect(dialog.getByRole('article', { name: 'Pair final-21.jpg' })).toContainText('Selected manually');
        await expect(dialog.getByRole('article', { name: 'Pair final-21.jpg' })).toContainText('#13 source-12.jpg');
        await earlierVariant.click();
        await expect(dialog.getByRole('article', { name: 'Pair final-21.jpg' })).toContainText('#13 source-12.jpg');
        await dialog.getByRole('button', { name: 'All Sources' }).click();
        await expect(dialog.getByText('Paired').locator('..').getByText('84', { exact: true })).toBeVisible();
        await dialog.getByRole('button', { name: 'Apply Pairs' }).click();
        await page.getByRole('button', { name: 'Save Edited Photos', exact: true }).click();
        await expect.poll(() => gallery.comparisonPairs.length).toBe(84);
        expect(gallery.comparisonPairs[83]).toEqual({ editedDriveFileId: 'edited-83', beforeDriveFileId: 'before-69' });
        await page.getByRole('button', { name: /^Manage Pairs/ }).click();
        for (let index = 0; index < 6; index++) {
            await dialog.getByRole('button', { name: 'Next Pairs' }).click();
            await expect(dialog.getByRole('status').filter({ hasText: `${index + 2} / 7` })).toBeVisible();
        }
        await expect(dialog.getByRole('article', { name: 'Pair final-83.jpg' }).getByRole('button', { name: 'B&W Variant' })).toHaveAttribute('aria-pressed', 'true');
});

test('comparison pairing realigns 70 submitted photos around a B&W variant', async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const before = Array.from({ length: 70 }, (_, index) => ({ driveFileId: `before-${index}`, filename: `source-${index}.jpg`, thumbnailUrl: `/pair-image/before-${index}` }));
        const edited = Array.from({ length: 71 }, (_, index) => ({ driveFileId: `edited-${index}`, filename: `final-${index}.jpg`, thumbnailUrl: `/pair-image/edited-${index}` }));
        let gallery = { ...exampleGallery, editResultsFolderId: 'edited-folder', comparisonEnabled: false, comparisonPairs: [] as Array<{ editedDriveFileId: string; beforeDriveFileId: string }> };
        let saves = 0;
        await page.route('**/pair-image/*', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#718578"/></svg>' }));
        await page.route('**/api/galleries?*', (route) => route.fulfill({ json: { items: [gallery], total: 1, totalPages: 1 } }));
        await page.route('**/api/galleries/7', (route) => {
            if (route.request().method() === 'PATCH') { saves++; gallery = { ...gallery, ...route.request().postDataJSON() }; return route.fulfill({ json: { status: 'updated' } }); }
            return route.fulfill({ json: { gallery, photos: [], selections: [] } });
        });
        await page.route('**/api/galleries/7/edit-results/pairing', (route) => route.fulfill({ json: { submitted: before, edited, comparisonEnabled: gallery.comparisonEnabled, comparisonPairs: gallery.comparisonPairs } }));
        await page.goto('/galleries?mode=selection');
        await page.getByText(gallery.title, { exact: true }).click();
        await page.getByRole('dialog').getByRole('tab', { name: 'Edited Photos' }).click();
        await page.getByText('Before & After Comparison', { exact: true }).click();
        await expect(page.getByRole('checkbox', { name: 'Before & After Comparison' })).toBeChecked();
        await page.getByRole('button', { name: /^Manage Pairs/ }).click();
        const dialog = page.getByRole('dialog', { name: 'Manage Pairs', exact: true });
        await expect(dialog.getByRole('article')).toHaveCount(12);
        await expect(dialog.getByText('Auto-paired by order')).toHaveCount(12);
        await expect(dialog.getByText('Edited Only').locator('..').getByText('1', { exact: true })).toBeVisible();
        const finalRow = dialog.getByRole('article', { name: 'Pair final-70.jpg' });
        for (let index = 0; index < 5; index++) await dialog.getByRole('button', { name: 'Next Pairs' }).click();
        await expect(finalRow).toBeVisible();
        await expect(finalRow).toContainText('published without Before / After');

        for (let index = 0; index < 4; index++) await dialog.getByRole('button', { name: 'Previous Pairs' }).click();
        const variantRow = dialog.getByRole('article', { name: 'Pair final-20.jpg' });
        const variantToggle = variantRow.getByRole('button', { name: 'B&W Variant' });
        await variantToggle.click();
        await expect(variantToggle).toHaveAttribute('aria-pressed', 'true');
        await expect(variantRow).toContainText('B&W variant');
        await expect(variantRow).toContainText('#20 source-19.jpg');
        await expect(dialog.getByRole('article', { name: 'Pair final-21.jpg' })).toContainText('#21 source-20.jpg');
        await expect(dialog.getByText('Edited Only').locator('..').getByText('0', { exact: true })).toBeVisible();

        await variantToggle.click();
        await expect(dialog.getByText('Edited Only').locator('..').getByText('1', { exact: true })).toBeVisible();
        await variantToggle.click();
        await expect(dialog.getByText('Edited Only').locator('..').getByText('0', { exact: true })).toBeVisible();
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
        await page.getByRole('button', { name: 'Save Edited Photos', exact: true }).click();
        await expect.poll(() => saves).toBe(1);
        expect(gallery.comparisonPairs).toHaveLength(71);
        expect(gallery.comparisonPairs[19]).toEqual({ editedDriveFileId: 'edited-19', beforeDriveFileId: 'before-19' });
        expect(gallery.comparisonPairs[20]).toEqual({ editedDriveFileId: 'edited-20', beforeDriveFileId: 'before-19' });
        expect(gallery.comparisonPairs[21]).toEqual({ editedDriveFileId: 'edited-21', beforeDriveFileId: 'before-20' });
        expect(gallery.comparisonPairs[70]).toEqual({ editedDriveFileId: 'edited-70', beforeDriveFileId: 'before-69' });
        await page.getByRole('button', { name: /^Manage Pairs/ }).click();
        await dialog.getByRole('button', { name: 'Next Pairs' }).click();
        const reopenedVariant = dialog.getByRole('article', { name: 'Pair final-20.jpg' });
        await expect(reopenedVariant.getByRole('button', { name: 'B&W Variant' })).toHaveAttribute('aria-pressed', 'true');
        await expect(reopenedVariant).toContainText('B&W variant');
        await dialog.getByRole('button', { name: 'Close Manage Pairs', exact: true }).click();
        await expect(page.getByRole('dialog')).toHaveCSS('opacity', '1');
        await expect(page.getByRole('button', { name: /^Manage Pairs/ })).toBeFocused();
        await page.getByRole('button', { name: /^Manage Pairs/ }).click();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: /^Manage Pairs/ })).toBeFocused();
        await page.getByRole('button', { name: /^Manage Pairs/ }).click();
        await page.setViewportSize({ width: 320, height: 568 });
        expect(await dialog.locator('.gallery-modal-scroll').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
        await dialog.getByRole('button', { name: 'Remove pair for final-0.jpg' }).click();
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: /^Manage Pairs/ }).click();
        await expect(dialog.getByRole('article', { name: 'Pair final-0.jpg' })).toContainText('Saved pair');
});
