import { defineConfig, devices } from '@playwright/test';

const manageWebServers = process.env.PLAYWRIGHT_EXTERNAL_SERVERS !== '1';

export default defineConfig({
    testDir: './tests/smoke',
    timeout: 90_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    workers: 1,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
    baseURL: 'http://127.0.0.1:5174',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    webServer: manageWebServers ? [
        {
            command: 'bun run --cwd ../server start',
            url: 'http://127.0.0.1:3000',
            reuseExistingServer: true,
            timeout: 30_000,
        },
        {
            command: 'bun run dev',
            url: 'http://127.0.0.1:5174',
            reuseExistingServer: true,
            timeout: 30_000,
        },
    ] : undefined,
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
