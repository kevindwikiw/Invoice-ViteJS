import { expect, test } from '@playwright/test';

test('invoice preview embeds a converted payment proof', async ({ page }) => {
    const user = {
        id: 1,
        email: 'pdf-preview@orbit.test',
        name: 'PDF Preview',
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
    const proofSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800">
            <rect width="1200" height="1800" fill="#f7f7f7"/>
            <rect x="90" y="110" width="1020" height="1580" rx="24" fill="#ffffff" stroke="#222222" stroke-width="5"/>
            <text x="600" y="270" text-anchor="middle" font-family="Arial" font-size="72" font-weight="700">PAYMENT RECEIPT</text>
            <text x="150" y="470" font-family="Arial" font-size="42">Transfer to The Orbit Photo</text>
            <text x="150" y="620" font-family="Arial" font-size="42">Amount</text>
            <text x="1050" y="620" text-anchor="end" font-family="Arial" font-size="54" font-weight="700">IDR 5,000,000</text>
            <line x1="150" y1="720" x2="1050" y2="720" stroke="#cccccc" stroke-width="3"/>
            <text x="150" y="860" font-family="Arial" font-size="42">Status</text>
            <text x="1050" y="860" text-anchor="end" font-family="Arial" font-size="48" font-weight="700" fill="#177245">SUCCESS</text>
            <text x="150" y="1080" font-family="Arial" font-size="36">Reference ORBIT-PDF-PROOF-001</text>
            <text x="150" y="1210" font-family="Arial" font-size="36">01 September 2026, 10:30 WIB</text>
        </svg>
    `;
    const preview = {
        invoiceNo: 'INV-PROOF-001',
        clientName: 'Preview Client',
        date: '2026-09-01',
        totalAmount: 5_000_000,
        paymentProofs: JSON.stringify([
            `data:image/svg+xml;charset=utf-8,${encodeURIComponent(proofSvg)}`,
        ]),
        invoiceData: JSON.stringify({
            eventTitle: 'Payment Proof Render Test',
            weddingDate: '2026-09-01',
            venue: 'Orbit Studio',
            items: [{ name: 'Photography', desc: 'Photography', qty: 1, price: 5_000_000 }],
            paymentTerms: [{ label: 'Paid', amount: 5_000_000 }],
        }),
    };

    await page.addInitScript(({ storedUser, storedPreview }) => {
        localStorage.setItem('orbit_user', JSON.stringify(storedUser));
        sessionStorage.setItem('invoice_preview', JSON.stringify(storedPreview));
    }, { storedUser: user, storedPreview: preview });

    await page.route('**/api/users/1/permissions', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
                userId: 1,
                role: 'admin',
                permissions: [],
                permissionOverrides: {},
                featurePermissions: user.featurePermissions,
            }),
        });
    });

    await page.goto('/invoices/preview');
    const viewer = page.getByTitle('Invoice INV-PROOF-001');
    await expect(viewer).toBeVisible({ timeout: 30_000 });

    const pdfResult = await viewer.evaluate(async (iframe) => {
        const source = (iframe as HTMLIFrameElement).src;
        const buffer = await fetch(source).then((response) => response.arrayBuffer()) as ArrayBuffer;
        const bytes = new Uint8Array(buffer);
        const sourceText = new TextDecoder('latin1').decode(bytes);
        return {
            size: bytes.byteLength,
            pageCount: [...sourceText.matchAll(/\/Type\s*\/Page\b/g)].length,
            pageHeights: [...sourceText.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+[\d.]+\s+([\d.]+)\s*\]/g)]
                .map((match) => Number(match[1])),
        };
    });
    expect(pdfResult.size).toBeGreaterThan(20_000);
    expect(pdfResult.pageCount).toBe(2);
    expect(pdfResult.pageHeights).toHaveLength(2);
    expect(pdfResult.pageHeights.every((height) => height > 800)).toBe(true);
});
