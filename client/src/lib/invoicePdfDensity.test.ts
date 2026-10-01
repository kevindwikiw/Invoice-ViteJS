import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
    calculateInvoicePdfScale,
    shouldUseDenseInvoiceLayout,
} from './invoicePdfDensity';

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

    test('uses spare A4 height to give short invoices more breathing room', () => {
        const scale = calculateInvoicePdfScale(
            [{ desc: 'Prewedding', details: 'Up to 4 hours\n80 edited photos\nOnline gallery' }],
            {
                eventDetailCount: 3,
                paymentTermCount: 2,
                termsLines: ['Booking fee is non-refundable.'],
            },
        );

        assert.ok(scale > 1);
        assert.ok(scale <= 1.1);
    });

    test('does not over-compress long invoices outside the approved compositions', () => {
        const details = Array.from({ length: 70 }, (_, index) => `Package detail ${index + 1}`).join('\n');
        const scale = calculateInvoicePdfScale(
            [{ desc: 'Wedding', details }],
            {
                eventDetailCount: 3,
                paymentTermCount: 3,
                termsLines: Array.from({ length: 8 }, (_, index) => `Term ${index + 1}`),
                notes: 'A long production note that still needs to remain readable in the invoice.',
            },
        );

        assert.equal(scale, 0.96);
    });

    test('allows approved Best Offer plus Extras layouts to compress further', () => {
        const details = Array.from({ length: 16 }, (_, index) => `Package detail ${index + 1}`).join('\n');
        const scale = calculateInvoicePdfScale(
            [
                {
                    desc: 'Best Offer',
                    isBundle: true,
                    bundleSrc: [
                        { desc: 'Wedding', details },
                        { desc: 'Prewedding', details },
                        { desc: 'Siraman', details },
                    ],
                },
                { desc: 'Extras', details: 'Additional crew\nExtra coverage' },
            ],
            {
                eventDetailCount: 3,
                paymentTermCount: 3,
                termsLines: Array.from({ length: 8 }, (_, index) => `Term ${index + 1}`),
            },
        );

        assert.ok(scale >= 0.88);
        assert.ok(scale < 0.96);
    });

    test('reserves more table space when the post-table content is shorter', () => {
        const items = [{
            desc: 'Best Offer',
            isBundle: true,
            bundleSrc: [
                { desc: 'Wedding', details: 'Coverage\nPhotographer\nEdited photos' },
                { desc: 'Prewedding', details: 'Coverage\nLocations\nEdited photos' },
            ],
        }];
        const shortPostScale = calculateInvoicePdfScale(items, {
            eventDetailCount: 2,
            paymentTermCount: 2,
            termsLines: ['Booking fee is non-refundable.'],
        });
        const longPostScale = calculateInvoicePdfScale(items, {
            eventDetailCount: 3,
            paymentTermCount: 4,
            termsLines: Array.from({ length: 10 }, (_, index) => `Term ${index + 1}`),
            notes: 'Production notes with enough content to occupy several lines in the right column.',
        });

        assert.ok(longPostScale <= shortPostScale);
    });
});
