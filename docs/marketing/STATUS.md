# Marketing Implementation Status

Last Updated: 2026-10-29

## Application Maintenance

- 2026-10-29: Fixed Event Calendar booking details on phones. Calendar days are keyboard/touch buttons; tapping a date shows an inline detail panel inside its month card instead of a centered hover tooltip that could leave the viewport. Desktop hover retains a tooltip, while the shared detail content wraps long client and venue names. Chromium checks at 320px and 390px, client typecheck, and build passed. No backend or stored invoice data changed.
- 2026-10-29: Clarified mobile Client Galleries cards by grouping Photo Selection and Edited Photos into equal sections, each with its own status, metrics, and actions. The gallery title no longer carries an unlabeled status. Focused Chromium checks for Events and Wedding at 320px/390px, client typecheck, and build passed. The unrelated detail-modal Republish assertion remains a known failure from the previous gallery suite run.
- 2026-10-29: Made Client Galleries responsive on phones with readable gallery cards for Selection Events and Wedding, full-width mobile actions, larger touch targets, and pagination that fits 320px. Desktop retains its table; only one layout renders at a time so gallery controls and accessible names are not duplicated. Chromium checks at 320px and 390px passed without horizontal overflow; client typecheck and build passed. The gallery browser suite had 22/23 passes: an existing detail-modal "Republish failed" assertion still fails when run alone and is outside this list-layout change. Focused lint reports four existing errors in ClientGalleries.tsx outside the changed lines.
- 2026-10-29: Added stored tariff city to invoice history venue rows and a Kota Acara refine dropdown for Bandung/Jakarta. The city filter runs in the paginated invoice API, so counts and pages match the selected city. Older invoices without `pricingCity` remain visible under Semua Kota. Invoice route tests, workspace typecheck, and client build passed. No database migration is needed.
- 2026-10-29: Restored legacy package listing when the Supabase `package_prices` migration has not run. Package API returns existing `packages` rows with empty tariff arrays only when the price table is missing; other query failures still surface as errors. The package manager now shows a retryable load error instead of a false empty collection. Package route tests, workspace typecheck, and client build passed. Production migration `004_package_prices.sql` remains required for 2027+ tariff editing.
- 2026-10-29: Centered the invoice catalog's incomplete-pricing action and shortened its copy to “Tentukan Tanggal & Kota”; removed the trailing chevron so the icon and label align as one centered group. Applied the same wording in the full catalog. Focused Chromium scenario, client typecheck, lint, and build passed.
- 2026-10-29: Simplified missing package prices to “Harga belum diisi” with a muted label and a direct “Isi harga” action for package managers. A focused price dialog now saves a single 2026 base price or a city/year tariff through permission-checked `PATCH /packages/:id/price`, then adds the package to the current invoice without navigating away or losing its draft. The endpoint upserts one tariff without replacing other prices. Checked light-theme sidebar/dialog screenshots. Focused package/invoice tests, six Chromium pricing scenarios, client/server typechecks, focused lint, and client build passed. No production deployment or tariff data entry was performed.
- 2026-10-29: Replaced repeated missing-date/city pricing copy in invoice catalog cards with one compact action above the sidebar search and one action in the full catalog header. The action focuses the missing date or city control; package cards stay readable while selection is unavailable. Checked a light-theme sidebar screenshot. Focused package tests, five Chromium pricing scenarios, client typecheck, focused lint, and client build passed.
- 2026-10-29: Redesigned the package editor pricing section as one cohesive surface: the editable 2026 base price is prominent, city rates are grouped by year without a spreadsheet header, and the year control stays compact. Scoped CSS prevents global input styling from creating nested boxes. Checked dark and light pricing screenshots; five Chromium pricing scenarios, client typecheck, focused lint, and client build passed. No pricing behavior or persistence change.
- 2026-10-29: Condensed the package price editor: 2026 price is now an inline currency field, year controls sit beside the 2027+ heading, and the empty tariff table is hidden until a year is added. Improved focus indicators on the price inputs and year actions. Five pricing browser scenarios, client typecheck, focused lint, and client build passed.
- 2026-10-29: Revised package pricing: the existing `packages.price` is now the editable common 2026 price for every city. City/year tariff rows apply from 2027 onward; missing tariffs remain disabled with a specific city/year message and a permission-aware link to Packages. Changing city within 2026 keeps selected packages, while changing year or a later-year city requires reselection. Pre-existing 2026 city tariff rows are retained on package save but ignored for price resolution. Historical invoice item prices remain snapshots. Focused package/invoice tests, five Chromium pricing scenarios, client typecheck, and client build passed. No database migration or production data change was performed for this revision.
- 2026-10-29: Added package tariffs by event year and tariff city (Bandung/Jakarta) to the existing client/Hono invoice workflow. One catalog package now owns multiple prices; existing package price remains a historical reference. The package editor can add and remove tariff years, removing all city prices for a deleted year on save. The invoice form keeps nine overview fields by placing a city picker and separate free-text venue input inside one Location / Venue control; the city side has a minimum width so its name remains readable. City sets package prices and stays off the PDF; venue is shown on the PDF. Invoice items retain their selected price snapshot. Changing city or event year prompts the user to reselect catalog packages. Invoice city options now come from cities present in package tariffs rather than a fixed city list, and package price lookup accepts those configured cities.
- Deployment prerequisite: apply `server/db/migrations/004_package_prices.sql` to the existing Supabase Postgres database before deploying the server. Existing package prices supply 2026; admins must enter 2027 city tariffs before those combinations can be selected. SQLite creates the new table on startup when the packages table exists.
- Validation: focused package, invoice, and catalog tests plus three Chromium scenarios for invoice pricing and the tariff editor passed; client build and workspace typecheck passed. Whole-client lint still reports existing errors in unrelated files; lint on the changed client source files passed. No production migration, tariff entry, or deployment was performed.

- 2026-10-16: Separated Edited Photos folder ZIP jobs into `archive_worker:app` with its own Ubuntu service, virtualenv, service user, environment, and listener at `127.0.0.1:8089`. Selfie remains on `8088` and no longer registers ZIP routes. Hono uses independent `FACE_ARCHIVE_WORKER_*` settings; HTTPS proxy routes archive requests to ZIP and browser downloads avoid Fly.
- Validation for this change: 43 Python tests and two Hono lifecycle/configuration scenarios passed, including real Uvicorn process stop/restart isolation, ZIP ticket/expiry/limits, missing archive configuration, and no ML imports in ZIP. Server/client typechecks and client production build passed. Ubuntu systemd, live HTTPS proxy, Google Drive, and Fly deployment were not exercised; installation/configuration instructions are in the worker README.
- 2026-10-14: Implemented Selfie search for Edited Photos and Wedding. Selection and Edited indexes have independent source scopes, versioned snapshots, callback validation, and delivery-token access. Publish/Sync prepares Edited indexes in the background; Unpublish removes only Edited indexes. Client search covers all folders with per-photo downloads and retains the previous folder/page when returning to Edited.
- Validation for this change: 34 focused backend tests and 45 distinct Chromium scenarios passed, including legacy schema upgrades, index/token isolation, PIN and Selection regressions, expiry, retry, concurrent Sync during search, browser history, and 320px/390px/desktop light/dark screenshots. Client/server typechecks and client production build passed. Drive/worker integration used mocks; no production deployment or live Turso migration was performed.
- 2026-10-06: Added immutable Prewedding selection/delivery and Wedding delivery-only workflows to the existing client/Hono application. Existing galleries retain selection behavior; Wedding uses the existing Edited password, Drive folder tree, and download flow.
- This maintenance does not advance a marketing ticket or change the marketing architecture. No deployment was performed.
- Validation: 41 server tests, 74 focused Chromium tests, client/server typechecks, and client production build pass. Browser coverage includes 320px, 390px, and desktop; legacy Selfie and removed Publish/Unpublish button scenarios remain outside this focused run. Live Drive-folder integration still needs a manual smoke test.

## Architecture Version

v2 — TanStack Start

This file supersedes the earlier custom Bun + `react-dom/server` prerender plan.

## Current Sprint

Sprint 3 - Marketing Pages

## Current Gate

G3 - Marketing Feature Complete

## Current Task

MKT-307 - Prewedding Bali (next; not started)

## Completed

- MKT-306 - Wedding Photographer Jakarta
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

MKT-307 - Prewedding Bali.

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
- MKT-306 completed the Jakarta wedding photography content using the existing
  template, curated real hero and portfolio images, wedding package copy, and
  five visible FAQs. Inquiry CTAs retain the configured business email and
  service-specific subject; WhatsApp remains unset in `LANDING_CONFIG`.
  Pricing and delivery timing are agreed through a proposal, with no invented
  prices, turnaround guarantees, or testimonials. The shared template now uses
  public-facing section labels and its mobile heading scales to fit 320px.

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

2026-10-20 / 2026-10-21 (MKT-306):

```bash
bun --cwd marketing build
bun --cwd client build
bun run typecheck
```

Passed. Marketing build was repeated after the mobile CSS adjustment.

Local SSR and Chromium smoke checks passed for
`/wedding-photographer-jakarta` at 320px, 390px, 1024px, and 1440px:

- Meaningful wedding content and FAQ are present in the HTML response.
- One H1, two related stories, five FAQs, and no visible seed/placeholder copy.
- Hero and portfolio images load with nonempty alt text.
- Both inquiry links use the business email and wedding photography subject.
- Desktop/mobile navigation and browser back restore the wedding page.
- No browser errors, hydration mismatch messages, or horizontal overflow.
- Initial 12px overflow at 320px was fixed by scaling the mobile heading.

Changed files:

- `marketing/src/content/services.ts`
- `marketing/src/content/faqs.ts`
- `marketing/src/content/packages.ts`
- `marketing/src/content/portfolio.ts`
- `marketing/src/components/ServiceLocationTemplate.tsx`
- `marketing/src/styles.css`
- `docs/marketing/STATUS.md`

The client build and payments typecheck blockers recorded on 2026-09-22 no
longer reproduce. Browser checks used the existing local development server;
opening a real email client or sending an inquiry was not tested. Prerender,
route SEO/schema, sitemap, robots, and deployment remain in their planned
tickets. No production deployment was performed.

Homepage visual iteration (2026-10-21):

- The initial frame-only interpretation was superseded by the template-faithful
  composition documented below. The mobile portfolio width fix from that pass
  remains necessary to prevent horizontal overflow.

Homepage template adaptation (2026-10-21):

- Reworked the homepage hero to follow the boxed template composition: white
  70px top and 50px side/bottom desktop bands, dark navigation in the top
  band, compact uppercase navigation, a gray portfolio/search affordance and
  black EN label at the right, vertical Discover More and inquiry controls over
  the side bands, and compact brand credits in the bottom band. Mobile uses
  10px bands and keeps the two controls as tappable buttons above the credit.
- Kept the existing Orbit hero photograph, copy, TanStack navigation, and
  portfolio. The template YouTube demo, newsletter modal, and legacy scripts
  are not included. The frame and controls render only on `/`.
- Marketing build and typecheck passed. Chromium checks passed at 320px, 390px,
  1024px, and 1440px: the image loaded, the frame passes pointer input, routes
  remove/restore the frame, reduced motion disables animation, and there are no
  browser errors or horizontal overflow.
- Changed files for this adaptation: `marketing/src/components/MarketingHero.tsx`,
  `marketing/src/components/MarketingShell.tsx`, `marketing/src/styles.css`,
  and this status file. No production deployment.

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

- [x] MKT-306
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

We are implementing MKT-307.

Before modifying code:
1. inspect the current repository state,
2. verify MKT-305 is complete,
3. inspect the reusable service/location template,
4. inspect Bali prewedding content, media, package, FAQ, and testimonial data,
5. identify the smallest set of files that need to change.

Then implement MKT-307 only.

MKT-307 scope:
- complete the Prewedding Bali route content,
- use relevant real curated images,
- keep the CTA working,
- add FAQ where applicable,
- avoid placeholders.

Do not start MKT-308 or later tickets.
Do not modify Hono, Supabase, or Turso.
Do not refactor unrelated code.

After implementation:
- run relevant validation,
- inspect the diff for unrelated changes,
- report changed files,
- report validation results,
- update STATUS.md,
- mark MKT-307 completed,
- set MKT-308 as the next recommended task,
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
