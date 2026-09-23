# Marketing Implementation Status

Last Updated: 2026-09-22

## Architecture Version

v2 — TanStack Start

This file supersedes the earlier custom Bun + `react-dom/server` prerender plan.

## Current Sprint

Sprint 3 - Marketing Pages

## Current Gate

G3 - Marketing Feature Complete

## Current Task

MKT-306 - Wedding Photographer Jakarta

## Completed

- MKT-205 - Optimize Marketing Media
- MKT-301 - Global Marketing Layout
- MKT-302 - Hero Showreel
- MKT-303 - Bento Portfolio Grid
- MKT-304 - Portfolio Lightbox
- MKT-305 - Reusable Service/Location Template

- MKT-101 — Initialize TanStack Start Marketing Workspace
- MKT-102 — Configure TanStack Start + Rsbuild + React + Tailwind
- MKT-103 — Add Root Workspace Scripts
- MKT-104 — Separate Environment Configuration
- MKT-105 — Define Portfolio Media Delivery Strategy
- MKT-201 — Centralize LANDING_CONFIG
- MKT-202 — Implement TanStack Start File-Based Marketing Routes
- MKT-203 — Implement Typed File-Based Content Layer
- MKT-204 — Curate Production Portfolio Media

## In Progress

None.

## Blocked

None.

## Next Recommended Task

MKT-306 - Wedding Photographer Jakarta.

## Current Architecture Decisions

- Bun remains runtime/package/workspace tooling.
- TypeScript remains the language.
- Existing client remains React + Rsbuild/Rspack + Tailwind + its existing TanStack ecosystem.
- Marketing uses React + TanStack Start + TanStack Router + Rsbuild/Rspack + Tailwind.
- Marketing uses TanStack Start built-in static prerendering.
- Do not build a custom `react-dom/server` SSG.
- TanStack Router file-based routes are the canonical marketing route source.
- Use TanStack route `head` for SEO metadata and structured data.
- Prefer TanStack Start built-in sitemap generation.
- Avoid Static Server Functions for phase 1.
- Avoid React Server Components for phase 1.
- Hono remains the existing backend/API framework.
- Supabase remains part of the existing data layer.
- Turso remains part of the existing data layer.
- Do not change Supabase/Turso responsibilities during this project.
- Marketing content is file-based in phase 1.
- Marketing should not directly access Supabase/Turso in phase 1.
- Root marketing deployment target is Cloudflare Pages.
- Existing app/API stays on Fly.io.
- `theorbitphoto.com` = marketing.
- `app.theorbitphoto.com` = existing app/API.
- Keep app auth cookies host-only unless cross-subdomain auth becomes necessary.
- Do not add marketing origin to CORS unless marketing calls Hono API.
- Existing app is noindex.
- MKT-304 lightbox is optional for launch.
- MKT-602 remains the production cutover/convergence milestone.
- Sprint 1 implementation order for solo development is: MKT-201 → MKT-202 → MKT-203 → MKT-105.
- MKT-105 selected a hybrid media strategy: Cloudflare Pages static assets for
  optimized phase-1 images and OG/schema images, with hero/showreel video kept
  out of the repository and lazy-loaded from an external video host or future
  R2/Cloudinary setup only if justified.
- MKT-204 curated approved real The Orbit Photo production media from the
  shared marketing Drive structure into `marketing/public/media/hero`,
  `marketing/public/media/portfolio`, `marketing/public/media/services`, and
  `marketing/public/media/og`. Typed content now maps the curated hero,
  portfolio, service, OG/schema, and video-poster still assets. The 108 MB
  showreel MP4 remains out of Git per the MKT-105 media strategy. The Drive
  `04-og` folder was empty, so the current real OG image is copied from the
  approved hero set until MKT-205 created a dedicated optimized derivative.
- MKT-305 added a reusable data-driven service/location template for the four
  initial service routes. The template resolves service, location, portfolio,
  package, FAQ, testimonial, and curated media data from the typed content layer
  and keeps the phase-1 pages compatible with later route `head` and schema
  work.

## Important Implementation Note

Do not assume the Cloudflare Pages publish directory before MKT-601.

TanStack Start + Rsbuild may produce multiple build outputs. MKT-601 must inspect the actual generated output and publish the directory containing the prerendered HTML and browser assets.

## Known Risks

- TanStack Start is still pre-v1/RC; avoid experimental features.
- Existing app may use TanStack packages differently from marketing; inspect before sharing abstractions.
- Route-level browser-only code can break prerendering.
- Build output assumptions can break Cloudflare deployment.
- Existing hard-coded root-domain URLs may exist.
- Session/CORS assumptions may depend on current domain.
- Large photo/video assets can hurt LCP.
- Duplicate route metadata systems can drift; use route-native head.
- Supabase/Turso responsibilities must not be guessed.

## Latest Validation

2026-09-22:

```bash
bun --cwd marketing typecheck
bun --cwd marketing build
```

Passed.

Local SSR smoke checks passed for:

- `/wedding-photographer-jakarta`
- `/prewedding-bali`
- `/wedding-videographer-jakarta`

Global validation still has unrelated blockers outside MKT-305:

- `bun --cwd client build` fails in
  `client/src/features/culling/client-gallery/Modals.tsx` because of a syntax
  error around line 150.
- `bun run typecheck` fails before reaching marketing because `routes/payments.ts`
  passes `string | undefined` where `DiscountRule[] | undefined` is expected.

## Baseline Validation

After marketing workspace is initialized:

```bash
bun --cwd marketing build
bun --cwd client build
bun run typecheck
```

Later:

```bash
bun --cwd marketing check:seo
```

## Gate Checklist

### G1

- [x] MKT-101
- [x] MKT-102
- [x] MKT-103
- [x] MKT-104
- [x] MKT-105
- [x] MKT-201
- [x] MKT-202
- [x] MKT-203

### G2

- [x] MKT-204
- [x] MKT-205
- [x] MKT-301
- [x] MKT-302
- [x] MKT-303
- [x] MKT-305

### G3

- [ ] MKT-306
- [ ] MKT-307
- [ ] MKT-308
- [ ] MKT-309
- [ ] MKT-310
- [ ] MKT-311
- [ ] MKT-312
- [x] MKT-304 optional

### G4

- [ ] MKT-401
- [ ] MKT-402
- [ ] MKT-403
- [ ] MKT-404
- [ ] MKT-405
- [ ] MKT-406
- [ ] MKT-407
- [ ] MKT-408

### G5

- [ ] MKT-501
- [ ] MKT-502
- [ ] MKT-503
- [ ] MKT-504
- [ ] MKT-505
- [ ] MKT-506
- [ ] MKT-507

### G6

- [ ] MKT-601
- [ ] MKT-602
- [ ] MKT-603
- [ ] MKT-604
- [ ] MKT-605
- [ ] MKT-606
- [ ] MKT-607
- [ ] MKT-608

### G7

- [ ] MKT-609

## Codex Prompt - Current Ticket

```text
Read AGENTS.md, docs/marketing/PRD.md,
docs/marketing/PLAN.md, docs/marketing/STATUS.md,
and docs/marketing/WORKFLOW.md.

We are implementing MKT-306.

Before modifying code:
1. inspect the current repository state,
2. verify MKT-305 is complete,
3. inspect the reusable service/location template,
4. inspect wedding photography content, media, package, FAQ, and testimonial data,
5. identify the smallest set of files that need to change.

Then implement MKT-306 only.

MKT-306 scope:
- complete the Wedding Photographer Jakarta route content,
- use relevant real curated images,
- keep the CTA working,
- add FAQ where applicable,
- avoid placeholders.

Do not start MKT-307 or later tickets.
Do not modify Hono, Supabase, or Turso.
Do not refactor unrelated code.

After implementation:
- run relevant validation,
- inspect the diff for unrelated changes,
- report changed files,
- report validation results,
- update STATUS.md,
- mark MKT-306 completed,
- set MKT-307 as the next recommended task,
- stop.
```

## Codex Prompt — Large Ticket

For MKT-401:

```text
Read AGENTS.md, PRD.md, PLAN.md, STATUS.md and WORKFLOW.md.

Analyze MKT-401 first.
Do not modify code yet.

Inspect the installed TanStack Start version and its Rsbuild integration.

Return:
- exact current build architecture,
- exact Rsbuild/TanStack Start configuration approach,
- expected prerender output paths,
- files to change,
- SSR/hydration risks,
- Cloudflare static deployment implications,
- validation plan.

Do not propose a custom react-dom/server SSG unless the official TanStack Start
prerender functionality cannot satisfy a documented requirement.
```
