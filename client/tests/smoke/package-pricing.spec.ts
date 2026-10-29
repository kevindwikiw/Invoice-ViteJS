import { expect, test } from '@playwright/test';

test('invoice catalog selects a 2027 city price and clears selected packages when the city changes', async ({ page }) => {
    const year = 2027;
    await page.clock.setFixedTime(new Date('2027-06-01T12:00:00Z'));
    const features = [
        'manage_users', 'manage_packages', 'delete_packages', 'create_invoices', 'edit_invoices',
        'download_invoices', 'delete_history', 'view_market_insights', 'view_billing_history',
        'edit_billing_history', 'view_audit_logs', 'view_feedback_inbox', 'manage_client_galleries',
    ];
    await page.addInitScript((featureKeys) => {
        localStorage.setItem('orbit_user', JSON.stringify({
            id: 1, name: 'Test Admin', email: 'test@orbit.invalid', role: 'admin',
            featurePermissions: Object.fromEntries(featureKeys.map((key) => [key, true])),
        }));
    }, features);
    await page.route('**/api/packages', (route) => route.fulfill({ json: [
        {
            id: 99, name: 'Test Wedding', price: 5_000_000, category: 'Wedding',
            description: 'Coverage', isActive: 1,
            prices: [
                { city: 'Bandung', year, price: 6_000_000 },
                { city: 'Jakarta', year, price: 8_000_000 },
            ],
        },
        {
            id: 100, name: 'Unpriced Wedding', price: 4_000_000, category: 'Wedding',
            description: 'Coverage', isActive: 1, prices: [],
        },
    ] }));
    await page.route('**/api/config', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/sequences/invoice', (route) => route.fulfill({ json: { prefix: 'INV', next_value: 1, padding: 3, last_value: 0 } }));

    await page.goto('/create');
    await expect(page.locator('.invoice-overview-fields > div')).toHaveCount(9);
    await page.getByRole('button', { name: 'Open Full Catalog' }).click();
    let dialog = page.getByRole('dialog', { name: 'Package Catalog' });
    await expect(dialog.getByLabel('Add Test Wedding').first()).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Tentukan Tanggal & Kota' })).toBeVisible();
    await expect(dialog.getByText('Isi tanggal dan kota acara')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Tentukan Tanggal & Kota' }).click();
    await expect(dialog).not.toBeVisible();

    await page.getByRole('button', { name: '15', exact: true }).first().click();
    await page.getByRole('button', { name: 'Pilih kota acara' }).last().click();
    await page.getByRole('option', { name: 'Bandung' }).click();
    await page.getByRole('button', { name: 'Open Full Catalog' }).click();
    dialog = page.getByRole('dialog', { name: 'Package Catalog' });
    await expect(dialog.getByText('Rp 6.000.000').last()).toBeVisible();
    await expect(dialog.getByText('Harga belum diisi').last()).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Isi harga' })).toBeVisible();
    await expect(dialog.getByLabel('Add Unpriced Wedding').first()).toBeDisabled();
    await dialog.getByText('Test Wedding', { exact: true }).last().click();
    await dialog.getByRole('button', { name: 'Apply 1 Change' }).click();
    await expect(page.getByText('Test Wedding', { exact: true }).last()).toBeVisible();

    page.once('dialog', (confirmation) => confirmation.accept());
    await page.getByRole('button', { name: 'Kota Acara', exact: true }).click();
    await page.getByRole('option', { name: 'Jakarta' }).click();
    await expect(page.getByText('Your Cart is Empty')).toBeVisible();
    await page.getByRole('button', { name: 'Open Full Catalog' }).click();
    dialog = page.getByRole('dialog', { name: 'Package Catalog' });
    await expect(dialog.getByText('Rp 8.000.000').last()).toBeVisible();
    await dialog.getByText('Test Wedding', { exact: true }).last().click();
    await dialog.getByRole('button', { name: 'Apply 1 Change' }).click();
    await page.getByLabel('Client Name').fill('Test Client');
    await page.getByLabel('Location / Venue').fill('Demo Ballroom');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const draft = await page.evaluate(() => JSON.parse(sessionStorage.getItem('invoice_preview') || '{}'));
    expect(draft._savePayload.pricingCity).toBe('Jakarta');
    expect(draft._savePayload.venue).toBe('Demo Ballroom');
    expect(draft._savePayload.items[0].price).toBe(8_000_000);
});

test('existing 2026 price applies to both cities without removing the selected package', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-06-01T12:00:00Z'));
    await page.addInitScript(() => {
        localStorage.setItem('orbit_user', JSON.stringify({
            id: 1, name: 'Test Admin', email: 'test@orbit.invalid', role: 'admin',
            featurePermissions: { create_invoices: true, manage_packages: true },
        }));
    });
    await page.route('**/api/packages', (route) => route.fulfill({ json: [{
        id: 99, name: 'Existing Wedding', price: 5_000_000, category: 'Wedding',
        description: 'Coverage', isActive: 1, prices: [],
    }] }));
    await page.route('**/api/config', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/sequences/invoice', (route) => route.fulfill({ json: { prefix: 'INV', next_value: 1, padding: 3, last_value: 0 } }));

    await page.goto('/create');
    await page.locator('#event-date').click();
    await page.getByRole('button', { name: '15', exact: true }).first().click();
    await page.getByRole('button', { name: 'Kota Acara', exact: true }).click();
    await page.getByRole('option', { name: 'Bandung' }).click();
    await page.getByRole('button', { name: 'Open Full Catalog' }).click();
    let dialog = page.getByRole('dialog', { name: 'Package Catalog' });
    await expect(dialog.getByText('Rp 5.000.000').last()).toBeVisible();
    await dialog.getByText('Existing Wedding', { exact: true }).last().click();
    await dialog.getByRole('button', { name: 'Apply 1 Change' }).click();
    await page.getByRole('button', { name: 'Kota Acara', exact: true }).click();
    await page.getByRole('option', { name: 'Jakarta' }).click();
    await expect(page.getByText('Your Cart is Empty')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open Full Catalog' }).click();
    dialog = page.getByRole('dialog', { name: 'Package Catalog' });
    await expect(dialog.getByText('Rp 5.000.000').last()).toBeVisible();
});

test('missing tariff can be saved from the invoice and adds the package without losing the draft', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2027-06-01T12:00:00Z'));
    await page.addInitScript(() => {
        localStorage.setItem('orbit_user', JSON.stringify({
            id: 1, name: 'Test Admin', email: 'test@orbit.invalid', role: 'admin',
            featurePermissions: { create_invoices: true, manage_packages: true },
        }));
    });
    const pkg = { id: 100, name: 'Unpriced Wedding', price: 4_000_000, category: 'Wedding', description: 'Coverage', isActive: 1, prices: [] as Array<{ city: string; year: number; price: number }> };
    const saved: Array<{ city: string; year: number; price: number }> = [];
    await page.route('**/api/packages', (route) => route.fulfill({ json: [pkg] }));
    await page.route('**/api/packages/100/price', async (route) => {
        const body = route.request().postDataJSON() as { city: string; year: number; price: number };
        saved.push(body);
        pkg.prices.push(body);
        await route.fulfill({ json: { status: 'updated', ...body } });
    });
    await page.route('**/api/config', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/sequences/invoice', (route) => route.fulfill({ json: { prefix: 'INV', next_value: 1, padding: 3, last_value: 0 } }));

    await page.goto('/create');
    await page.getByLabel('Client Name').fill('Draft Client');
    await page.locator('#event-date').click();
    await page.getByRole('button', { name: '15', exact: true }).first().click();
    await page.getByRole('button', { name: 'Kota Acara', exact: true }).click();
    await page.getByRole('option', { name: 'Bandung' }).click();
    await page.getByRole('button', { name: 'Open Full Catalog' }).click();
    await page.getByRole('dialog', { name: 'Package Catalog' }).getByRole('button', { name: 'Isi harga' }).click();
    const priceDialog = page.getByRole('dialog', { name: 'Isi harga paket' });
    await priceDialog.getByLabel('Harga Bandung 2027').fill('7000000');
    await priceDialog.getByRole('button', { name: 'Simpan & Tambahkan' }).click();
    await expect(priceDialog).not.toBeVisible();
    expect(saved).toEqual([{ city: 'Bandung', year: 2027, price: 7_000_000 }]);
    await expect(page.getByLabel('Client Name')).toHaveValue('Draft Client');
    await expect(page.getByText('Your Cart is Empty')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open Full Catalog' }).click();
    await expect(page.getByRole('dialog', { name: 'Package Catalog' }).getByText('Rp 7.000.000').last()).toBeVisible();
    await page.getByRole('dialog', { name: 'Package Catalog' }).getByRole('button', { name: 'Cancel' }).click();

    page.once('dialog', (confirmation) => confirmation.accept());
    await page.getByRole('button', { name: 'Kota Acara', exact: true }).click();
    await page.getByRole('option', { name: 'Jakarta' }).click();
    await page.getByRole('button', { name: 'Isi harga Unpriced Wedding' }).click();
    const jakartaDialog = page.getByRole('dialog', { name: 'Isi harga paket' });
    await jakartaDialog.getByLabel('Harga Jakarta 2027').fill('8000000');
    await jakartaDialog.getByRole('button', { name: 'Simpan & Tambahkan' }).click();
    await expect(jakartaDialog).not.toBeVisible();
    expect(saved[1]).toEqual({ city: 'Jakarta', year: 2027, price: 8_000_000 });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const draft = await page.evaluate(() => JSON.parse(sessionStorage.getItem('invoice_preview') || '{}'));
    expect(draft._savePayload.clientName).toBe('Draft Client');
    expect(draft._savePayload.items[0].price).toBe(8_000_000);
});

test('package editor saves an editable general 2026 price and 2027 city tariffs', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('orbit_user', JSON.stringify({
            id: 1, name: 'Test Admin', email: 'test@orbit.invalid', role: 'admin',
            featurePermissions: { manage_packages: true },
        }));
    });
    const pkg = {
        id: 99, name: 'Best Offer', price: 14_500_000, category: 'Wedding',
        description: 'Coverage', isActive: 1, prices: [],
    };
    const captured: { body?: Record<string, unknown> } = {};
    await page.route('**/api/packages?all=true', (route) => route.fulfill({ json: [pkg] }));
    await page.route('**/api/packages/99', async (route) => {
        captured.body = route.request().postDataJSON();
        await route.fulfill({ json: { status: 'updated' } });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Edit Package' }).click();
    await expect(page.getByLabel('Harga 2026 (semua kota)')).toHaveValue('14.500.000');
    await expect(page.getByText('Belum ada tarif per kota. Tambahkan tahun untuk mulai mengisi.')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await page.getByLabel('New tariff year').fill('2027');
    await page.getByRole('button', { name: 'Add Year' }).click();
    await page.getByLabel('Harga 2026 (semua kota)').fill('15000000');
    await page.getByLabel('Bandung 2027 price').fill('16000000');
    await page.getByLabel('Jakarta 2027 price').fill('17000000');
    await page.getByRole('button', { name: 'Update Changes' }).click();
    await expect.poll(() => captured.body).toBeDefined();
    expect(captured.body?.prices).toEqual([
        { city: 'Bandung', year: 2027, price: 16_000_000 },
        { city: 'Jakarta', year: 2027, price: 17_000_000 },
    ]);
    expect(captured.body?.price).toBe(15_000_000);
});

test('new package requires an explicit 2026 price', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('orbit_user', JSON.stringify({
            id: 1, name: 'Test Admin', email: 'test@orbit.invalid', role: 'admin',
            featurePermissions: { manage_packages: true },
        }));
    });
    const captured: { body?: Record<string, unknown> } = {};
    await page.route('**/api/packages?all=true', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/packages', async (route) => {
        captured.body = route.request().postDataJSON();
        await route.fulfill({ json: { id: 101 } });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Create Packages' }).click();
    await page.getByLabel('Package Name').fill('New Wedding');
    await page.getByRole('button', { name: 'Create Package', exact: true }).last().click();
    await expect(page.getByRole('alert')).toContainText('Isi harga 2026');
    expect(captured.body).toBeUndefined();
    await page.getByLabel('Harga 2026 (semua kota)').fill('12000000');
    await page.getByRole('button', { name: 'Create Package', exact: true }).last().click();
    await expect.poll(() => captured.body).toBeDefined();
    expect(captured.body?.price).toBe(12_000_000);
});

test('deleting a tariff year removes every city price for that year on save', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('orbit_user', JSON.stringify({
            id: 1, name: 'Test Admin', email: 'test@orbit.invalid', role: 'admin',
            featurePermissions: { manage_packages: true },
        }));
    });
    const pkg = {
        id: 99, name: 'Best Offer', price: 14_500_000, category: 'Wedding',
        description: 'Coverage', isActive: 1,
        prices: [
            { city: 'Bandung', year: 2026, price: 14_500_000 },
            { city: 'Jakarta', year: 2026, price: 15_500_000 },
            { city: 'Bandung', year: 2027, price: 16_000_000 },
            { city: 'Jakarta', year: 2027, price: 17_000_000 },
        ],
    };
    const captured: { body?: Record<string, unknown> } = {};
    await page.route('**/api/packages?all=true', (route) => route.fulfill({ json: [pkg] }));
    await page.route('**/api/packages/99', async (route) => {
        captured.body = route.request().postDataJSON();
        await route.fulfill({ json: { status: 'updated' } });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Edit Package' }).click();
    await expect(page.getByLabel('Bandung 2026 price')).toHaveCount(0);
    page.once('dialog', (confirmation) => confirmation.accept());
    await page.getByRole('button', { name: 'Delete 2027 tariffs' }).click();
    await expect(page.getByLabel('Bandung 2027 price')).toHaveCount(0);
    await page.getByRole('button', { name: 'Update Changes' }).click();
    await expect.poll(() => captured.body).toBeDefined();
    expect(captured.body?.prices).toEqual([
        { city: 'Bandung', year: 2026, price: 14_500_000 },
        { city: 'Jakarta', year: 2026, price: 15_500_000 },
    ]);
});
