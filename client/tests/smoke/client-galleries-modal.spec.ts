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

test('status refresh preserves edit draft and gallery stays open after leaving the list', async ({ page }) => {
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
    await page.getByRole('button', { name: 'Dismiss notification' }).click();
    await page.screenshot({ path: 'test-results/gallery-edit-desktop.png', animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 667 });
    await dialog.getByLabel('Gallery title').fill('My saved title');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toHaveAttribute('aria-label', 'My saved title');
    await page.getByRole('button', { name: 'Dismiss notification' }).click();
    const saveBox = await dialog.getByRole('button', { name: 'Save changes' }).boundingBox();
    expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(667);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.screenshot({ path: 'test-results/gallery-edit-mobile.png', animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Close My saved title' }).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeFocused();
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
