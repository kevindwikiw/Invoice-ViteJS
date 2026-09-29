import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { invoiceItemFromPackage, parsePackageBundleDescription } from './packageCatalog';

const description = `**Prewedding**
- Up to 6 hours of coverage
- 2 Concept & 2 Place

**Wedding**
- Up to 8 hours of coverage
- All RAW files on flashdrive`;

describe('package bundle descriptions', () => {
    test('parses bold section headings and removes nested bullet markers', () => {
        assert.deepEqual(parsePackageBundleDescription(description), [
            { title: 'Prewedding', details: 'Up to 6 hours of coverage\n2 Concept & 2 Place' },
            { title: 'Wedding', details: 'Up to 8 hours of coverage\nAll RAW files on flashdrive' },
        ]);
    });

    test('turns catalog bundles into structured invoice items', () => {
        const item = invoiceItemFromPackage({
            id: 7,
            name: 'Best Offer 1',
            price: 12_000_000,
            category: 'Bundling Package',
            description,
        });

        assert.equal(item.isBundle, true);
        assert.equal(item.details, undefined);
        assert.deepEqual(item._bundleSrc?.map(({ desc, details }) => ({ desc, details })), [
            { desc: 'Prewedding', details: 'Up to 6 hours of coverage\n2 Concept & 2 Place' },
            { desc: 'Wedding', details: 'Up to 8 hours of coverage\nAll RAW files on flashdrive' },
        ]);
    });

    test('keeps ordinary packages unchanged', () => {
        const item = invoiceItemFromPackage({
            id: 8,
            name: 'Wedding Regular',
            price: 5_000_000,
            category: 'Wedding',
            description: '1 Photographer\nAll edited photos',
        });

        assert.equal(item.isBundle, false);
        assert.equal(item.details, '1 Photographer\nAll edited photos');
        assert.equal(item._bundleSrc, undefined);
    });
});
