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

## Fly.io deployment

The repository includes a multi-stage [Dockerfile](/Dockerfile) and
[fly.toml](/fly.toml). The Fly machine serves both the Rsbuild SPA and the
Bun/Hono API from one origin, with `/healthz` configured as its health check.

Before the first deploy, install `flyctl`, change `app` in `fly.toml` to a
unique Fly app name, then run:

```powershell
fly auth login
fly apps create invoice-web-v2
fly volumes create invoice_data --region sin --size 1
fly secrets set `
  JWT_SECRET="<at-least-32-random-characters>" `
  SEED_SUPERADMIN_PASSWORD="<strong-password>" `
  SEED_ADMIN_PASSWORD="<strong-password>" `
  SEED_EMPLOYEE_PASSWORD="<strong-password>"
fly deploy
# Run once after the first deploy on an empty volume
fly ssh console -C "bun run scripts/init-db.ts"
```

For batch secret setup, copy `fly.secrets.env.example` to the ignored
`fly.secrets.env`, replace the placeholders locally, then run:

```powershell
Get-Content fly.secrets.env | fly secrets import -a invoice-web-v2
```

The file is ignored by Git and must never be committed.

The volume is required because the current Hono server still uses Bun's
SQLite driver for its runtime database and stores private proof files on disk.
Those paths are mounted under `/data` and are not committed to Git.

### Supabase status

The old Streamlit deployment can use Supabase, but this React + Hono server is
currently SQLite-backed (`bun:sqlite`). Setting a Supabase URL alone would not
switch the application database. A real Supabase deployment requires a schema
and route migration from SQLite to Postgres; do that before removing the Fly
volume. Do not paste the Supabase database password into source or commit it;
set it with `fly secrets set` after the Postgres adapter is migrated.

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
