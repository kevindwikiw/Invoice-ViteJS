# Invoice Web V2

Invoice workspace application with a React + Rsbuild frontend and a Bun + Hono API.

## Local development

Create the server environment file and set a private JWT secret (at least 32 characters):

```powershell
Copy-Item server/.env.example server/.env
```

Run the API and frontend in separate terminals:

```powershell
# Install both workspaces from the repository root
bun install

# terminal 1
bun run dev:server

# terminal 2
bun run dev:client
```

Open `http://localhost:5174`.

For a fresh local database, set the three `SEED_*_PASSWORD` values in
`server/.env` before running `bun run scripts/init-db.ts` from `server/`.
Credentials are intentionally not stored in source code or documentation.

## Fly.io deployment

The repository includes a multi-stage [Dockerfile](/Dockerfile) and
[fly.toml](/fly.toml). The Fly machine serves both the Rsbuild SPA and the
Bun/Hono API from one origin, with `/healthz` configured as its health check.

Before the first deploy, install `flyctl`, change `app` in `fly.toml` to a
unique Fly app name, then run:

```powershell
fly auth login
fly apps create invoice-web-v2
fly secrets set `
  JWT_SECRET="<at-least-32-random-characters>" `
  DATABASE_DRIVER="postgres" `
  SUPABASE_DB_URL="<supabase-session-pooler-connection-string>"
fly deploy
```

For batch secret setup, copy `fly.secrets.env.example` to the ignored
`fly.secrets.env`, replace the placeholders locally, then run:

```powershell
Get-Content fly.secrets.env | fly secrets import -a invoice-web-v2
```

The file is ignored by Git and must never be committed.

The production database is the existing Supabase Postgres project. The API
does not create or alter Postgres tables at startup. Before setting
`DATABASE_DRIVER=postgres`, open the Supabase SQL editor and run
[`server/db/migrations/001_initial_schema.sql`](/server/db/migrations/001_initial_schema.sql)
once. Then seed the initial accounts from a machine with the same Postgres
connection string:

```powershell
cd server
$env:DATABASE_DRIVER = "postgres"
$env:SUPABASE_DB_URL = "<supabase-session-pooler-connection-string>"
$env:SEED_SUPERADMIN_PASSWORD = "<strong-password>"
$env:SEED_ADMIN_PASSWORD = "<strong-password>"
$env:SEED_EMPLOYEE_PASSWORD = "<strong-password>"
bun run scripts/seed-users.ts
```

The connection string is a database credential, not the Supabase publishable
or secret API key. Keep it in Fly secrets. Supabase's session pooler is the
recommended connection for a long-running Fly machine.

SQLite remains available for local development when no Postgres URL is set.
`scripts/init-db.ts` is intentionally SQLite-only and refuses to run in
Postgres mode, so production cannot silently create a second database.

Payment proofs are stored as base64 data URLs in the Supabase
`invoices.payment_proofs` column, matching the original Python adapter. No Fly
volume is required. Uploads are limited to 5 MB per file; keep an eye on
database size if many large proofs are retained.

### Database modes

The Hono API selects its database at startup:

- `DATABASE_DRIVER=postgres` (or a `DATABASE_URL`/`SUPABASE_DB_URL`) uses the
  existing Supabase Postgres database.
- Without a Postgres URL it uses Bun SQLite, which is useful only for local
  development and tests.

This is an adapter switch, not a second schema. Both modes expose the same API
routes; the Postgres schema is the checked-in one-time migration above.

## Production frontend

```powershell
bun run build
bun --cwd client preview
```

Deploy `client/dist` to a static host with SPA fallback to `index.html`. The host
must reverse proxy `/api` to the Hono server on the same public origin. Proof
data is returned only from authenticated invoice API responses.

## Checks

```powershell
bun run typecheck
bun run lint
```

Smoke tests require temporary test credentials supplied through `E2E_EMAIL` and
`E2E_PASSWORD`; never commit those values.
