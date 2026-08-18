import { expect, test, type Page } from '@playwright/test';

const email = process.env.E2E_EMAIL ?? '';
const password = process.env.E2E_PASSWORD ?? '';
const allowFeedbackWrite = process.env.E2E_FEEDBACK_WRITE === '1';

async function login(page: Page): Promise<void> {
    await page.goto('/login');
    await page.getByLabel('Email Address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).not.toHaveURL(/\/login$/);
    await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('orbit_access_token')))).toBe(true);
}

test('anonymous feedback form is available at the simple public URL', async ({ page }) => {
    await page.goto('/feedback');

    await expect(page).toHaveURL(/\/feedback$/);
    await expect(page.getByRole('heading', { name: 'How was it working with us?' })).toBeVisible();
    await expect(page.getByLabel('Invoice number')).toHaveCount(0);
    await expect(page.getByLabel('Your names')).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(5);
    await expect(page.getByLabel("Anything else you'd like to share?")).toBeVisible();
    await expect(page.getByLabel('Choose a photo from your day')).toBeAttached();
    await expect(page.getByRole('button', { name: /Choose your photo/i })).toBeVisible();
    await expect(page.getByText(/private Polaroid board/i)).toBeVisible();
    await page.getByRole('button', { name: 'Relaxed & Fun' }).click();
    await page.getByRole('button', { name: 'Light & Airy' }).click();
    await page.getByRole('button', { name: 'Friendly Team' }).click();
    await expect(page.getByRole('button', { name: 'Natural Direction' })).toBeDisabled();
    await page.getByRole('button', { name: 'Relaxed & Fun' }).click();
    await expect(page.getByRole('button', { name: 'Natural Direction' })).toBeEnabled();
    await page.getByRole('button', { name: /Send feedback/i }).click();
    await expect(page.getByRole('alert')).toContainText('rating');
});

for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
    test(`feedback hierarchy stays stable at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/feedback');

        const headline = page.getByRole('heading', { name: 'How was it working with us?' });
        await expect(headline).toBeVisible();
        await expect(headline.locator('span')).toHaveCount(2);
        await expect(headline.locator('span').nth(0)).toHaveText('How was it');
        await expect(headline.locator('span').nth(1)).toHaveText('working with us?');
        await expect(page.getByRole('heading', { name: 'Your experience, in your words.' })).toBeHidden();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

        const nameLabel = page.locator('label[for="feedback-name"]');
        const optional = nameLabel.locator('xpath=following-sibling::span');
        const [labelBox, optionalBox] = await Promise.all([nameLabel.boundingBox(), optional.boundingBox()]);
        expect(labelBox).not.toBeNull();
        expect(optionalBox).not.toBeNull();
        expect(Math.abs((labelBox?.y ?? 0) - (optionalBox?.y ?? 0))).toBeLessThan(4);
        expect((optionalBox?.x ?? 0) - ((labelBox?.x ?? 0) + (labelBox?.width ?? 0))).toBeLessThan(12);

        const vibeLabel = page.getByText('What matched your vibe?', { exact: true });
        const beforeReaction = await vibeLabel.boundingBox();
        await page.getByRole('radio', { name: /4 stars, Great!/i }).click();
        await expect(page.getByText('Great!', { exact: true })).toBeVisible();
        await expect(page.getByText('✨', { exact: true })).toBeVisible();
        const afterReaction = await vibeLabel.boundingBox();
        expect(Math.abs((beforeReaction?.y ?? 0) - (afterReaction?.y ?? 0))).toBeLessThan(2);

        await page.getByRole('button', { name: 'Natural Direction' }).click();
        await expect(page.getByRole('button', { name: 'Natural Direction' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { name: /Send feedback/i })).toBeVisible();
    });
}

test('public feedback rate limit rejects the sixth request', async ({ request }) => {
    const testIp = `198.51.100.${Math.floor(Math.random() * 100) + 1}`;
    const payload = { rating: 0 };

    for (let attempt = 1; attempt <= 5; attempt += 1) {
        const response = await request.post('/api/public/feedback', { data: payload, headers: { 'x-forwarded-for': testIp } });
        expect(response.status()).toBe(400);
    }

    const limitedResponse = await request.post('/api/public/feedback', { data: payload, headers: { 'x-forwarded-for': testIp } });
    expect(limitedResponse.status()).toBe(429);
    expect(limitedResponse.headers()['retry-after']).toBeTruthy();
});

test('public feedback endpoint parses multipart before storage', async ({ request }) => {
    const testIp = `203.0.113.${Math.floor(Math.random() * 100) + 1}`;
    const response = await request.post('/api/public/feedback', {
        headers: { 'x-forwarded-for': testIp },
        multipart: {
            clientName: 'Multipart Smoke',
            rating: '5',
            tags: JSON.stringify(['Friendly Team']),
            note: 'This request must stop before storage.',
            photo: {
                name: 'oversized.jpg',
                mimeType: 'image/jpeg',
                buffer: Buffer.alloc(1_500_001),
            },
        },
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Photo must be 1.5 MB or smaller.' });
});

test('admin can receive wedding feedback and review it in the drawer', async ({ page }) => {
    test.skip(!email || !password || !allowFeedbackWrite, 'Set E2E_EMAIL, E2E_PASSWORD, and E2E_FEEDBACK_WRITE=1 to run the write flow.');

    const marker = `E2E Couple ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`;
    await page.goto('/feedback');
    await page.getByLabel('Your names').fill(marker);
    await page.getByRole('radio', { name: /5 stars, Absolutely amazing/i }).click();
    await page.getByRole('button', { name: 'Relaxed & Fun' }).click();
    await page.getByLabel("Anything else you'd like to share?").fill('The whole session felt effortless.');
    await page.getByLabel('Choose a photo from your day').setInputFiles({
        name: 'rings.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#c7a85b"/></svg>'),
    });
    await expect(page.getByAltText('Selected memory preview')).toBeVisible();
    await page.getByRole('button', { name: /Send feedback/i }).click();
    await expect(page.getByRole('heading', { name: 'Thank you for sharing.' })).toBeVisible();

    await login(page);
    await page.goto('/feedback-inbox');
    await expect(page.getByRole('heading', { name: 'Feedback Inbox' })).toBeVisible();
    await page.getByLabel('Search feedback').fill(marker);
    const row = page.getByRole('button', { name: `Open feedback for ${marker}` }).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByRole('dialog', { name: marker })).toBeVisible();
    await expect(page.getByText('Relaxed & Fun', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('The whole session felt effortless.')).toBeVisible();
    await expect(page.getByAltText(`Photo shared by ${marker}`)).toBeVisible();
    await page.getByRole('button', { name: 'Mark reviewed' }).click();
    await expect(page.getByRole('dialog', { name: marker })).toHaveCount(0);
});
