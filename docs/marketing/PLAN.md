# Marketing Implementation Plan

Version: 2.0 — TanStack Start  
Date: 2026-09-10

## Planning Conventions

Story points: `1, 2, 3, 5, 8, 13`

Roles:
- FE — Frontend
- BE — Backend
- FS — Full-stack
- DEVOPS — DevOps/Cloud
- DESIGN — UI/UX
- CONTENT — Content/SEO
- QA — QA
- TL — Tech Lead

Dependency syntax:

```text
SOURCE blocks TARGET
```

---

# Release Gates

## G1 — Architecture Ready
Required:
- MKT-101
- MKT-102
- MKT-103
- MKT-104
- MKT-201
- MKT-202
- MKT-203

## G2 — UI Foundation Ready
Required:
- MKT-204
- MKT-205
- MKT-301
- MKT-302
- MKT-303
- MKT-305

## G3 — Marketing Feature Complete
Required:
- MKT-306
- MKT-307
- MKT-308
- MKT-309
- MKT-310
- MKT-311
- MKT-312

Optional:
- MKT-304

## G4 — TanStack SSG / SEO Ready
Required:
- MKT-401
- MKT-402
- MKT-403
- MKT-404
- MKT-405
- MKT-406
- MKT-407
- MKT-408

## G5 — App Migration Ready
Required:
- MKT-501
- MKT-502
- MKT-503
- MKT-504
- MKT-505
- MKT-506
- MKT-507

## G6 — Production Release
Required:
- MKT-601
- MKT-602
- MKT-603
- MKT-604
- MKT-605
- MKT-608

Release QA:
- MKT-606
- MKT-607

## G7 — Performance Sign-Off
Required:
- MKT-609

---

# Sprint 1 — Foundation & Architecture

## MKT-101 — Initialize TanStack Start Marketing Workspace
Priority: Highest  
SP: 5  
Assignee: FS / TL  
Critical: Yes  
Gate: G1

Description:
Create `marketing/` as a Bun workspace prepared for a React + TanStack Start + Rsbuild application.

Acceptance Criteria:
- [ ] `marketing/` exists
- [ ] root Bun workspace includes it
- [ ] TanStack Start dependencies are scoped to marketing
- [ ] existing client/server remain intact
- [ ] no Next.js/Astro introduced
- [ ] `bun install` succeeds

Blocks:
- MKT-102
- MKT-103
- MKT-104
- MKT-105
- MKT-201

---

## MKT-102 — Configure TanStack Start + Rsbuild + React + Tailwind
Priority: Highest  
SP: 5  
Assignee: FE / TL  
Critical: Yes  
Gate: G1

Dependencies:
- MKT-101

Acceptance Criteria:
- [ ] official TanStack Start Rsbuild plugin configured
- [ ] React works
- [ ] TanStack Router works
- [ ] Tailwind works
- [ ] TypeScript works
- [ ] marketing dev server works
- [ ] production build works
- [ ] no custom router added

Blocks:
- MKT-103
- MKT-202
- MKT-301
- MKT-401

---

## MKT-103 — Add Root Workspace Scripts
Priority: High  
SP: 2  
Assignee: FS  
Critical: No  
Gate: G1

Dependencies:
- MKT-101
- MKT-102

Acceptance Criteria:
- [ ] marketing dev script
- [ ] marketing build script
- [ ] client build script
- [ ] root typecheck
- [ ] current workflows preserved

---

## MKT-104 — Separate Environment Configuration
Priority: High  
SP: 3  
Assignee: FS / DEVOPS  
Critical: No  
Gate: G1

Dependencies:
- MKT-101

Acceptance Criteria:
- [ ] marketing public env isolated
- [ ] app/server env isolated
- [ ] no secrets leak into browser marketing bundle
- [ ] local setup documented
- [ ] production setup documented

---

## MKT-105 — Define Portfolio Media Delivery Strategy
Priority: Medium  
SP: 3  
Assignee: TL / DEVOPS  
Critical: No  
Gate: G1

Dependencies:
- MKT-101

Acceptance Criteria:
- [ ] image volume assessed
- [ ] video/showreel volume assessed
- [ ] Pages vs R2 vs Cloudinary vs hybrid evaluated
- [ ] repository-size impact documented
- [ ] decision recorded

Blocks:
- MKT-204
- MKT-205

---

## MKT-201 — Centralize LANDING_CONFIG
Priority: Highest  
SP: 2  
Assignee: FS  
Critical: Yes  
Gate: G1

Dependencies:
- MKT-101

Acceptance Criteria:
- [ ] business configuration centralized
- [ ] marketing/app URLs configurable
- [ ] contact information configurable
- [ ] social information configurable
- [ ] OG/schema defaults configurable
- [ ] placeholder values removable from one location

Blocks:
- MKT-203
- MKT-403
- MKT-404

---

## MKT-202 — Implement TanStack Start File-Based Marketing Routes
Priority: Highest  
SP: 5  
Assignee: FE / TL  
Critical: Yes  
Gate: G1

Dependencies:
- MKT-102

Description:
Create the initial TanStack Router file-route structure. The router tree is the canonical routing source.

Acceptance Criteria:
- [ ] root route exists
- [ ] homepage route exists
- [ ] wedding photographer Jakarta route exists
- [ ] prewedding Bali route exists
- [ ] Sangjit Jakarta route exists
- [ ] wedding videographer Jakarta route exists
- [ ] portfolio route exists
- [ ] packages route exists
- [ ] generated route tree is valid
- [ ] navigation uses TanStack Router
- [ ] no parallel custom routing engine exists

Blocks:
- MKT-203
- MKT-305
- MKT-401
- MKT-403
- MKT-405

---

## MKT-203 — Implement Typed File-Based Content Layer
Priority: High  
SP: 5  
Assignee: FE  
Critical: Yes  
Gate: G1

Dependencies:
- MKT-201
- MKT-202

Acceptance Criteria:
- [ ] services typed
- [ ] locations typed
- [ ] portfolio stories typed
- [ ] packages typed
- [ ] FAQ typed
- [ ] testimonials typed
- [ ] routes can import the correct content without duplicating path logic

Blocks:
- MKT-305
- MKT-310
- MKT-311
- MKT-404

---

# Sprint 2 — Core UI & Media

## MKT-204 — Curate Production Portfolio Media
Priority: High  
SP: 5  
Assignee: DESIGN / CONTENT  
Critical: No  
Gate: G2

Dependencies:
- MKT-105

Acceptance Criteria:
- [ ] real hero assets
- [ ] real bento assets
- [ ] service assets
- [ ] real OG images
- [ ] real schema images
- [ ] no Unsplash production assets

Blocks:
- MKT-205
- MKT-302
- MKT-303

---

## MKT-205 — Optimize Marketing Media
Priority: High  
SP: 5  
Assignee: FE / DESIGN  
Critical: No  
Gate: G2

Dependencies:
- MKT-105
- MKT-204

Acceptance Criteria:
- [ ] appropriate dimensions
- [ ] correct aspect ratios
- [ ] LCP-aware hero loading
- [ ] below-fold lazy loading
- [ ] sensible video loading
- [ ] poster/fallback optimized

Blocks:
- MKT-607
- MKT-609

---

## MKT-301 — Build Global Marketing Layout
Priority: Highest  
SP: 5  
Assignee: FE  
Critical: Yes  
Gate: G2

Dependencies:
- MKT-102
- MKT-202

Acceptance Criteria:
- [ ] root layout
- [ ] header/nav
- [ ] mobile nav
- [ ] footer
- [ ] typography system
- [ ] CTA primitives
- [ ] internal navigation uses TanStack Link where appropriate

Blocks:
- MKT-302
- MKT-303
- MKT-305
- MKT-311

---

## MKT-302 — Build Hero Showreel
Priority: High  
SP: 8  
Assignee: FE / DESIGN  
Critical: No  
Gate: G2

Dependencies:
- MKT-204
- MKT-301

Acceptance Criteria:
- [ ] real showreel
- [ ] headline
- [ ] copy
- [ ] CTA
- [ ] poster fallback
- [ ] mobile behavior
- [ ] autoplay failure-safe
- [ ] controlled CLS

Blocks:
- MKT-312

---

## MKT-303 — Build Bento Portfolio Grid
Priority: High  
SP: 8  
Assignee: FE / DESIGN  
Critical: No  
Gate: G2

Dependencies:
- MKT-204
- MKT-301

Acceptance Criteria:
- [ ] asymmetric layout
- [ ] responsive layout
- [ ] real portfolio media
- [ ] accessible interaction
- [ ] reusable gallery component

Blocks:
- MKT-304
- MKT-310
- MKT-312

---

## MKT-305 — Build Reusable Service/Location Template
Priority: Highest  
SP: 8  
Assignee: FE  
Critical: Yes  
Gate: G2

Dependencies:
- MKT-202
- MKT-203
- MKT-301

Acceptance Criteria:
- [ ] service data driven
- [ ] location data driven
- [ ] portfolio slot
- [ ] testimonial slot
- [ ] FAQ slot
- [ ] CTA
- [ ] semantic headings
- [ ] compatible with route-level head/schema

Blocks:
- MKT-306
- MKT-307
- MKT-308
- MKT-309
- MKT-312
- MKT-401

---

# Sprint 3 — Marketing Pages

## MKT-304 — Implement Portfolio Lightbox
Priority: Medium  
SP: 5  
Assignee: FE  
Critical: No  
Gate: Optional

Dependencies:
- MKT-303

Acceptance Criteria:
- [ ] fullscreen viewer
- [ ] close works
- [ ] Escape works
- [ ] navigation works
- [ ] focus behavior accessible
- [ ] mobile usable

---

## MKT-306 — Wedding Photographer Jakarta
Priority: High  
SP: 3  
Assignee: FE / CONTENT  
Critical: Yes  
Gate: G3

Dependencies:
- MKT-305

Acceptance Criteria:
- [ ] production route content
- [ ] relevant images
- [ ] working CTA
- [ ] FAQ where applicable
- [ ] no placeholders

Blocks:
- MKT-312
- MKT-401

---

## MKT-307 — Prewedding Bali
Priority: High  
SP: 3  
Assignee: FE / CONTENT  
Critical: Yes  
Gate: G3

Dependencies:
- MKT-305

Acceptance Criteria:
- [ ] production route content
- [ ] relevant images
- [ ] working CTA
- [ ] FAQ where applicable
- [ ] no placeholders

Blocks:
- MKT-312
- MKT-401

---

## MKT-308 — Sangjit Photography Jakarta
Priority: High  
SP: 3  
Assignee: FE / CONTENT  
Critical: Yes  
Gate: G3

Dependencies:
- MKT-305

Acceptance Criteria:
- [ ] production route content
- [ ] relevant images
- [ ] working CTA
- [ ] FAQ where applicable
- [ ] no placeholders

Blocks:
- MKT-312
- MKT-401

---

## MKT-309 — Wedding Videographer Jakarta
Priority: High  
SP: 3  
Assignee: FE / CONTENT  
Critical: Yes  
Gate: G3

Dependencies:
- MKT-305

Acceptance Criteria:
- [ ] production route content
- [ ] relevant media
- [ ] working CTA
- [ ] FAQ where applicable
- [ ] no placeholders

Blocks:
- MKT-312
- MKT-401

---

## MKT-310 — Portfolio Page
Priority: High  
SP: 5  
Assignee: FE / DESIGN  
Critical: Yes  
Gate: G3

Dependencies:
- MKT-203
- MKT-303

Acceptance Criteria:
- [ ] portfolio route complete
- [ ] data-driven stories
- [ ] real media
- [ ] internal TanStack links
- [ ] responsive

Blocks:
- MKT-312
- MKT-401

---

## MKT-311 — Packages Page
Priority: High  
SP: 5  
Assignee: FE / CONTENT  
Critical: Yes  
Gate: G3

Dependencies:
- MKT-203
- MKT-301

Acceptance Criteria:
- [ ] package route complete
- [ ] data-driven packages
- [ ] readable inclusions
- [ ] CTA works
- [ ] no internal functionality exposed

Blocks:
- MKT-312
- MKT-401

---

## MKT-312 — Accessibility & Responsive QA
Priority: High  
SP: 5  
Assignee: FE / QA  
Critical: High  
Gate: G3

Dependencies:
- MKT-302
- MKT-303
- MKT-305
- MKT-306
- MKT-307
- MKT-308
- MKT-309
- MKT-310
- MKT-311

Acceptance Criteria:
- [ ] mobile widths work
- [ ] desktop widths work
- [ ] keyboard interactions work
- [ ] alt text meaningful
- [ ] heading hierarchy logical
- [ ] visible focus
- [ ] no horizontal overflow

Blocks:
- MKT-606

---

# Sprint 4 — TanStack Start SSG & SEO

## MKT-401 — Configure TanStack Start Static Prerendering
Priority: Highest  
SP: 5  
Assignee: FS / TL  
Critical: Yes  
Gate: G4

Dependencies:
- MKT-102
- MKT-202
- MKT-305
- MKT-306
- MKT-307
- MKT-308
- MKT-309
- MKT-310
- MKT-311

Description:
Use TanStack Start's official Rsbuild prerender configuration. Do not implement a custom SSG engine.

Acceptance Criteria:
- [ ] prerender enabled in TanStack Start
- [ ] clean subfolder index output enabled where appropriate
- [ ] static paths discovered/crawled appropriately
- [ ] required seven routes are generated
- [ ] build fails on prerender errors
- [ ] meaningful page HTML exists before client JS
- [ ] no custom `react-dom/server` SSG script exists unless explicitly justified

Blocks:
- MKT-402
- MKT-403
- MKT-404
- MKT-405
- MKT-408
- MKT-601

---

## MKT-402 — Validate TanStack SSR/Hydration Boundaries
Priority: Highest  
SP: 3  
Assignee: FE / FS  
Critical: Yes  
Gate: G4

Dependencies:
- MKT-401

Acceptance Criteria:
- [ ] prerendered HTML hydrates correctly
- [ ] no material hydration mismatches
- [ ] nav works after hydration
- [ ] lightbox works if included
- [ ] no browser-only code breaks build-time rendering
- [ ] page content exists before JS

Blocks:
- MKT-407

---

## MKT-403 — Implement Route-Native SEO Head Metadata
Priority: Highest  
SP: 5  
Assignee: FE / CONTENT  
Critical: Yes  
Gate: G4

Dependencies:
- MKT-201
- MKT-202
- MKT-401

Acceptance Criteria:
- [ ] TanStack route `head` used
- [ ] unique titles
- [ ] descriptions
- [ ] self canonicals
- [ ] OG metadata
- [ ] Twitter metadata
- [ ] real image URLs
- [ ] no duplicate head injection system

Blocks:
- MKT-407
- MKT-605

---

## MKT-404 — Implement Route Structured Data
Priority: High  
SP: 5  
Assignee: FS / CONTENT  
Critical: Yes  
Gate: G4

Dependencies:
- MKT-201
- MKT-203
- MKT-401

Acceptance Criteria:
- [ ] homepage PhotographyBusiness
- [ ] Service schema on relevant routes
- [ ] FAQPage only when FAQ is visible
- [ ] BreadcrumbList on non-home routes
- [ ] real LANDING_CONFIG values
- [ ] real portfolio images
- [ ] structured data emitted through the route/document head system

Blocks:
- MKT-407
- MKT-605

---

## MKT-405 — Configure TanStack Start Sitemap Generation
Priority: Highest  
SP: 2  
Assignee: FS  
Critical: Yes  
Gate: G4

Dependencies:
- MKT-202
- MKT-401

Description:
Prefer TanStack Start's built-in sitemap generation tied to prerender/link discovery.

Acceptance Criteria:
- [ ] sitemap generation enabled
- [ ] host is `https://theorbitphoto.com`
- [ ] all public marketing pages included
- [ ] app/private routes excluded
- [ ] no separate manually maintained sitemap route list unless necessary

Blocks:
- MKT-406
- MKT-407
- MKT-601
- MKT-605

---

## MKT-406 — Add Marketing robots.txt
Priority: High  
SP: 1  
Assignee: FS  
Critical: No  
Gate: G4

Dependencies:
- MKT-405

Acceptance Criteria:
- [ ] public marketing crawling allowed
- [ ] production sitemap referenced
- [ ] app routes not mistakenly declared as marketing pages

Blocks:
- MKT-605

---

## MKT-407 — Add SEO / Static Output Validation
Priority: High  
SP: 5  
Assignee: FS / QA  
Critical: Yes  
Gate: G4

Dependencies:
- MKT-402
- MKT-403
- MKT-404
- MKT-405

Acceptance Criteria:
- [ ] all public routes validated
- [ ] static HTML presence validated
- [ ] title validated
- [ ] description validated
- [ ] canonical validated
- [ ] OG image validated
- [ ] structured data validated when required
- [ ] sitemap validated
- [ ] encoding artifacts detected
- [ ] stock placeholder URLs rejected
- [ ] CI-capable

Blocks:
- MKT-601
- MKT-604
- MKT-605

---

## MKT-408 — Configure Static 404 Behavior
Priority: High  
SP: 3  
Assignee: FS / DEVOPS  
Critical: No  
Gate: G4

Dependencies:
- MKT-401

Acceptance Criteria:
- [ ] invalid URL is not homepage HTTP 200
- [ ] no generic SPA catch-all
- [ ] custom 404 supported if desired
- [ ] valid clean routes continue working

Blocks:
- MKT-605

---

# Sprint 5 — App Subdomain Migration

## MKT-501 — Configure Fly App Subdomain
Priority: Highest  
SP: 5  
Assignee: DEVOPS / BE  
Critical: Yes  
Gate: G5

Dependencies:
- None

Acceptance Criteria:
- [ ] app domain resolves
- [ ] TLS valid
- [ ] app works
- [ ] Hono API works

Blocks:
- MKT-502
- MKT-503
- MKT-504
- MKT-505
- MKT-506
- MKT-602

---

## MKT-502 — Update App/Public URLs
Priority: Highest  
SP: 5  
Assignee: FS  
Critical: Yes  
Gate: G5

Dependencies:
- MKT-501

Acceptance Criteria:
- [ ] login links updated
- [ ] feedback links updated
- [ ] culling links updated
- [ ] callbacks updated where needed
- [ ] generated links updated

Blocks:
- MKT-504
- MKT-507

---

## MKT-503 — Update Hono CORS
Priority: High  
SP: 3  
Assignee: BE  
Critical: Yes  
Gate: G5

Dependencies:
- MKT-501

Acceptance Criteria:
- [ ] app production origin allowed where needed
- [ ] local origins preserved
- [ ] marketing origin excluded unless needed
- [ ] credentials correct
- [ ] unsupported origins rejected

Blocks:
- MKT-507

---

## MKT-504 — Review Auth Cookie Scope
Priority: High  
SP: 5  
Assignee: BE / TL  
Critical: Yes  
Gate: G5

Dependencies:
- MKT-501
- MKT-502

Acceptance Criteria:
- [ ] auth works
- [ ] persistence works
- [ ] host-only cookie preferred
- [ ] Secure correct
- [ ] HttpOnly correct where applicable
- [ ] SameSite correct
- [ ] marketing does not receive app cookie unnecessarily

Blocks:
- MKT-507

---

## MKT-505 — Add App-Wide Noindex
Priority: Highest  
SP: 3  
Assignee: BE / FE  
Critical: Yes  
Gate: G5

Dependencies:
- MKT-501

Acceptance Criteria:
- [ ] noindex on app HTML
- [ ] login covered
- [ ] feedback covered
- [ ] culling covered
- [ ] admin/internal covered
- [ ] marketing unaffected

Blocks:
- MKT-507

---

## MKT-506 — Add App robots.txt
Priority: High  
SP: 1  
Assignee: BE  
Critical: No  
Gate: G5

Dependencies:
- MKT-501

Acceptance Criteria:
- [ ] app robots exists
- [ ] crawling blocked
- [ ] no marketing sitemap hosted there

Blocks:
- MKT-507

---

## MKT-507 — Regression Test App on New Domain
Priority: Highest  
SP: 8  
Assignee: QA / FS  
Critical: Yes  
Gate: G5

Dependencies:
- MKT-502
- MKT-503
- MKT-504
- MKT-505
- MKT-506

Acceptance Criteria:
- [ ] login
- [ ] auth persistence
- [ ] API
- [ ] invoice/admin
- [ ] feedback
- [ ] culling
- [ ] shared gallery links
- [ ] no critical CORS errors

Blocks:
- MKT-602
- MKT-604

---

# Sprint 6 — Cloudflare Release & QA

## MKT-601 — Deploy Prerendered TanStack Marketing to Cloudflare Pages
Priority: Highest  
SP: 5  
Assignee: DEVOPS / FS  
Critical: Yes  
Gate: G6

Dependencies:
- MKT-401
- MKT-405
- MKT-407

Description:
Inspect actual TanStack Start + Rsbuild output, identify the directory containing prerendered HTML/browser assets, and configure Cloudflare Pages to publish that static output.

Acceptance Criteria:
- [ ] actual build output inspected
- [ ] static publish directory identified from real output
- [ ] Pages build command documented
- [ ] correct output directory configured
- [ ] all prerendered routes accessible on preview deployment
- [ ] no unnecessary server runtime required for phase 1

Blocks:
- MKT-602
- MKT-604

---

## MKT-602 — Configure Root Marketing Domain
Priority: Highest  
SP: 3  
Assignee: DEVOPS  
Critical: Yes — convergence point  
Gate: G6

Dependencies:
- MKT-501
- MKT-507
- MKT-601

Acceptance Criteria:
- [ ] root domain serves marketing
- [ ] TLS valid
- [ ] public routes resolve
- [ ] app subdomain stays functional

Blocks:
- MKT-603
- MKT-605
- MKT-606
- MKT-607
- MKT-608
- MKT-609

---

## MKT-603 — Add Legacy App Redirects
Priority: Highest  
SP: 3  
Assignee: DEVOPS / FS  
Critical: Yes  
Gate: G6

Dependencies:
- MKT-602

Acceptance Criteria:
- [ ] /login redirect
- [ ] /feedback redirect
- [ ] /culling/* redirect
- [ ] paths preserved
- [ ] permanent status
- [ ] no loop

Blocks:
- MKT-608

---

## MKT-604 — Validate Production Builds
Priority: Highest  
SP: 3  
Assignee: QA / FS  
Critical: Yes  
Gate: G6

Dependencies:
- MKT-407
- MKT-507
- MKT-601

Acceptance Criteria:
- [ ] marketing build passes
- [ ] client build passes
- [ ] server build if applicable passes
- [ ] typecheck passes
- [ ] SEO validation passes

Blocks:
- RELEASE

---

## MKT-605 — Production SEO Validation
Priority: Highest  
SP: 5  
Assignee: QA / CONTENT  
Critical: Yes  
Gate: G6

Dependencies:
- MKT-403
- MKT-404
- MKT-405
- MKT-406
- MKT-407
- MKT-408
- MKT-602

Acceptance Criteria:
- [ ] static HTML confirmed
- [ ] titles correct
- [ ] descriptions correct
- [ ] canonicals correct
- [ ] OG images resolve
- [ ] JSON-LD correct
- [ ] sitemap accessible
- [ ] robots accessible
- [ ] internal app routes absent

Blocks:
- RELEASE

---

## MKT-606 — Desktop/Mobile Visual QA
Priority: High  
SP: 5  
Assignee: QA / DESIGN  
Critical: No  
Gate: G6

Dependencies:
- MKT-312
- MKT-602

Acceptance Criteria:
- [ ] homepage desktop
- [ ] homepage mobile
- [ ] service page desktop
- [ ] service page mobile
- [ ] nav works
- [ ] bento works
- [ ] hero works
- [ ] package layout works

---

## MKT-607 — Media & Encoding QA
Priority: High  
SP: 3  
Assignee: QA / FE  
Critical: No  
Gate: G6

Dependencies:
- MKT-205
- MKT-602

Acceptance Criteria:
- [ ] no broken media
- [ ] no stretching
- [ ] no unexpected asset 404
- [ ] no mojibake
- [ ] OG media resolves

---

## MKT-608 — CTA & Redirect QA
Priority: Highest  
SP: 3  
Assignee: QA  
Critical: Yes  
Gate: G6

Dependencies:
- MKT-602
- MKT-603

Acceptance Criteria:
- [ ] WhatsApp works
- [ ] portfolio links work
- [ ] package CTA works
- [ ] login redirect works
- [ ] feedback redirect works
- [ ] culling redirect tested
- [ ] no redirect loop

Blocks:
- RELEASE

---

## MKT-609 — Production Performance QA
Priority: High  
SP: 5  
Assignee: FE / QA  
Critical: No unless severe issue  
Gate: G7

Dependencies:
- MKT-205
- MKT-602

Acceptance Criteria:
- [ ] LCP identified
- [ ] CLS reviewed
- [ ] hero media reviewed
- [ ] below-fold behavior reviewed
- [ ] JS payload reviewed
- [ ] oversized assets corrected

---

# Exact Jira Dependency Links

```text
MKT-101 blocks MKT-102
MKT-101 blocks MKT-103
MKT-101 blocks MKT-104
MKT-101 blocks MKT-105
MKT-101 blocks MKT-201

MKT-102 blocks MKT-103
MKT-102 blocks MKT-202
MKT-102 blocks MKT-301
MKT-102 blocks MKT-401

MKT-105 blocks MKT-204
MKT-105 blocks MKT-205

MKT-201 blocks MKT-203
MKT-201 blocks MKT-403
MKT-201 blocks MKT-404

MKT-202 blocks MKT-203
MKT-202 blocks MKT-305
MKT-202 blocks MKT-401
MKT-202 blocks MKT-403
MKT-202 blocks MKT-405

MKT-203 blocks MKT-305
MKT-203 blocks MKT-310
MKT-203 blocks MKT-311
MKT-203 blocks MKT-404

MKT-204 blocks MKT-205
MKT-204 blocks MKT-302
MKT-204 blocks MKT-303

MKT-205 blocks MKT-607
MKT-205 blocks MKT-609

MKT-301 blocks MKT-302
MKT-301 blocks MKT-303
MKT-301 blocks MKT-305
MKT-301 blocks MKT-311

MKT-302 blocks MKT-312
MKT-303 blocks MKT-304
MKT-303 blocks MKT-310
MKT-303 blocks MKT-312

MKT-305 blocks MKT-306
MKT-305 blocks MKT-307
MKT-305 blocks MKT-308
MKT-305 blocks MKT-309
MKT-305 blocks MKT-312
MKT-305 blocks MKT-401

MKT-306 blocks MKT-312
MKT-306 blocks MKT-401
MKT-307 blocks MKT-312
MKT-307 blocks MKT-401
MKT-308 blocks MKT-312
MKT-308 blocks MKT-401
MKT-309 blocks MKT-312
MKT-309 blocks MKT-401
MKT-310 blocks MKT-312
MKT-310 blocks MKT-401
MKT-311 blocks MKT-312
MKT-311 blocks MKT-401

MKT-312 blocks MKT-606

MKT-401 blocks MKT-402
MKT-401 blocks MKT-403
MKT-401 blocks MKT-404
MKT-401 blocks MKT-405
MKT-401 blocks MKT-408
MKT-401 blocks MKT-601

MKT-402 blocks MKT-407
MKT-403 blocks MKT-407
MKT-403 blocks MKT-605
MKT-404 blocks MKT-407
MKT-404 blocks MKT-605
MKT-405 blocks MKT-406
MKT-405 blocks MKT-407
MKT-405 blocks MKT-601
MKT-405 blocks MKT-605
MKT-406 blocks MKT-605
MKT-407 blocks MKT-601
MKT-407 blocks MKT-604
MKT-407 blocks MKT-605
MKT-408 blocks MKT-605

MKT-501 blocks MKT-502
MKT-501 blocks MKT-503
MKT-501 blocks MKT-504
MKT-501 blocks MKT-505
MKT-501 blocks MKT-506
MKT-501 blocks MKT-602

MKT-502 blocks MKT-504
MKT-502 blocks MKT-507
MKT-503 blocks MKT-507
MKT-504 blocks MKT-507
MKT-505 blocks MKT-507
MKT-506 blocks MKT-507

MKT-507 blocks MKT-602
MKT-507 blocks MKT-604

MKT-601 blocks MKT-602
MKT-601 blocks MKT-604

MKT-602 blocks MKT-603
MKT-602 blocks MKT-605
MKT-602 blocks MKT-606
MKT-602 blocks MKT-607
MKT-602 blocks MKT-608
MKT-602 blocks MKT-609

MKT-603 blocks MKT-608
```

# Critical Path

Marketing:

```text
MKT-101
→ MKT-102
→ MKT-202
→ MKT-203
→ MKT-305
→ MKT-306/307/308/309/310/311
→ MKT-401
→ MKT-403/404/405
→ MKT-407
→ MKT-601
```

App:

```text
MKT-501
→ MKT-502/503/504/505/506
→ MKT-507
```

Convergence:

```text
MKT-601 ──┐
          ▼
       MKT-602
          ▲
MKT-507 ──┘
```

Release:

```text
MKT-602
├→ MKT-603 → MKT-608
├→ MKT-605
└→ MKT-604
       ↓
    RELEASE
```
