import { expect, test } from '@playwright/test';

// Opt-in, controlled startup probe. Mocked media/API isolate frontend cost, not Drive latency.
test('records culling startup with cold browser cache and 4x CPU slowdown', async ({ page, context }, testInfo) => {
    test.skip(!process.env.CULLING_PERF, 'Set CULLING_PERF to run the startup probe.');
    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.addInitScript(() => {
        localStorage.setItem('orbit_culling_token_perf-gallery', 'test-token');
        localStorage.setItem('orbit_culling_tutorial_perf-gallery', '1');
        const entries: { lcp: number; blockingMs: number } = { lcp: 0, blockingMs: 0 };
        Object.assign(window, { cullingPerf: entries });
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) entries.lcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) entries.blockingMs += Math.max(0, entry.duration - 50);
        }).observe({ type: 'longtask', buffered: true });
    });
    await page.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/photos')) return route.fulfill({ json: {
            gallery: {
                id: 1, title: 'Performance Fixture', status: 'open', photoCount: 54, selectionCount: 0,
                syncedAt: '2026-09-02T03:00:00.000Z', serverTime: '2026-09-02T03:00:00.000Z',
                selectionDeadlineAt: '2026-09-05T03:00:00.000Z', selectionDurationHours: 72,
                maxSelections: 30, additionalLimit: 0, isExpired: false, tutorialSampleSlots: [],
                addon: { enabled: false, additionalLimit: 0, unitPrice: 10000, status: 'none' },
            },
            photos: Array.from({ length: 54 }, (_, i) => ({
                id: i + 1, galleryId: 1, driveFileId: `perf-${i}`, filename: `photo-${i}.jpg`,
                mimeType: 'image/jpeg', width: 6000, height: 4000, displayOrder: i, photoToken: 'test-photo-token',
            })),
            page: 1, pageSize: 54, total: 54, totalPages: 1, selectedDriveFileIds: [], selectedPhotos: [],
        } });
        if (path.endsWith('/thumbnail')) return route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#718096"/></svg>',
        });
        if (path.endsWith('/face-search/status')) return route.fulfill({ json: { available: false, status: 'unavailable' } });
        return route.fulfill({ json: {} });
    });
    await page.goto(`${process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5174'}/culling/perf-gallery`);
    await expect(page.getByTestId('gallery-grid').locator('img').first()).toBeVisible();
    await page.waitForTimeout(3000);
    const metrics = await page.evaluate(() => {
        const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        const scripts = resources.filter((resource) => new URL(resource.name).pathname.endsWith('.js'));
        const fonts = resources.filter((resource) => /fonts\.(googleapis|gstatic)\.com/.test(resource.name));
        return {
            ...((window as unknown as { cullingPerf: { lcp: number; blockingMs: number } }).cullingPerf),
            fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
            jsDecodedBytes: scripts.reduce((total, resource) => total + resource.decodedBodySize, 0),
            externalFontRequests: fonts.length,
            highPriorityPhotos: document.querySelectorAll('[data-testid="gallery-grid"] img[fetchpriority="high"]').length,
        };
    });
    const report = { label: process.env.CULLING_PERF, repeat: testInfo.repeatEachIndex, ...metrics };
    console.log(JSON.stringify(report));
    await testInfo.attach('startup.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});
