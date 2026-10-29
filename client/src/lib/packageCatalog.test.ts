import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { eventPricingYear, invoiceItemFromPackage, packagePriceLabel, parsePackageBundleDescription, pricingCitiesFromPackages, resolvePackagePrice } from './packageCatalog';

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

    test('accepts list-prefixed headings from current and legacy descriptions', () => {
        const variants = [
            '- **Wedding**',
            '* **Wedding**',
            '\u2022 **Wedding**',
            '\u00e2\u20ac\u00a2 **Wedding**',
        ];

        for (const heading of variants) {
            assert.deepEqual(parsePackageBundleDescription(`${heading}\n\u2022 1 Photographer`), [
                { title: 'Wedding', details: '1 Photographer' },
            ]);
        }
    });

    test('keeps a bundle heading even when it has no detail lines', () => {
        assert.deepEqual(parsePackageBundleDescription('**Wedding**'), [
            { title: 'Wedding', details: '' },
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

test('uses the existing price for every city in 2026 and city tariffs from 2027', () => {
    const pkg = {
        id: 1, name: 'Best Offer', category: 'Wedding', description: 'Coverage', price: 5_000_000,
        prices: [
            { city: 'Bandung', year: 2026, price: 6_000_000 },
            { city: 'Bandung', year: 2027, price: 7_000_000 },
            { city: 'Jakarta', year: 2026, price: 8_000_000 },
            { city: 'Jakarta', year: 2027, price: 9_000_000 },
        ],
    };
    for (const [city, year, expected] of [
        ['Bandung', 2026, 5_000_000], ['Bandung', 2027, 7_000_000],
        ['Jakarta', 2026, 5_000_000], ['Jakarta', 2027, 9_000_000],
    ] as const) {
        assert.equal(resolvePackagePrice(pkg, city, year), expected);
        assert.equal(invoiceItemFromPackage(pkg, expected).price, expected);
    }
    assert.equal(resolvePackagePrice(pkg, 'Jakarta', 2028), null);
    assert.equal(resolvePackagePrice(pkg, '', 2027), null);
    assert.equal(packagePriceLabel(pkg, 'Jakarta', 2028), 'Harga belum diisi');
    assert.equal(resolvePackagePrice({ ...pkg, price: 0 }, 'Jakarta', 2026), null);
    assert.equal(resolvePackagePrice({ ...pkg, price: 0, category: 'Free / Complimentary' }, 'Jakarta', 2026), 0);
    assert.deepEqual(pricingCitiesFromPackages([pkg, { ...pkg, prices: [{ city: 'Surabaya', year: 2027, price: 10_000_000 }] }]), ['Bandung', 'Jakarta', 'Surabaya']);
    assert.equal(resolvePackagePrice({ ...pkg, prices: [{ city: 'Surabaya', year: 2027, price: 10_000_000 }] }, 'surabaya', 2027), 10_000_000);
    assert.equal(eventPricingYear('2027-03-20'), 2027);
    assert.equal(eventPricingYear(''), null);
});
