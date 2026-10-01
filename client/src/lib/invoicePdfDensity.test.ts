import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { shouldUseDenseInvoiceLayout } from './invoicePdfDensity';

describe('invoice PDF density', () => {
    test('uses dense layout for a three-section Best Offer with Extras', () => {
        assert.equal(shouldUseDenseInvoiceLayout([
            {
                desc: 'Best Offer',
                isBundle: true,
                bundleSrc: [{ desc: 'Wedding' }, { desc: 'Prewedding' }, { desc: 'Siraman' }],
            },
            { desc: 'Extras' },
        ]), true);
    });

    test('uses dense layout for three separate packages with Extras', () => {
        assert.equal(shouldUseDenseInvoiceLayout([
            { desc: 'Wedding' },
            { desc: 'Prewedding' },
            { desc: 'Siraman' },
            { desc: 'Extras' },
        ]), true);
    });

    test('keeps every other composition at normal density', () => {
        assert.equal(shouldUseDenseInvoiceLayout([
            {
                desc: 'Best Offer',
                isBundle: true,
                bundleSrc: [{ desc: 'Wedding' }, { desc: 'Prewedding' }, { desc: 'Siraman' }],
            },
        ]), false);
        assert.equal(shouldUseDenseInvoiceLayout([
            { desc: 'Wedding' },
            { desc: 'Prewedding' },
            { desc: 'Extras' },
        ]), false);
    });
});
