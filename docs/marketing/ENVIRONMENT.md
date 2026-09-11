# Marketing Environment

The `marketing/` workspace has a separate environment boundary from the
existing `client/` and `server/` workspaces.

## Public Marketing Variables

Browser-exposed marketing environment variables must use the `PUBLIC_` prefix.

These values are safe to include in browser JavaScript and must never contain
credentials, tokens, private keys, database secrets, or other sensitive
configuration.

Server-only or build-only marketing secrets must not use the `PUBLIC_` prefix
and must never be exposed through client-side `import.meta.env` usage.

The `PUBLIC_` prefix therefore means:

- safe to expose to the browser
- intended for public runtime/build configuration
- never suitable for secrets

Future marketing features may introduce server-only or build-only environment
variables. Those variables must remain private and should be documented
separately from the public marketing variables.

| Variable | Purpose | Local example |
| --- | --- | --- |
| `PUBLIC_MARKETING_URL` | Canonical public marketing URL | `http://localhost:5180` |
| `PUBLIC_APP_URL` | Public URL of the existing application | `http://localhost:5174` |

The current foundation routes do not consume these variables yet, so the
marketing build does not require a populated environment file. Future
marketing code must read public configuration through `import.meta.env` and
must use the `PUBLIC_` prefix for values exposed to browser code.

## Local Setup

From the repository root:

```powershell
Copy-Item marketing/.env.example marketing/.env
bun run dev:marketing
```

`marketing/.env` is ignored by Git. Use local URLs for local development and
keep the existing backend environment in `server/.env`.

Do not copy variables from `server/.env` into `marketing/.env` unless a value
is explicitly intended to be public and has been reviewed as safe for browser
exposure.

## Production Setup

When the marketing hosting environment is configured, provide only the
`PUBLIC_*` values required by the marketing application:

```text
PUBLIC_MARKETING_URL=https://theorbitphoto.com
PUBLIC_APP_URL=https://app.theorbitphoto.com
```

This documents the required values without configuring Cloudflare or another
deployment platform. Production deployment work belongs to later tickets.

If future marketing functionality requires server-only or build-only secrets,
configure those values only in an appropriate server/build environment. Do not
prefix them with `PUBLIC_`, and do not expose them to browser bundles.

## Existing App and Server Environment

The existing application and API keep their current environment files and
variable names:

- `client/` uses `API_PROXY_TARGET` for the Rsbuild proxy and `E2E_*` values
  for Playwright tests. These are tooling variables, not marketing runtime
  variables.

- `server/.env` contains backend runtime values such as `JWT_SECRET`,
  `DATABASE_URL`/`SUPABASE_DB_URL`, `TURSO_DATABASE_URL`,
  `TURSO_AUTH_TOKEN`, Google service-account credentials, and seed passwords.

- `fly.secrets.env` contains deployment secrets for the existing Fly.io app.

Never copy `server/.env` or `fly.secrets.env` into `marketing/`, and never use
server-only variables in marketing source. In particular, Supabase
service-role keys, database credentials, Turso tokens, JWT secrets, and Google
service-account credentials must remain server-only.

## Environment Safety Rule

Before adding a new marketing environment variable, classify it first:

1. If browser JavaScript needs the value and it is safe to disclose publicly,
   use the `PUBLIC_` prefix.
2. If the value contains credentials or sensitive configuration, keep it
   server-only or build-only and do not expose it through client code.
3. If the value belongs to the existing application or Hono backend, keep it
   in the existing `client/` or `server/` environment boundary instead of
   duplicating it in `marketing/`.
