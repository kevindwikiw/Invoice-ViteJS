# Invoice App Client

React frontend powered by Rsbuild/Rspack. Bun remains the package manager and
script runner, while the API remains on Bun + Hono.

## Development

Start the Hono API in one terminal:

```powershell
cd server
bun run index.ts
```

Start the Rsbuild frontend in a second terminal:

```powershell
cd client
bun install
bun run dev
```

Open `http://localhost:5174`. The Rsbuild dev server proxies `/api` and `/uploads`
to Hono at `http://localhost:3000`.

The dev server is pinned to IPv4 and uses a single listener on port `5174` for
Windows compatibility. Route-level dynamic imports still produce separate chunks.

Set `API_PROXY_TARGET` before `bun run dev` if Hono is available at a different
development URL.

## Production build

```powershell
bun run build
bun run preview
```

The production files are written to `dist/`. `preview` is intended for local
verification of that build.

Deploy `dist/` with a static web server. The public web server must:

- fall back unknown frontend routes to `index.html` for the SPA router;
- reverse proxy `/api` and `/uploads` to the Bun + Hono server.

The frontend deliberately uses same-origin URLs for API calls and uploaded files,
so Hono remains API-only and no production API origin is embedded in the bundle.

## Checks

```powershell
bun run lint
bun run typecheck
```

## Automated smoke test

Install the Chromium test browser once:

```powershell
bun x playwright install chromium
```

Then run the critical workflow suite:

```powershell
bun run test:smoke
```

The suite starts Hono and Rsbuild, signs in, creates a temporary invoice, uploads
a proof, downloads the generated PDF, verifies Invoice Audit Logs, and cleans up
the temporary invoice. Supply a non-production test account without committing
credentials:

```powershell
$env:E2E_EMAIL = 'admin@example.com'
$env:E2E_PASSWORD = 'your-password'
bun run test:smoke
```

The public feedback page and its rate limit are covered without writing rows.
To additionally submit one feedback response and verify the administrator inbox,
explicitly enable the persistent write flow:

```powershell
$env:E2E_FEEDBACK_WRITE = '1'
bun run test:smoke
```
