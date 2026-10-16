# Orbit Face Worker CPU Audit

Date: 2026-10-16. Baseline: working tree at audit start, including the existing
OpenCV 5 adapter and archive-worker split, not a clean historical commit.
Scope: face worker, shared Drive reader, Hono face routes, gallery storage/source
versioning, deployment scripts, tests and existing benchmark tools.

## Evidence and limits

- Inspected implementation, configuration examples and local runtime. No production
  credentials, database contents or Ubuntu service configuration were read.
- Local runtime: Windows AMD64, 16 logical CPUs, Python 3.13, OpenCV 5.0.0,
  NumPy 2.5.4. OpenCV reports Concurrency threading, IPP, no ONNX Runtime and
  no DNN MLAS in this Windows build. NumPy uses OpenBLAS, a separate thread pool.
- Ubuntu ARM64 2-vCPU/12-GB runtime, actual engine per network, CPU utilization,
  production cache hits, gallery/face distributions and Drive timings:
  **NOT MEASURED**. Local microbenchmarks cannot establish ARM performance.
- No permissioned, identity/bounding-box-labeled wedding evaluation set was
  supplied. Wedding retrieval accuracy is **NOT MEASURED**.

## Call Graph and Existing Behavior

```text
Selection sync / Edited publish or sync / first Selfie request
  galleries.ts -> prepareGalleryFaceIndex / handlePublicFaceSearch
  face-index.ts -> createOrReuseJob (singleflight per gallery + scope)
    -> current source digest + job status (stale after 2 minutes)
    -> dispatchJob reads existing photo revisions, solo flags and embeddings
    -> POST worker /v1/index/jobs (internal bearer, model identity, max 10k photos)
      -> one admitted job by default; 3 bounded photo consumers
        -> unchanged photo: reuse cachedFaces + cachedIsSolo, including zero faces
        -> otherwise DriveSource.fetch -> decode_image
          -> shared inference semaphore -> FaceEngine.get (thread lock)
             -> YuNet -> align every detection -> SFace -> 128-float embedding
          -> NanoDet only if exactly one face -> isSolo
        -> aggregate all records in RAM; progress heartbeat every 5 seconds
      -> complete callback -> Hono validates entire snapshot and source
        -> transactional galleryBatch replacement (Turso or local SQLite)

Authenticated Selection / Edited Selfie request
  Hono validates independent access/token, source scope and completed job
    -> POST worker /v1/search (selfie + index identity, not gallery images)
      -> EmbeddingCache keyed by gallery/model/source/completed-job
        -> hit: reuse immutable normalized FP32 matrix
        -> miss: GET internal /indexes/:jobId; validate; normalize once
      -> decode selfie -> same inference semaphore/lock -> YuNet + SFace
      -> largest detected face -> normalized query -> cosine matrix multiply
      -> threshold -> best distance per photo -> sorted matches
    -> Hono revalidates access and current job, resolves photos
       (public gallery response is display order, not similarity rank)
```

Gallery photos are NOT downloaded or embedded per warm selfie query. NanoDet
is NOT called by the selfie query. It can delay a query indirectly while indexing
holds the shared semaphore, and all solo metadata must exist before publication.
Do not add a second index/cache or change Solo semantics to solve these issues.

## Storage, Authorization and Lifetime

- `server/db/galleries.ts`: dedicated Turso when configured; local SQLite otherwise.
  Main app runtime also supports Postgres/Supabase, but that is not evidence that
  face data uses Supabase. Gallery storage reports unconfigured with Postgres alone.
- Existing `face_index_jobs`, `face_index_photos`, `face_embeddings` store separate
  selection/edited scopes. Embeddings are JSON 128-vectors with face index, box,
  file revision and model version; no schema/format change needed for this work.
- File revisions use persisted source versions; legacy fallback is creation time
  and dimensions. Gallery digests exclude expiring thumbnail URLs and display order.
  Triggers/revisions prevent stale source publication. The completion transaction
  guards against newer jobs and source changes; old callbacks cannot overwrite them.
- RAM cache: 128 MiB, 16 entries, 900-second sliding TTL by default, LRU eviction,
  two concurrent fills, singleflight per key, shielded against caller cancellation.
  Completed job IDs indirectly separate scopes even though the key lacks a scope field.
- Published index reuse exists. Partial-job checkpointing does not: one failed
  photo aborts publication; new successful work since last completed index is lost.
- Worker is loopback/private behind bearer auth. Hono checks gallery-specific
  access and checks it again after search. Index export is internal-token protected.
  Worker has no database credentials; Drive readonly tokens are held in RAM.
- No selfie is deliberately persisted as gallery media. Multipart UploadFile may
  spool large uploads to temporary disk; README's unconditional RAM-only statement
  is too strong. Files close in `finally`. New benchmarks must not write embeddings,
  selfies, signed URLs, filenames, Drive IDs or identity labels to reports.

## Fetching, Preprocessing and DNN

- Drive listing/pagination happens during Hono gallery sync, not in the worker.
  Worker receives the photo manifest. Direct downloads use a reused HTTPX client
  (8 connections), readonly token reuse/refresh, trusted HTTPS host/redirect checks,
  a byte cap and 30-second HTTP phase timeout (not a total request deadline).
- Fetch order: supplied 1280-width WebP thumbnail, non-WebP retry, refreshed metadata
  thumbnail, then bounded original. After stale thumbnail failure, later photos in
  that job prefer fresh metadata (bounded history of 64 jobs). Failures can multiply
  requests; outer retry repeats fetch/decode/inference twice, even for ML failures.
  There is no rate-aware 429 backoff or cross-job photo-byte cache.
- Pillow checks 15-MiB/40-Mpixel limits, JPEG draft, EXIF transpose, RGB conversion,
  aspect-preserving LANCZOS thumbnail to long edge 1280, contiguous BGR copy.
  Face boxes are in this decoded coordinate space, not original-photo coordinates.
  Changing decode, resize, thumbnails or EXIF would be an accuracy-sensitive change.
- YuNet pads bottom/right to multiples of 32. SFace aligns to 112x112 and swaps BGR
  to RGB in its blob. Direct OpenCV 5 Net adapters use automatic engine selection;
  code requests no CUDA/OpenCL target; OpenCL is disabled. Do not infer the exact
  selected engine or instruction set on ARM from the Windows build.
- One process, one engine, `cv2.setNumThreads(2)` by default. `PHOTO_CONCURRENCY=3`
  overlaps IO/decode, not three simultaneous DNN forwards. Async semaphore plus
  native thread lock protect mutable Net inputs, thresholds and output buffers.
  `to_thread` cancellation does not terminate native inference; the lock still
  protects buffers. Search admission/decoded-image backlog is not bounded globally.
- NanoDet uses 416px letterbox and cached anchors. Existing decoder maps output
  pairs by anchor count, accommodating grouped/interleaved OpenCV output order.
  Tests cover person selection and NMS, but grouped-order test only used zeros.
  Unknown anchor levels / arbitrary non-32 channel counts are not strictly rejected.
  Keep mappings unchanged; add positive regression fixtures first.
- Custom YuNet/SFace adapter predates this audit. Limited parity smoke evidence is
  not a diverse accuracy evaluation. Rank-deficient SFace landmarks and YuNet NMS
  float-vs-integer behavior deserve separate regression investigation, not silent edits.

## Bottleneck Ranking

Ranking is by critical-path exposure and code evidence, NOT measured ARM duration.

| Priority | Evidence / hypothesis | Measurement / action |
| --- | --- | --- |
| P0 | Shared inference slot covers YuNet, every SFace and conditional NanoDet; crowded frames add serial SFace calls | Split detect/align/embed/queue timings; measure search p95 with active indexing |
| P0 | Existing logs combine stages; old benchmark omits NanoDet, uses gallery-mode selfie detection and legacy matching | Reproducible production-path CPU benchmark, separate cold/warm search and network |
| P0 | One bad photo/final callback loses uncommitted job work; stopped jobs continue until publication rejection | Quantify wasted work; later design cancellation/checkpoints with reversible semantics |
| P1 | Drive fallback chain + retries + 1280px WebP/JPEG decode can dominate indexing | Measure fresh/stale/missing thumbnails, retries, fetch/decode distribution independently |
| P1 | OpenCV, NumPy BLAS and default executor may oversubscribe 2 CPUs | Compare PRD profiles on actual ARM, record affinity/build/BLAS; no default change yet |
| P1 | Full snapshot JSON transfer/parsing and full transactional rewrite on sync, even if most files unchanged | Measure callback and actual DB write separately before changing transport/publication |
| P1 | Warm match loops through every embedding in Python; duplicate normalization in serialization | Opt-in exact-parity optimizations, synthetic A/B; likely smaller than DNN, must measure |
| P1 | Selection resolves entire photo catalog after matching; readiness checked on every public request | Measure Hono phases, later matched-only resolution preserving totals/order/access |
| P2 | Resize/model/backend experimentation | Deferred until ARM + labeled quality baseline; requires approval where specified |

Cache load JSON is capped at 20 MiB before the 128-MiB retained cache limit. A
crowded 3,000-photo gallery may hit transfer limits long before matrix memory.
Matrix byte accounting does not bound transient JSON/list allocations, concurrent
queries or two pending fills. Benchmark large galleries and report capacity errors.

## First Three Low-Risk Changes

1. P0, medium: optional request-scoped stage timings and a reproducible benchmark.
   Risk: instrumentation overhead; default disabled, benchmark enabled/disabled.
2. P1, small: threshold-mask distances before Python best-per-photo reduction.
   Preserve exact dot product, thresholds, stable tie order and solo filtering.
   Keep old path with feature flag; test sparse, dense, duplicates and boundaries.
3. P1, small: reuse the normalized vector while creating indexed face records.
   Preserve the legacy invalid/empty-vector filter and output bytes; feature flag.

No production model, model version, recognition threshold, resize, persistent
embedding format, database schema or index rebuild is part of this increment.

## Benchmark and Rollout

See `benchmarks/README.md` for exact commands, dataset schema, accuracy definitions,
ARM profiles and rollback. See `benchmarks/report.md` for measured local results
and explicit unmeasured fields. Optimization flags stay OFF until ARM validation.

CPU runs: same local bytes, same order, warm models, 3+ repeats, separate model
startup and first-shape inference. Report per-stage p50/p95, completed photos/sec,
search requests/sec, process CPU seconds (100% = one core), process peak RSS,
errors and exact result parity. Do not average failures away.

Accuracy: permissioned >=500-photo labeled wedding set plus positive/unknown
selfies; scales 500/1,000/3,000 photos. Fixed thresholds and validation/test split.
Detection IoU recall and false positives/negatives, thresholded retrieval precision/
recall, Recall@K/Precision@K, query false accept/miss rates, solo confusion, and
small-face/profile/lighting/crowd slices. Labels use decoded-image coordinates.
Identical outputs only prove runtime parity on the evaluated inputs, not accuracy.

End-to-end: separate approved staging galleries; cold index, unchanged sync,
single-file changed sync, failed/retry jobs, cold/warm cache search, then concurrent
index/search. Retain fetch source/bytes/retry counters and DB write timing. No
automatic production jobs, index clearing or external uploads from benchmark tools.

Rollout: audit -> local parity -> ARM profiles -> labeled quality -> staging canary
-> explicit go/no-go. Rollback flags + restart idle worker; no index migration.
Checkpointing, search priority, NanoDet enrichment, alternative decode/resize,
new runtimes/models remain later work requiring measured justification.

## References

- [OpenCV 5 migration](https://github.com/opencv/opencv/wiki/OpenCV-4-to-5-migration)
  documents automatic engine selection; verify against the deployed wheel.
- [YuNet](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet),
  [SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface),
  [NanoDet](https://github.com/opencv/opencv_zoo/tree/main/models/object_detection_nanodet).
  Repository checksums in `model_assets.py` remain the artifact source of truth.
