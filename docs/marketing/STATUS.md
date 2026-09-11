# Marketing Implementation Status

Last Updated: 2026-09-10

## Architecture Version

v2 — TanStack Start

This file supersedes the earlier custom Bun + `react-dom/server` prerender plan.

## Current Sprint

Sprint 1 — Foundation & Architecture

## Current Gate

G1 — Architecture Ready

## Current Task

MKT-202 — Implement TanStack Start File-Based Marketing Routes

## Completed

- MKT-101 — Initialize TanStack Start Marketing Workspace
- MKT-102 — Configure TanStack Start + Rsbuild + React + Tailwind
- MKT-103 — Add Root Workspace Scripts
- MKT-104 — Separate Environment Configuration
- MKT-201 — Centralize LANDING_CONFIG

## In Progress

None.

## Blocked

None.

## Next Recommended Task

MKT-202 — Implement TanStack Start File-Based Marketing Routes

## Deferred / Planned Spike

- MKT-105 — Define Portfolio Media Delivery Strategy
  - Type: Spike
  - Execute after MKT-203 and before MKT-204.
  - This ticket is not part of the G1 critical path.
  - Its output should define the production media-delivery approach before portfolio assets are curated and optimized in Sprint 2.

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
- MKT-105 is a media-strategy spike and should be completed after the G1 architecture work, but before MKT-204 starts.

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
- [x] MKT-201
- [ ] MKT-202
- [ ] MKT-203

### G2

- [ ] MKT-204
- [ ] MKT-205
- [ ] MKT-301
- [ ] MKT-302
- [ ] MKT-303
- [ ] MKT-305

### G3

- [ ] MKT-306
- [ ] MKT-307
- [ ] MKT-308
- [ ] MKT-309
- [ ] MKT-310
- [ ] MKT-311
- [ ] MKT-312
- [ ] MKT-304 optional

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

## Codex Prompt — Current Ticket

```text
Read AGENTS.md, docs/marketing/PRD.md,
docs/marketing/PLAN.md, docs/marketing/STATUS.md,
and docs/marketing/WORKFLOW.md.

We are implementing MKT-201.

Before modifying code:
1. inspect the current repository state,
2. verify MKT-101 through MKT-104 are complete,
3. inspect any existing business/landing configuration already present,
4. identify all duplicated business metadata currently used by the app or landing-related code,
5. identify the smallest set of files that need to change.

Then implement MKT-201 only.

MKT-201 scope:
- centralize marketing business configuration in LANDING_CONFIG,
- include production marketing URL and app URL,
- support business contact information,
- support social information,
- support OG/schema defaults,
- preserve existing client/server behavior.

Do not start MKT-202 or later tickets.
Do not modify Hono, Supabase, or Turso.
Do not introduce placeholder production business data if real values are not available.
Do not refactor unrelated code.

After implementation:
- run relevant validation,
- inspect the diff for unrelated changes,
- report changed files,
- report validation results,
- update STATUS.md,
- mark MKT-201 completed,
- set MKT-202 as the next recommended task,
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
