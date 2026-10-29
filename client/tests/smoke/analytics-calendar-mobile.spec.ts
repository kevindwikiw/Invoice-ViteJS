import { expect, test } from '@playwright/test';

test('event calendar details stay inside the phone viewport', async ({ page }) => {
    const user = { id: 1, email: 'admin@orbit.test', name: 'Admin', role: 'admin', featurePermissions: { view_market_insights: true } };
    await page.addInitScript((storedUser) => localStorage.setItem('orbit_user', JSON.stringify(storedUser)), user);
    await page.route('**/api/users/1/permissions', (route) => route.fulfill({ json: { userId: 1, role: 'admin', permissions: [], permissionOverrides: {}, featurePermissions: user.featurePermissions } }));
    await page.route('**/api/analytics', (route) => route.fulfill({ json: {
        bookings: [{ id: 9, amount: 2_300_000, venue: 'Setiakhaus Ballroom', client_name: 'Vira & Mus Prewedding', date_obj: '2026-04-04T00:00:00', year: 2026, month: 4, day: 4, month_name: 'April', date_str: '2026-04-04' }],
        items: [],
        meta: { total_loaded: 1, monthly_target: 50_000_000, unique_clients: ['Vira & Mus Prewedding'], unique_venues: ['Setiakhaus Ballroom'] },
    } }));
    for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto('/analytics');
        const day = page.getByRole('button', { name: /4 April 2026, 1 booking/i });
        await expect(day).toBeVisible();
        await day.click();
        const details = page.getByRole('region', { name: /Bookings for 4 April 2026/i });
        await expect(details).toContainText('Vira & Mus Prewedding');
        await expect(details).toContainText('Setiakhaus Ballroom');
        const box = await details.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (width === 390) await page.screenshot({ path: 'test-results/analytics-calendar-mobile.png', fullPage: true, animations: 'disabled' });
        await day.click();
        await expect(details).toHaveCount(0);
    }
});
