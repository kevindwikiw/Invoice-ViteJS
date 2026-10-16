# PRD — Orbit Face Worker: ARM CPU Selfie Search Optimization

**Status:** Implementation-ready technical PRD (requires repository audit before implementation)  
**Priority:** Performance + retrieval quality, with safe rollout  
**Primary environment:** Ubuntu ARM64, 2 vCPU, 12 GB RAM  
**Additional targets:** Local CPU, Oracle Linux/Ubuntu VM  
**Owner:** Engineering / Astra coding agent

## 1. Objective

Speed up wedding-gallery selfie search and gallery indexing on CPU **without materially degrading face-search quality**, especially for small/distant faces, side profiles, difficult lighting, and crowded photos. Treat the existing models as the **production baseline**, not as models to replace by default.

### Current stack (preserve initially)
- OpenCV 5.0.0
- YuNet FP32: `face_detection_yunet_2023mar.onnx`
- SFace FP32: `face_recognition_sface_2021dec.onnx`
- NanoDet FP32: `object_detection_nanodet_2022nov.onnx` (person counting / Solo Photos)
- Images fetched from Google Drive
- Existing timings: `fetch_ms`, `decode_ms`, `face_ms`, `person_ms`
- NanoDet output decoder recently adapted for OpenCV 5 DNN output ordering — treat as a regression-sensitive area.
- Existing settings reported: `FACE_WORKER_MAX_CONCURRENT=1`, `FACE_WORKER_PHOTO_CONCURRENCY=3`, `FACE_WORKER_INTRA_OP_THREADS=2`. Confirm actual names, usage, and backend before changing.

## 2. Non-goals / hard guardrails

1. **Do not replace production YuNet, SFace, or NanoDet** without matched A/B benchmark and explicit approval.
2. Do not change face-match thresholds, embedding dimension/format, decoder mappings, or face alignment behavior silently.
3. Do not clear or rebuild existing indexes without a reversible migration plan.
4. Do not process the same photo on every selfie query if a valid indexed embedding already exists.
5. Do not make NanoDet a synchronous blocker of selfie matching if its output is only required for Solo Photos.
6. Do not store raw selfies, image URLs, tokens, or unnecessary face biometrics in logs. Follow existing retention/access controls.
7. Do not introduce complex infrastructure (vector DB, queues, FAISS, Redis, GPU) unless profiling demonstrates need and deployment cost is justified.
8. Avoid speculative speedup promises and quality claims.

## 3. Required first step — inspect repository, do not assume architecture

Map and document:
- API endpoints, job initiation, current search/request flow, background workers, concurrency control and cancellation.
- Does gallery indexing already exist? Where/how are embeddings, face boxes, photo IDs, source revisions, and model versions stored? Is selfie search currently re-downloading/re-decoding/re-embedding entire galleries?
- Source of Google Drive images: authorization, retry, pagination, download format/size, request concurrency and rate limits.
- Image decode and resizing, EXIF orientation, color conversion, face alignment, input shape, box mapping.
- OpenCV DNN backend/target and `cv2.getBuildInformation()` on the actual service runtime; thread settings and CPU affinity if present.
- Check whether OpenCV DNN model inference shares mutable model instances across concurrent tasks; validate thread safety.
- Check NanoDet decoder invariants on OpenCV 5 engine output.
- Index storage and privacy/access controls; query-to-gallery authorization.
- Current latency and data-volume distributions, including gallery sizes, face counts per photo, cache hit rate and concurrency.

Write an `AUDIT_FINDINGS.md` with call graph, bottleneck hypotheses, risks, and files likely to change. If existing indexing/cache already works, optimize it rather than building a duplicate.

## 4. Workstreams (implement incrementally)

### A. Observability and repeatable benchmark (P0)
Add or reuse granular timing points:
- `fetch_ms`, `decode_ms`, `resize_ms`, `detect_ms`, `align_ms`, `embed_ms`, `face_ms`, `person_ms`, `index_write_ms`, `query_match_ms`, `total_ms`
- Gallery ID (non-sensitive internal identifier), photo size/resolution, count of faces and people, cache hits, failure/retry category, model/engine version, active concurrency.
- For selfie search, record end-to-end latency **separately** from gallery indexing latency.
- Avoid per-photo personally identifying data in logs.

Create a reproducible local benchmark runner with JSON/CSV output; report p50, p95, throughput (photos/sec), peak RSS, CPU utilization, errors, and accuracy.
- CPU-only tests: cache images locally, warm up models, identical ordering/dataset, repeat runs, isolate network time.
- End-to-end tests: separately measure Google Drive download/network variance.
- Fixed wedding dataset with labels for face IDs, difficult faces, and Solo Photos person counts; maintain a permissioned local dataset rather than committing real guest images to git.
- Retrieval quality: face-detection recall, face-level false positives/false negatives, Recall@K and Precision@K per selfie, query-level false accept and miss rates at fixed thresholds; test unknown people as negative queries. Segment metrics by small faces, side profile, lighting, crowd density.
- Preserve exact same decision thresholds when testing runtime-only changes; for quantized recognition, recalibrate on validation split and report test results independently.

### B. Eliminate redundant work on selfie-query critical path (P0)
Inspect existing architecture first. If missing, build idempotent per-gallery indexing:
1. Google Drive photo → fetch once per source version → decode/EXIF → YuNet → align → SFace → persist embedding + metadata.
2. Save `gallery_id`, `photo_id`, source revision/hash, face ID, bounding box, embedding, model identifier/version and preprocessing version; follow privacy policy.
3. Only index new/changed photos; resume partial jobs safely and avoid double indexing.
4. Selfie query → one YuNet/SFace pass → search previously indexed embeddings → rank photo matches/dedupe → return photo IDs/links through existing authorized API.
5. If index is incomplete, report state explicitly and do not silently claim search is comprehensive; offer existing fallback only if safe and bounded.
6. Model-versioned embedding indexes. Never mix recognition embeddings across incompatible model/preprocessing variants without evaluation.

**Retrieval baseline:** use a normalized matrix and cosine similarity (e.g. NumPy), grouped per gallery; benchmark before adding an ANN/vector database. Confirm actual embedding dimensionality from SFace output, don't hardcode based on assumption.

### C. Move NanoDet off search critical path (P0/P1)
If person classification is used for Solo Photos but not face identity search, precompute `person_count` separately in gallery indexing or an asynchronous enrichment job.
- Search results must not wait for NanoDet unless user explicitly filters by person count and data is unavailable; define explicit partial/unknown behavior.
- Regression fixtures for OpenCV 5 NanoDet output order, tensor shape, strides, decode, NMS, class index, bounding boxes, and person counts.

### D. ARM CPU tuning (P1)
Measure these configurations under equivalent test inputs:

| Profile | Jobs | Photo concurrency | DNN/intra-op threads |
|---|---:|---:|---:|
| Baseline | 1 | 3 | 2 |
| Sequential | 1 | 1 | 2 |
| Balanced | 1 | 2 | 1 |
| Single-thread | 1 | 1 | 1 |

Verify how each setting affects actual OpenCV/backend threads; count total worker processes and queues. Avoid oversubscription on 2 vCPU; do not concurrently call shared mutable DNN inference objects without proving thread safety. Limit download concurrency separately from inference concurrency when possible. Bound memory usage and queue depth; provide cancellation/timeouts. Test cold/warm runs.

### E. Resize / tiny-face trade-off (P1)
Benchmark maximum input long-edge values 960, 1280, 1600 px (plus production baseline). Preserve EXIF orientation, aspect ratio, face box mapping, and color order. Segment recall for distant faces, crowd scenes, side profiles, low-light/backlight. Evaluate selective second-pass crops/tiles only if net recall and p95 justify it. Use IoU/NMS merge and coordinate remapping. Never downsize blindly for all scenes.

### F. Runtime/model experiments **only after P0/P1 baseline** (P2)
- Compare OpenCV DNN FP32 baseline vs compatible ARM64 ONNX Runtime CPU backend if available; ensure matching preprocessing/postprocessing.
- Independently A/B YuNet FP32 vs official INT8/int8bq; SFace FP32 vs official INT8/int8bq; NanoDet FP32 vs official INT8 where available.
- Validate output tensor schema for OpenCV 5 across model variants. Quantization may be slower on ARM and may affect difficult-face recall/match thresholds.
- Consider the official YuNet `2026may` export only as a compatibility candidate (dynamic shape), not an assumed accuracy upgrade.
- Pin artifact origin, checksum/hash, license, versions, inference backend, OS, architecture, test conditions, and results.

Official references for validation (confirm live at implementation time):
- https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet
- https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface
- https://github.com/opencv/opencv_zoo/tree/main/models/object_detection_nanodet
- https://github.com/opencv/opencv_zoo/tree/main/benchmark

## 5. A/B experiment protocol

Dataset: a permissioned, labeled set of at least ~500 diverse wedding photos for initial testing, multiple positive selfie queries, and negative/unknown selfie queries. Include representative whole galleries (e.g. 500, 1,000, 3,000 photos) for scale measurements. Avoid tuning against final test split.

For each experiment:
1. Fix same photos, gallery states, input resolution, query set, machine, model versions, and thresholds except explicit experimental variable.
2. Warm up inference and record cold start separately.
3. At least 3 runs (more if variance high) and capture configuration metadata.
4. Benchmark indexing and selfie search as different workloads.
5. Measure p50/p95 end-to-end and per stage; photos/sec; CPU and RSS; task failures; detection recall by slice; false positive/false negative; Recall@K/Precision@K.
6. Report delta to baseline and include potential regression/trade-off; do not mask failed cases using averages alone.
7. Define acceptance thresholds with owner after baseline is known; no ungrounded percentage targets.

Suggested output files: `benchmarks/results/*.json`, `benchmarks/report.md`, `benchmarks/report.csv` (no private imagery or tokens).

## 6. Safe rollout and delivery

- Stage 0: audit + baseline; **no functional behavior change**.
- Stage 1: optimize observability, redundant processing, concurrency, and queues behind a feature flag.
- Stage 2: shadow/test new indexing or search method side-by-side; compare results for same selfies and galleries; keep legacy option.
- Stage 3: limited canary / staging on ARM 2 vCPU 12 GB; monitor p95, throughput, errors, retrieval quality.
- Stage 4: production rollout only after explicit go/no-go; retain rollback path and versioned indexes.

**Definition of done:**
- Benchmark runner reproducible on Ubuntu ARM64 and local CPU.
- Baseline and A/B report with p50/p95, throughput, accuracy, memory and CPU.
- No unapproved production model change or threshold change.
- Existing NanoDet OpenCV 5 decoder regression tests pass.
- Ability to rollback behavior and indexes.
- Existing API contracts still pass integration tests.
- Documentation for startup, config, monitoring, feature flags, rollback and rebuild-index procedure.

## 7. Agent execution instructions (Astra)

1. Start with repository discovery and show a concise factual audit; **do not assume the current search architecture**.
2. Make an implementation plan ordered by measurable impact and risk. Identify relevant modules and tests.
3. Implement in small reviewable changes, with focused automated tests. Keep compatibility with current APIs and models.
4. Benchmark **on the actual ARM 2-vCPU/12-GB machine**, not on a substitute host, before claiming speedups. If no execution access, provide exact benchmark commands and mark results `NOT MEASURED`.
5. Record before/after metrics. Never invent timings or quality numbers.
6. When an architectural decision would require a new persistent datastore, migration, changes to biometric retention, or modifying production models, pause for explicit approval.
7. Report changed files, commands executed, test results, benchmark results, outstanding risks and rollback steps.

## 8. First deliverable expected from Astra

Before editing implementation, return:
- Current indexing/search flow and whether gallery images are processed repeatedly per selfie request.
- Bottleneck ranking grounded in code and available logs.
- Actual CPU/OpenCV backend and thread behavior.
- Data storage/index versioning status.
- Three lowest-risk changes with estimated implementation complexity (not speculative measured speedup).
- Proposed A/B benchmark and rollout plan.
