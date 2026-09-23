# Marketing Media Strategy

Date: 2026-09-11
Status: Accepted for MKT-105

## Summary

Use Cloudflare Pages static assets for phase-1 marketing images and OG/schema
images. Store only optimized production derivatives in the repository, not RAW
files or high-resolution originals.

For hero/showreel video, do not commit the full video to the repository for
phase 1. Use an optimized poster image in Pages and lazy-load the playable
video from an external video platform or, if self-hosting becomes necessary,
evaluate R2 or Cloudinary during implementation.

This keeps the first marketing release simple while leaving a clear path to R2
or Cloudinary when portfolio volume, CMS workflows, or video requirements make
static assets too limiting.

## Current-State Findings

- `marketing/` currently has no committed production image or video asset
  structure.
- `marketing/src/content/portfolio.ts` is intentionally empty until real
  portfolio stories and media are curated.
- Existing client media is limited to small brand/PDF assets:
  - `client/public/logo.png`
  - `client/src/assets/pdf/logo.png`
  - `client/src/assets/pdf/Email.png`
  - `client/src/assets/pdf/Phonecall.png`
  - `client/src/assets/pdf/Location.png`
  - `client/src/assets/pdf/IG.png`
- Local proof uploads exist under `server/uploads/proofs/`, but
  `server/uploads/` is ignored and must not become marketing source media.
- Local database files under `server/db/*.db*` are ignored and unrelated to
  marketing media.
- Repository working source size, excluding `.git`, `node_modules`, `dist`, and
  test output, is about 12 MB.
- No production marketing video files are currently committed.
- No Cloudflare R2, Cloudinary, Supabase Storage, or Turso media integration is
  configured for marketing.

## Current Rsbuild Asset Handling

The marketing app uses Rsbuild with TanStack Start, React, and Tailwind:

```ts
plugins: [pluginReact(), pluginTailwindcss(), tanstackStart()]
```

With the current default Rsbuild behavior:

- imported image/media assets can be emitted into the build output with hashed
  filenames;
- small imported assets may be inlined;
- a workspace-level `public/` directory can be used for files that should be
  copied directly to the production output and referenced by absolute URL paths.

Recommended placement for phase 1:

```text
marketing/public/media/
  hero/
  portfolio/
  services/
  og/
```

Use `public/` for URL-stable files referenced by content and metadata. Use
`src/assets/` only for assets that need bundler imports from React components.

## Options Evaluated

### Option 1: Cloudflare Pages Static Assets

Description:
Commit optimized image derivatives into `marketing/public/media/` and deploy
them with the prerendered TanStack Start output on Cloudflare Pages.

Pros:

- simplest local workflow;
- no new account, bucket, SDK, upload pipeline, secret, or runtime integration;
- works well with static prerendered pages;
- assets are versioned with the content that references them;
- CDN delivery is handled by Cloudflare Pages;
- compatible with route `head`, OG images, schema image URLs, and static HTML.

Cons:

- repository grows as portfolio media grows;
- every media change requires a code commit and deploy;
- no dynamic transformations unless paired with another Cloudflare image
  product or manually generated variants;
- Cloudflare Pages has asset count and per-file size limits;
- not suitable for large videos or high-resolution original archives.

Best fit:

- hero poster images;
- hero stills;
- bento-grid thumbnails;
- curated portfolio images for phase 1;
- service-page images;
- OG images;
- schema images.

Avoid:

- RAW files;
- full-resolution originals;
- long videos;
- large showreel exports;
- hundreds or thousands of portfolio images.

### Option 2: Cloudflare R2

Description:
Store media objects in Cloudflare R2 and reference them from marketing content,
optionally through a custom media hostname.

Pros:

- keeps large media out of the Git repository;
- scales better for a growing portfolio library;
- no egress charges from R2 to the Internet under current R2 pricing;
- good fit for future CMS or upload workflows;
- integrates naturally with Cloudflare-hosted marketing infrastructure.

Cons:

- adds bucket setup, permissions, upload process, and cache invalidation
  decisions;
- R2 is object storage, not a full image transformation product by itself;
- responsive image variants must be pre-generated or paired with Cloudflare
  Images/Transformations;
- video can be served as files, but R2 does not by itself provide a polished
  adaptive streaming workflow;
- more operational work than needed for the current tiny phase-1 asset set.

Best fit:

- larger future portfolio archive;
- downloadable/high-resolution media if ever needed;
- media managed outside the code deploy lifecycle;
- future CMS-backed content.

### Option 3: Cloudinary

Description:
Use Cloudinary as the image/video management and delivery layer.

Pros:

- strong URL-based image transformations;
- responsive image and format optimization workflows;
- good tooling for cropping, quality, and derived assets;
- supports video transformation and delivery use cases;
- easier future CMS/editorial workflows than manual static derivatives.

Cons:

- introduces another vendor and media domain;
- cost model uses credits across storage, transformations, and bandwidth;
- requires account configuration and naming conventions;
- free tier may be enough for early experiments but must be watched as traffic
  and video delivery grow;
- less aligned with a minimal Cloudflare Pages-first deployment than plain
  static assets.

Best fit:

- media-heavy site with frequent asset iteration;
- art-directed responsive crops;
- transformed portfolio galleries;
- video transformation/adaptive delivery needs.

### Option 4: Hybrid

Description:
Use Pages static assets for the first curated marketing image set, and introduce
R2 or Cloudinary only for media classes that outgrow static deployment.

Pros:

- keeps phase 1 simple;
- prevents premature infrastructure work;
- gives clear escape hatch for larger galleries and video;
- allows MKT-204 to curate media immediately;
- lets MKT-205 optimize manually generated variants before adopting a service.

Cons:

- may require a later migration if image volume grows quickly;
- content must allow external media URLs from day one;
- team needs conventions so static and external media do not drift.

Best fit:

- current repository state;
- phase-1 static marketing launch;
- future-proofing without buying complexity too early.

## Recommendation

Choose the hybrid strategy, with Cloudflare Pages static assets as the phase-1
default.

Phase 1:

- Images: optimized derivatives committed under `marketing/public/media/`.
- OG/schema images: static files under `marketing/public/media/og/`.
- Hero/showreel video: use a static poster in Pages and lazy-load the video from
  an external video host. Do not commit the full showreel to the repo.
- Portfolio stories: store media references in typed content as URL strings so
  they can point to either Pages assets now or CDN/object-storage URLs later.

Future scaling:

- Move large portfolio libraries to R2 when repository size or deploy frequency
  becomes painful.
- Add Cloudflare Images/Transformations if dynamic resizing at the Cloudflare
  edge becomes useful.
- Consider Cloudinary if art direction, video transformations, CMS integrations,
  or editorial workflows become more valuable than Cloudflare-only simplicity.

Cloudflare Pages static assets are sufficient for phase 1 because the current
repository has no production marketing media yet, the initial route/content
architecture is static, and the launch can work with a small curated image set.

## Asset Placement Conventions

Use these paths for MKT-204 curated assets:

```text
marketing/public/media/hero/
marketing/public/media/portfolio/
marketing/public/media/services/
marketing/public/media/og/
```

Use stable public URL paths in content:

```text
/media/hero/home-hero-1600.avif
/media/portfolio/story-slug-thumb-800.webp
/media/services/wedding-photographer-jakarta-1200.webp
/media/og/home-og.jpg
```

Do not commit:

- camera RAW files;
- full-resolution source exports;
- private client galleries;
- uncompressed video exports;
- local proof uploads from `server/uploads/`;
- generated test screenshots.

## Image Guidelines

MKT-204 should curate real The Orbit Photo media first. MKT-205 should optimize
the selected files before they land in production routes.

Recommended derivative targets:

- hero/LCP image: AVIF and WebP, around 1600-2400 px wide depending crop;
- mobile hero image: separate crop around 900-1200 px wide;
- bento thumbnails: 600-1200 px wide depending tile size;
- service images: 1200-1800 px wide;
- portfolio detail images: 1600-2400 px wide, only when needed;
- OG images: 1200 x 630 JPG or PNG;
- schema images: reuse real public image URLs already used by the page.

Implementation expectations:

- use width/height or CSS aspect-ratio to prevent CLS;
- use responsive `srcset`/`sizes` or a small image component in MKT-205;
- set eager/high-priority loading only for the LCP image;
- lazy-load below-fold portfolio/service images;
- keep alt text meaningful and content-specific;
- avoid stock or unrelated placeholder imagery in production.

## Video Guidelines

Do not use a large video as the default LCP resource.

Recommended phase-1 pattern:

- render an optimized poster image first;
- lazy-load the video player only after user interaction or when the section is
  close to the viewport;
- prefer an external video platform for the actual showreel until self-hosting
  has a clear product reason;
- if using a short muted background loop, keep it aggressively compressed and
  provide a poster fallback.

If self-hosting later:

- R2 is acceptable for simple MP4/WebM delivery with pre-encoded files;
- Cloudinary is better when transformations, adaptive delivery, or generated
  derivatives matter;
- avoid Pages for large video files because the deploy artifact and per-file
  limits are a poor fit.

## Implications for Upcoming Tickets

MKT-204:

- select a small real production media set;
- place optimized source derivatives under `marketing/public/media/`;
- record media URLs in `marketing/src/content/portfolio.ts` and related content
  files;
- do not migrate to R2 or Cloudinary during curation.

MKT-205:

- create responsive derivative sizes and formats;
- implement the image loading conventions;
- validate file weights, dimensions, aspect ratios, LCP, and CLS;
- keep the code ready for external URLs so a later R2/Cloudinary migration does
  not require rewriting page components.

MKT-301 and later UI tickets:

- consume media through typed content records;
- do not hard-code scattered media URLs in JSX;
- reserve direct component imports for small UI assets only.

## Decision Triggers for Moving Beyond Pages

Revisit R2 or Cloudinary when any of these become true:

- committed marketing media exceeds roughly 100-200 MB;
- a single required asset cannot be kept comfortably below Pages limits;
- portfolio updates need to happen without code deploys;
- there are hundreds of portfolio images;
- dynamic crops/resizes become hard to manage manually;
- CMS integration becomes active;
- video hosting needs adaptive streaming, signed delivery, or analytics.

## References

- Cloudflare Pages limits:
  https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare R2 pricing:
  https://developers.cloudflare.com/r2/pricing/
- Cloudflare Images overview:
  https://developers.cloudflare.com/images/
- Cloudflare Images pricing:
  https://developers.cloudflare.com/images/pricing/
- Cloudinary billing and plans:
  https://cloudinary.com/documentation/billing_and_plans
- Cloudinary video delivery:
  https://cloudinary.com/documentation/video_manipulation_and_delivery
- Rsbuild static assets:
  https://rsbuild.rs/guide/basic/static-assets
