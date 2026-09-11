# The Orbit Photo Marketing Site PRD

Version: 2.0 — TanStack Start Architecture  
Date: 2026-09-10  
Status: Approved for implementation

## 1. Summary

Split The Orbit Photo public marketing website from the existing application while preserving the existing technology stack.

Production:

```text
https://theorbitphoto.com
→ Cloudflare Pages
→ marketing/

https://app.theorbitphoto.com
→ Fly.io
→ existing client + Hono API
```

The marketing workspace will use TanStack Start rather than a custom prerender engine.

## 2. Existing Stack

### Runtime / Language
- Bun
- TypeScript

### Existing Frontend
- React
- Rsbuild / Rspack
- Tailwind CSS
- TanStack ecosystem already present in the application

### Existing Backend / Data
- Hono
- Supabase
- Turso

### Infrastructure
- Fly.io

## 3. Marketing Stack

Use:

- Bun
- TypeScript
- React
- TanStack Start
- TanStack Router
- Rsbuild / Rspack
- Tailwind CSS
- Cloudflare Pages for phase-1 static hosting

The marketing application should use TanStack Start's built-in static prerendering instead of a custom `react-dom/server` SSG layer.

## 4. Why TanStack Start

The initial website is mostly static, but the architecture should leave room for:
- dynamic portfolio routes
- CMS-backed content
- route loaders
- lead generation
- richer data fetching
- future SSR
- future server-side marketing logic
- future Cloudflare runtime deployment

Using TanStack Start now avoids creating and maintaining a custom routing/prerender framework.

## 5. Feature Maturity Policy

Use stable/core Start capabilities:
- Router
- file-based routing
- route loaders
- route head management
- SSR
- static prerendering
- sitemap support

Avoid experimental capabilities unless explicitly approved:
- Static Server Functions
- React Server Components
- other experimental extensions

## 6. Non-Goals

Phase 1 does not include:
- Next.js
- Astro
- replacing Hono
- database migration
- removing Supabase
- removing Turso
- CMS implementation
- moving existing app business logic into TanStack Start
- direct marketing database access
- broad existing-app rewrite

## 7. Target Monorepo

```text
/
├── client/                 # existing app
├── server/                 # Hono API
├── marketing/              # TanStack Start marketing app
├── AGENTS.md
└── docs/
    └── marketing/
        ├── PRD.md
        ├── PLAN.md
        ├── STATUS.md
        └── WORKFLOW.md
```

## 8. Marketing Routing

Use TanStack Router file-based routes as the canonical route source.

Initial routes:

```text
/
 /wedding-photographer-jakarta/
 /prewedding-bali/
 /sangjit-photography-jakarta/
 /wedding-videographer-jakarta/
 /portfolio/
 /packages/
```

Do not implement a second custom routing system.

## 9. Marketing Content

Phase 1 remains file-based.

Typed content:
- services
- locations
- portfolio stories
- packages
- FAQs
- testimonials
- reusable SEO content

Future data migration should be possible without rewriting page components.

## 10. LANDING_CONFIG

Centralize real business configuration:
- business name
- marketing URL
- app URL
- telephone
- WhatsApp
- email
- address
- social URLs
- OG defaults
- schema defaults

## 11. Design

Direction:
- premium photographer/videographer
- cinematic
- editorial
- image-forward
- Skipper.UI-inspired bento composition
- minimal typography
- responsive
- accessible

Use real The Orbit Photo portfolio assets.

## 12. Static Prerender

Configure TanStack Start via the official Rsbuild plugin.

Desired behavior:
- prerender enabled
- static paths discovered automatically where appropriate
- links crawled where appropriate
- subfolder index output for clean routes
- build fails on prerender failure

All initial marketing pages must exist as rendered HTML at build time.

## 13. SEO

Use route-native `head` definitions or shared helpers consumed by route `head`.

Each route:
- unique title
- description
- canonical
- Open Graph
- Twitter card
- real image
- structured data where appropriate

Structured data:
- home → `PhotographyBusiness`
- service/location → `Service`
- visible FAQ → `FAQPage`
- non-home → `BreadcrumbList`

## 14. Sitemap

Prefer TanStack Start built-in sitemap generation.

Host:

```text
https://theorbitphoto.com
```

Only public marketing pages should appear.

## 15. robots.txt

Marketing robots:
- allow public pages
- reference production sitemap

App robots:
- block internal app crawling

## 16. Existing App Migration

Existing app/API remains on Fly.io.

Canonical app domain:

```text
https://app.theorbitphoto.com
```

Routes include:
- `/login`
- `/feedback`
- `/culling/:galleryId`
- existing admin/invoice/internal flows

Legacy root paths should 301 to app subdomain equivalents.

## 17. Backend and Data Boundary

Existing backend:

```text
Bun
+ TypeScript
+ Hono
+ Supabase
+ Turso
```

Do not change Supabase/Turso responsibilities during this project.

Marketing phase 1 does not require direct database access.

Future business-domain integrations should normally call the existing Hono API rather than creating duplicate domain logic.

## 18. Auth/CORS

CORS:
- allow app production origin where necessary
- only allow root marketing origin if marketing calls the API

Cookies:
- prefer app-host-only session cookies
- do not broaden to `.theorbitphoto.com` without requirement

## 19. Media

Real portfolio images/video only.

Select Pages/R2/Cloudinary/hybrid according to media delivery analysis.

Optimize:
- LCP
- CLS
- responsive images
- below-fold lazy loading
- hero video behavior
- poster image
- asset weight

## 20. Deployment

Phase 1:
- TanStack Start build
- static prerendered marketing output
- Cloudflare Pages

The final Cloudflare Pages output directory must be determined from the real TanStack Start + Rsbuild build output, not assumed before implementation.

If future marketing requires runtime SSR/server functions, migration to a Cloudflare server runtime should be possible without replacing route/page architecture.

## 21. Quality Gates

Required:
- marketing build passes
- existing client build passes
- typecheck passes
- prerender routes exist
- route metadata is correct
- structured data is correct
- sitemap is correct
- robots is correct
- no broken media
- no encoding corruption
- CTA links work
- app regression passes
- legacy redirects work

## 22. Release Definition

Release requires both streams to pass:

Marketing:
- UI complete
- TanStack Start prerender complete
- SEO complete
- Cloudflare deploy complete

Application:
- app subdomain complete
- auth/API regression complete
- app noindex complete

Both streams converge at root-domain cutover.
