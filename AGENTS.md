# AGENTS.md

## Project

The Orbit Photo monorepo.

The production architecture is split into:
- `marketing/` → public marketing website
- `client/` → existing internal/customer-facing application
- `server/` → existing Hono API/backend

Production domains:
- Marketing: `https://theorbitphoto.com`
- Existing app/API: `https://app.theorbitphoto.com`

## Existing Technology Stack

### Runtime & Package Management
- Bun

### Language
- TypeScript

### Frontend / Existing App
- React
- Rsbuild / Rspack
- Tailwind CSS
- Existing TanStack ecosystem packages already used by the repository

### Marketing Web Application
- React
- TanStack Start
- TanStack Router
- Rsbuild / Rspack
- Tailwind CSS
- Bun

### Backend / API
- Hono

### Data Layer
- Supabase
- Turso

### Infrastructure
- Fly.io → existing application/API
- Cloudflare Pages → phase-1 static marketing deployment
- Cloudflare Worker is a possible future runtime if marketing later requires dynamic SSR/server behavior

## Architecture Preservation

The marketing split must preserve the existing application architecture.

Do not:
- replace Bun
- replace Rsbuild/Rspack
- replace Hono
- remove existing TanStack dependencies
- replace Supabase
- replace Turso
- consolidate Supabase and Turso
- migrate databases
- introduce Next.js
- introduce Astro
- introduce another full-stack framework
- rewrite the existing app as part of the marketing project

Supabase and Turso are existing parts of the data architecture. Before modifying persistence, auth, storage, or database code, inspect the repository and determine the actual responsibility of each service.

Never infer that Supabase is used for Auth/Storage unless repository code proves it.

## Source of Truth

Before implementing marketing work, read:

1. `AGENTS.md`
2. `docs/marketing/PRD.md`
3. `docs/marketing/PLAN.md`
4. `docs/marketing/STATUS.md`

Interpretation:
- `AGENTS.md` = permanent engineering constraints
- `PRD.md` = target product/architecture
- `PLAN.md` = implementation tickets and dependencies
- `STATUS.md` = current progress and decisions

Priority on conflict:
1. explicit current user instruction
2. AGENTS.md
3. PRD.md
4. current Jira ticket in PLAN.md
5. STATUS.md

## Scope Discipline

Work ticket-by-ticket.

When implementing a Jira ticket:
1. read the ticket
2. inspect the current repository
3. verify blocking dependencies
4. identify files that need to change
5. implement only the requested ticket and unavoidable prerequisites
6. run applicable validation
7. inspect the diff for unrelated changes
8. update `STATUS.md`
9. stop

Do not automatically implement the next ticket.

Avoid unrelated refactors.

For 5–8 point tickets, analyze architecture and risks before making changes.

## Monorepo Target

```text
/
├── AGENTS.md
├── client/
├── server/
├── marketing/
└── docs/
    └── marketing/
        ├── PRD.md
        ├── PLAN.md
        ├── STATUS.md
        └── WORKFLOW.md
```

## Marketing Framework Rules

`marketing/` must use TanStack Start with TanStack Router and Rsbuild.

Use the official Rsbuild integration:

```text
@tanstack/react-start/plugin/rsbuild
```

TanStack Router file-based routing is the routing source of truth.

Do not create a parallel custom router or manually maintained route engine.

Do not create a custom `react-dom/server` static-site generator unless TanStack Start proves unable to satisfy an explicit requirement.

Use TanStack Start built-in prerendering for phase 1.

Preferred prerender characteristics:
- enabled
- subfolder index output
- automatic static path discovery where appropriate
- link crawling where appropriate
- fail build on prerender error

## TanStack Feature Policy

Allowed / preferred:
- TanStack Start
- TanStack Router
- file-based routes
- route loaders when useful
- route `head` metadata
- built-in SSR behavior
- built-in static prerendering
- built-in sitemap support

Do not use without explicit requirement:
- React Server Components
- Static Server Functions
- other experimental TanStack Start features

Phase 1 should remain mostly static and boring.

## Public Marketing Routes

Initial public routes:

- `/`
- `/wedding-photographer-jakarta/`
- `/prewedding-bali/`
- `/sangjit-photography-jakarta/`
- `/wedding-videographer-jakarta/`
- `/portfolio/`
- `/packages/`

These routes must be public, crawlable, and statically prerendered.

## Route & Metadata Architecture

TanStack file routes are the canonical routing source.

SEO/page metadata should be colocated with route definitions or imported from typed page/content data.

Do not maintain two independent lists of routes unless one is generated from the other.

If a small typed public-page manifest is required for business metadata or QA:
- derive it from the same content source used by routes, or
- keep it narrowly scoped and validated against the router

Avoid route drift.

## Marketing Content

Phase 1 is file-based.

Prefer typed TypeScript data for:
- services
- locations
- portfolio stories
- packages
- FAQs
- testimonials
- reusable SEO content

Do not add a CMS in phase 1.

## LANDING_CONFIG

Use `LANDING_CONFIG` as the single source of truth for business configuration.

Where applicable include:
- business name
- marketing URL
- app URL
- WhatsApp
- telephone
- email
- address
- social URLs
- default OG image
- schema defaults

Do not duplicate business values throughout JSX.

## SEO Rules

Use TanStack route `head` capabilities for:
- title
- meta description
- Open Graph
- Twitter metadata
- canonical
- JSON-LD

Every marketing page requires:
- unique title
- description
- self-referencing canonical
- real OG image
- Twitter card metadata
- appropriate structured data

Structured data:
- homepage → `PhotographyBusiness`
- service/location pages → `Service`
- visible FAQ sections → `FAQPage`
- non-home pages → `BreadcrumbList`

Use real business data from `LANDING_CONFIG`.

Use real portfolio images.

Do not ship Unsplash or unrelated stock imagery for:
- hero
- portfolio
- OG
- schema images

## Sitemap & Robots

Prefer TanStack Start built-in sitemap generation for the public marketing site when compatible with the final static deployment.

Marketing sitemap:
- host = `https://theorbitphoto.com`
- public marketing pages only
- no login
- no feedback
- no culling
- no admin
- no invoice/internal routes
- no redirect-only root app paths

Marketing `robots.txt` should allow public crawling and reference:

```text
https://theorbitphoto.com/sitemap.xml
```

## Existing App Domain

Existing application routes move to:
- `https://app.theorbitphoto.com/login`
- `https://app.theorbitphoto.com/feedback`
- `https://app.theorbitphoto.com/culling/:galleryId`

Legacy root-domain paths permanently redirect to the equivalent app subdomain paths.

## App Indexing

The Fly application is not the marketing SEO surface.

Protect internal app pages with:
- `noindex`
- preferably `nofollow`
- `X-Robots-Tag` where appropriate
- app-specific restrictive `robots.txt`

Cover internal/private routes including:
- login
- feedback
- culling
- admin
- invoice/internal screens

## Backend Boundary

Hono remains the main existing application API/backend.

Supabase and Turso remain behind the existing application/backend architecture according to their current repository responsibilities.

Phase 1 marketing should use file-based content and should not directly access Supabase or Turso unless explicitly required.

If marketing later requires business-domain data, prefer:

```text
TanStack Start marketing
        ↓
      Hono API
        ↓
Supabase / Turso
```

rather than duplicating business logic with direct database access from multiple frontends.

Marketing-specific server functions may be considered later for narrowly scoped functionality, but do not move existing Hono business logic into TanStack Start without an explicit architectural decision.

## CORS

Allow the real application origin where required:

```text
https://app.theorbitphoto.com
```

Do not automatically add:

```text
https://theorbitphoto.com
```

Only allow the marketing origin if marketing actually calls the Hono API.

Use the narrowest safe CORS policy.

## Authentication Cookies

Do not automatically use:

```text
Domain=.theorbitphoto.com
```

Prefer host-only cookies for `app.theorbitphoto.com`.

Only broaden cookie scope when cross-subdomain authentication is explicitly required.

Preserve:
- Secure
- HttpOnly where appropriate
- correct SameSite behavior

## Media

Use real portfolio media.

Optimize:
- dimensions
- aspect ratio
- loading behavior
- responsive images
- LCP asset
- video poster
- video initial loading

A CDN/object-storage decision may use:
- Cloudflare Pages assets
- R2
- Cloudinary
- hybrid

Do not commit unnecessarily large original media files.

## Cloudflare Deployment

Phase 1 marketing target is static output on Cloudflare Pages.

Because TanStack Start + Rsbuild may emit both client and server build artifacts, inspect the actual production build before configuring the Pages output directory.

For static marketing deployment:
- publish the directory containing the prerendered HTML and browser assets
- do not deploy an unnecessary server runtime
- verify every required route resolves as a static HTML page

Do not hard-code an output directory in infrastructure until the actual TanStack Start/Rsbuild build output has been verified in the repository.

Future migration to a Cloudflare server runtime is allowed if dynamic SSR/server behavior becomes a real requirement.

## Design Direction

Marketing visual direction:
- premium
- cinematic
- editorial
- image-first
- asymmetric bento grid
- generous whitespace
- restrained typography
- polished mobile experience

Skipper.UI may be used as visual inspiration, not as source code to copy.

## Validation

Core checks after the marketing workspace exists:

```bash
bun --cwd marketing build
bun --cwd client build
bun run typecheck
```

Where available:

```bash
bun --cwd marketing check:seo
```

For TanStack Start prerender tickets verify:
- required static route files exist
- rendered HTML includes meaningful body content
- route `head` output is present
- no hydration mismatch warnings
- sitemap exists
- robots exists
- invalid route behavior is correct

For app migration verify:
- login
- auth persistence
- API
- feedback
- culling
- shared links
- noindex
- redirects
- no CORS regressions

## Definition of Ticket Complete

A ticket is complete only when:
1. acceptance criteria pass
2. applicable build/type/test checks pass
3. diff is scoped
4. changed files are reported
5. limitations are reported
6. `docs/marketing/STATUS.md` is updated

Stop after completing the requested ticket.
