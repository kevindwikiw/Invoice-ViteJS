import { expect, test, type Page } from '@playwright/test';

const email = process.env.E2E_EMAIL ?? '';
const password = process.env.E2E_PASSWORD ?? '';

type CreatedInvoice = {
    id: number;
    invoiceNo: string;
};

type SequenceState = {
    last_value: number;
};

type CatalogPackage = {
    id: number;
    name: string;
};

async function authenticatedRequest<T>(
    page: Page,
    path: string,
    init: { method?: string; body?: unknown; formFile?: boolean } = {},
): Promise<T> {
    return page.evaluate(async ({ path, init }) => {
        const token = localStorage.getItem('orbit_access_token');
        if (!token) throw new Error('Smoke test has no access token after login');

        const headers = new Headers({ Authorization: `Bearer ${token}` });
        let body: BodyInit | undefined;

        if (init.formFile) {
            const pngBytes = Uint8Array.from(atob(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            ), (character) => character.charCodeAt(0));
            const form = new FormData();
            form.append('file', new File([pngBytes], 'smoke-proof.png', { type: 'image/png' }));
            body = form;
        } else if (init.body !== undefined) {
            headers.set('Content-Type', 'application/json');
            body = JSON.stringify(init.body);
        }

        const response = await fetch(`/api${path}`, {
            method: init.method ?? 'GET',
            headers,
            body,
            signal: AbortSignal.timeout(15_000),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
        }
        return payload as T;
    }, { path, init });
}

test('critical invoice workflow', async ({ page }) => {
    test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD before running smoke tests.');
    test.setTimeout(120_000);
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const clientName = `Smoke Client ${uniqueId}`;
    const requestedInvoiceNo = `E2E-${uniqueId}`;
    const cleanup: { invoice?: CreatedInvoice; sequence?: SequenceState } = {};

    await test.step('login', async () => {
        await page.goto('/login');
        await page.getByLabel('Email Address').fill(email);
        await page.getByLabel('Password').fill(password);
        await page.getByRole('button', { name: 'Sign In' }).click();
        await expect(page).not.toHaveURL(/\/login$/);
        await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('orbit_access_token')))).toBe(true);
    });

    try {
        await test.step('open and apply full package catalog', async () => {
            const packages = await authenticatedRequest<CatalogPackage[]>(page, '/packages');
            await page.goto('/create');
            await page.getByRole('button', { name: 'Open Full Catalog' }).click();
            const dialog = page.getByRole('dialog', { name: 'Package Catalog' });
            await expect(dialog).toBeVisible();

            const firstPackage = packages[0];
            if (!firstPackage) {
                await dialog.getByRole('button', { name: 'Cancel' }).click();
                await expect(dialog).not.toBeVisible();
                return;
            }

            await dialog.getByPlaceholder('Search package name or details...').fill(firstPackage.name);
            await dialog.getByLabel(`Add ${firstPackage.name}`).first().check();
            await dialog.getByRole('button', { name: 'Apply 1 Change' }).click();
            await expect(dialog).not.toBeVisible();
            await expect(page.getByText(firstPackage.name, { exact: true }).first()).toBeVisible();
        });

        await test.step('create invoice', async () => {
            cleanup.sequence = await authenticatedRequest<SequenceState>(page, '/sequences/invoice');
            cleanup.invoice = await authenticatedRequest<CreatedInvoice>(page, '/invoices', {
                method: 'POST',
                body: {
                    clientName,
                    invoiceNo: requestedInvoiceNo,
                    venue: 'Smoke Test Venue',
                    weddingDate: '2026-08-13',
                    clientPhone: '62000000000',
                    eventTitle: 'Automated Smoke Test',
                    hours: '08:00 - 09:00',
                    items: [{ id: 'smoke-item', desc: 'Smoke Package', qty: 1, price: 100_000 }],
                    paymentTerms: [
                        { id: 'dp', label: 'Down Payment', amount: 0, locked: true },
                        { id: 'full', label: 'Pelunasan', amount: 0, locked: true },
                    ],
                    cashback: 0,
                    totalAmount: 100_000,
                    bankName: 'BCA',
                    bankAcc: '0000000000',
                    bankHolder: 'ORBIT SMOKE TEST',
                    terms: 'Automated smoke test invoice',
                    footerAddress: 'Smoke Test',
                    footerEmail: 'smoke@example.com',
                    footerIG: '@smoke',
                    footerPhone: '0000',
                    waTemplate: 'Smoke {invoiceNo}',
                    notes: 'Created by Playwright smoke test',
                },
            });
            expect(cleanup.invoice.invoiceNo).toBe(requestedInvoiceNo);
            expect(cleanup.invoice.id).toBeGreaterThan(0);
        });

        await test.step('upload proof', async () => {
            if (!cleanup.invoice) throw new Error('Invoice was not created');
            const upload = await authenticatedRequest<{ proofs: string[] }>(page, `/invoices/${cleanup.invoice.id}/proofs`, {
                method: 'POST',
                formFile: true,
            });
            expect(upload.proofs).toHaveLength(1);

            const proofResponse = await page.request.get(`/uploads/proofs/${encodeURIComponent(upload.proofs[0])}`);
            expect(proofResponse.ok()).toBe(true);
            expect(proofResponse.headers()['content-type']).toContain('image/png');
        });

        await test.step('generate invoice PDF', async () => {
            if (!cleanup.invoice) throw new Error('Invoice was not created');
            const renderedInvoiceNo = cleanup.invoice.invoiceNo.toUpperCase();
            await page.goto('/history');
            await page.getByLabel('Search invoices by client name, number, or venue').fill(cleanup.invoice.invoiceNo);
            await expect(page.getByRole('link', { name: renderedInvoiceNo, exact: true })).toBeVisible();

            const downloadPromise = page.waitForEvent('download');
            await page.getByLabel(`Download ${renderedInvoiceNo} PDF`).click();
            const download = await downloadPromise;
            expect(download.suggestedFilename().toUpperCase()).toContain(renderedInvoiceNo);
            const stream = await download.createReadStream();
            let bytes = 0;
            for await (const chunk of stream) bytes += chunk.length;
            expect(bytes).toBeGreaterThan(1_000);
        });

        await test.step('verify Audit Logs', async () => {
            if (!cleanup.invoice) throw new Error('Invoice was not created');
            await page.goto('/activity');
            await expect(page.getByRole('heading', { name: 'Audit Logs' })).toBeVisible();
            await page.getByLabel('Search activity').fill(cleanup.invoice.invoiceNo);
            await expect(page.getByRole('link', { name: cleanup.invoice.invoiceNo, exact: true }).first()).toBeVisible();
            await expect(page.getByText('CREATED', { exact: true }).first()).toBeVisible();
        });
    } finally {
        if (cleanup.invoice) {
            await authenticatedRequest(page, `/invoices/${cleanup.invoice.id}`, { method: 'DELETE' }).catch(() => undefined);
        }
        if (cleanup.sequence) {
            await authenticatedRequest(page, '/sequences/invoice', {
                method: 'PUT',
                body: { last_value: cleanup.sequence.last_value },
            }).catch(() => undefined);
        }
    }
});
