import { expect, test } from '@playwright/test';

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
});
