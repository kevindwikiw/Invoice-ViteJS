# Invoice Web V2

Invoice workspace application with a React + Rsbuild frontend and a Bun + Hono API.

## Local development

Create the server environment file and set a private JWT secret (at least 32 characters):

```powershell
Copy-Item server/.env.example server/.env
```

Run the API and frontend in separate terminals:

```powershell
# terminal 1
cd server
bun install
bun run index.ts

# terminal 2
cd client
bun install
bun run dev
```

Open `http://localhost:5174`.

For a fresh database, set the three `SEED_*_PASSWORD` values in `server/.env`
before running the database initializer. Credentials are intentionally not stored
in source code or documentation.

## Production frontend

```powershell
cd client
bun run build
bun run preview
```

Deploy `client/dist` to a static host with SPA fallback to `index.html`. The host
must reverse proxy `/api` and `/uploads` to the Hono server on the same public
origin. Uploaded proofs are private and must remain behind that API proxy.

## Checks

```powershell
cd client
bun run typecheck
bun run lint
```

Smoke tests require temporary test credentials supplied through `E2E_EMAIL` and
`E2E_PASSWORD`; never commit those values.
