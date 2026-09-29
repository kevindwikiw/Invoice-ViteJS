# Culling Startup Check

## Changes (2026-09-29)

- Serve the existing Fraunces, Inter and JetBrains Mono fonts locally as WOFF2,
  retaining language subsets and OFL licenses. Rsbuild fingerprints font files;
  the existing `/static/` cache policy applies without changing private photo caching.
- Give only the first thumbnail high fetch priority; preserve eager loading for
  the first ten tiles and lazy loading for the rest. The first image has no opacity
  reveal delay. Other tiles retain their existing fade.
- Declare image dimensions, give the notification container a named region role,
  and include the visible Instagram handle in its accessible name.
- No API, Drive fetch, compression, authentication or database changes.

## Controlled Measurements

Three fresh Chromium contexts per configuration, 390 x 844 viewport, disabled
browser cache, 4x CPU slowdown. API and 54 thumbnail responses are synthetic and
identical across runs. Tutorial is marked seen to measure gallery startup, not
the deliberate four-second intro. Network speed is not throttled.

Values are medians with [min, max], in milliseconds:

| Configuration | FCP | LCP | Long-task blocking during observation |
| --- | ---: | ---: | ---: |
| Dev, before | 2400 [2200, 5160] | 4696 [4268, 7356] | 2061 [1965, 2134] |
| Production, before | 1452 [1336, 3868] | 3192 [2776, 5656] | 566 [465, 673] |
| Production, after | 1104 [1076, 1204] | 3024 [2908, 3328] | 645 [561, 654] |

Decoded JS bytes: dev 2,290,097; production before 439,552; production after
439,709. This large dev/production difference is bundling behavior, **not** a
reduction produced by this patch. External Google font requests changed from
one observed request to zero; high-priority thumbnails changed from ten to one.

FCP improved in this sample; LCP improved slightly with overlapping ranges.
Blocking did not improve and its median increased. External font service timing
and initial server warm-up were not controlled, so these results do not establish
a production speed guarantee. The long-task measure is collected for three
seconds after navigation and is **not Lighthouse's TBT calculation**. These are
not Lighthouse scores, actual Google Drive timings, or real-device measurements.

## Repeat

Build with `bun --cwd client build` and run `bun --cwd client preview` (default
port 4173). In another PowerShell terminal, from `client/`:

```powershell
$env:PLAYWRIGHT_EXTERNAL_SERVERS = '1'
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:4173'
$env:CULLING_PERF = 'production'
bunx playwright test tests/smoke/culling-performance.spec.ts --project=chromium --repeat-each=3
```

The opt-in test logs only aggregate measurements and attaches `startup.json`.
It uses test credentials, no customer tokens or real gallery photos. Unset
`CULLING_PERF` to skip the probe in ordinary smoke runs.

For a real Lighthouse comparison, use a production build and a clean browser
profile, preserving the same gallery, authorization, tutorial state and cache
conditions. Run three times and compare medians. Do not commit raw reports:
gallery resource URLs can contain access tokens.

Further work needs a real production trace: thumbnail download latency and
compression, main-thread hotspots, and server response timing. Do not extend the
intro timer to hide slow loading or make private image caches public.
