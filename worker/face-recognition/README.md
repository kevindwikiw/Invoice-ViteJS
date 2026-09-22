# Orbit Face Recognition Worker

CPU worker using Python, OpenCV Headless, YuNet detection and SFace embeddings.
The gallery/API still run on Hono/Bun. Installation uses ready-made binary
wheels without Docker or a compiler. Tested locally with Python
3.13 x64 on Windows; Ubuntu 24.04 ARM64 must still be validated on the VM.

## Run locally on Windows

From the repository root:

```powershell
cd worker\face-recognition
.\setup-windows.ps1
.\run-worker.ps1
```

Setup creates `.venv-ml` without changing the existing `.venv` or system Python.
It accepts Python 3.11-3.13 x64. To use an existing interpreter explicitly:

```powershell
.\setup-windows.ps1 -Python .\.venv\Scripts\python.exe
```

Dependencies install with `--only-binary=:all:`; installation fails instead of
compiling if a wheel is unavailable. Models download from a pinned official
OpenCV Zoo revision and are SHA-256 verified. Binaries stay in ignored `models/`.
`check-worker.ps1` checks imports, model checksums and warm-up inference.

Create `.env` from `.env.example` only if it does not already exist. Configure:

| Worker `.env` | Matching server setting |
| --- | --- |
| `FACE_WORKER_TOKEN` | `FACE_WORKER_TOKEN` |
| `FACE_WORKER_CALLBACK_TOKEN` | `FACE_WORKER_INTERNAL_TOKEN` |
| `FACE_WORKER_CALLBACK_ORIGIN=http://127.0.0.1:3000` | Local API origin |
| Local listener `127.0.0.1:8088` | `FACE_WORKER_URL=http://127.0.0.1:8088` |

The server also needs `FACE_WORKER_CALLBACK_ORIGIN=http://127.0.0.1:3000`.
Leave `FACE_WORKER_MEDIA_ROOT` empty for callback thumbnails. Both API and worker
must run. Restart the API after updating its code; sync an existing gallery once
to import Drive content versions and start background indexing.

The run script invokes the venv explicitly and loads `.env`:

```powershell
.\.venv-ml\Scripts\python.exe -m uvicorn main:app --env-file .env --host 127.0.0.1 --port 8088 --workers 1
```

`GET /healthz` means HTTP is alive. `GET /readyz` requires a Bearer worker token
and only returns 200 after both models warm up. The gallery shows Filter by
selfie only when the API sees a ready, matching worker. There is no browser ML
fallback. Port 8088 is a private endpoint.

## Indexing and performance

- Syncing a gallery or opening/publishing a synced gallery starts indexing when
  the worker is available. These admin responses do not wait for indexing.
- A single model instance stays warm. Three bounded tasks overlap image fetch
  and decode; one inference runs at a time with two OpenCV CPU threads.
- API assets request 1280px Drive thumbnails. Local files and fallback originals
  are resized to a maximum side of 1280px, with EXIF orientation applied. Original
  downloads can still be slow when Drive does not provide a thumbnail.
- The gallery database stores Drive checksum (or modified time/size), embeddings
  and a `face_index_photos` marker for every indexed photo, including zero faces.
  Unchanged images skip download/inference. Reordering photos, editing titles
  and refreshing thumbnail URLs do not invalidate the index.
- Existing galleries without source metadata get indexed once; the next sync
  imports real Drive checksums. Model changes always require a fresh index.
- A failed photo gets one retry. Failed jobs never publish partial results;
  previous embeddings remain until successful replacement. Stale jobs can retry.
- The worker accepts one gallery job by default. If busy/offline during automatic
  pre-indexing, sync again or use Find Face after it becomes available to retry.
- Selfie requests compute a query and compare against stored gallery vectors.
  Detection starts at 0.90; only when no face is found, selfie detection retries
  once at 0.80. Gallery indexing stays at 0.90 and identity-match thresholds are
  unchanged. The shared detector threshold is restored under its inference lock,
  including on errors. Existing gallery indexes do not need rebuilding.
  Selfie bytes/embeddings are not saved as application data or written to logs;
  multipart temporary uploads are cleaned up when the request finishes.
- Search authenticates before parsing multipart data. The embedding field uses
  `FACE_WORKER_MAX_EMBEDDING_JSON_BYTES` (20 MiB by default), rather than the
  framework's 1 MiB default. Oversized embeddings/selfies return HTTP 413;
  malformed forms/JSON are rejected, and unreadable/no-face selfies return 422.
  API logs expose only gallery ID, worker status and an allowlisted error code.
  Restart the worker and API after updating to apply the parser/error changes.

Logs show job ID, file ID, face count, fetch/decode/wait/inference milliseconds.
Local inference still consumes laptop CPU; it does not run ML in the browser.

SFace produces 128-dimensional embeddings. Its model identity is pinned in
`engine.py` and `server/lib/face-model.ts`. Only embeddings matching this model
identity are used for search.

Balanced starts at OpenCV's LFW cosine similarity baseline 0.363 (distance
0.637). Strict uses distance 0.50 and Wider 0.68. These are starting points;
calibrate on representative wedding photos, especially small/group faces.

## Validation and timing

### Versioned RAM cache and lightweight status

The API sends `galleryId`, `modelVersion`, `sourceVersion`, `completedJobId`,
`sensitivity` and the selfie to `/v1/search`. On a cache miss, the worker pulls
`GET /api/internal/face-index/indexes/:jobId` using its callback token. That
endpoint validates publication and source version in the same SQL snapshot as
the embeddings read. Empty completed indexes are valid. Warm searches do not
query or resend the embedding matrix. Photo downloads still use the existing
API/Drive path; this change does not introduce direct Drive access.

Cache keys include all four identity fields. Entries hold normalized float32
matrices and file IDs, never selfies. Defaults, configurable in the worker env:

| Setting | Default |
| --- | --- |
| `FACE_WORKER_CACHE_MAX_BYTES` | 134217728 (128 MiB) |
| `FACE_WORKER_CACHE_MAX_ENTRIES` | 16 |
| `FACE_WORKER_CACHE_TTL_SECONDS` | 900 (15 minutes idle) |

At most two cache fills run together; concurrent requests for the same key share
one fill. Failed fills are retryable. LRU eviction respects both entry and retained
byte limits; oversized entries are rejected. Idle entries are removed on access
or by the cleanup task (within 60 seconds of expiry). Memory limits account for
retained matrices and identifiers, not total process RSS: active requests and
temporary JSON decoding also require RAM. Restart clears RAM; the next request
fetches an index again without rescanning photos.

Gallery storage adds `face_source_version`, `face_source_revision`, invalidation
triggers and a job lookup index, on SQLite and Turso. Legacy galleries calculate
their existing fingerprint once on first use. Sync refreshes it with revision
checks. Warm status polls read metadata and jobs, not the photo manifest.
Filename/order/thumbnail/title/selection edits do not invalidate the fingerprint.
Photo membership/content changes do. Failed indexing preserves the last stored
index, but only an index matching the current gallery is searchable.

The API rechecks gallery access and index identity after inference. A concurrent
change produces `409 index_changed`, displayed by the existing modal with a
retry message. Cached entries never bypass gallery authentication. Expired or
deleted gallery entries may remain in RAM until eviction but cannot be returned
through the public API.

Rollout: back up gallery storage, deploy/restart the worker first, then the API.
The new worker advertises `embedding-cache-v1` in authenticated `/readyz` and
still accepts legacy embedding forms. The new API requires that capability;
older workers are reported unavailable until updated. Schema initialization is
idempotent; no selection data or embeddings are dropped. During a rolling
upgrade, old API instances can still use the worker's legacy request format.

Cache logs contain hit/miss, retained bytes/entries, transfer bytes, record count,
load duration and safe failure codes. No tokens, selfies or embedding values.

```powershell
.\.venv-ml\Scripts\python.exe -m unittest -v test_worker test_embedding_cache
.\.venv-ml\Scripts\python.exe benchmark_cache.py --image .evaluation/lena.jpg --records 900
```

Local cache check (Windows, two CPU threads): real OpenCV inference with 900
synthetic entries repeated from one evaluation face; ASGI transport and a mocked
snapshot callback, without Drive, Turso or network latency. Cold search 314.4 ms,
median warm search 132.9 ms. Snapshot transfers: 2,422,876 bytes, then 0 bytes for
three warm searches. Request size fell from 2,632,760 bytes (legacy embeddings
plus selfie) to 92,562 bytes (identity plus selfie). Retained cache: 518,070 bytes.
These figures demonstrate transfer reuse, not production throughput, matching
accuracy or support for 100 simultaneous users.

Cache-change validation: 25 worker tests, 18 API/storage tests, and three browser
smoke tests (search, index-change retry, selection submit) passed, along with
client/server typechecks and the client build. Storage migration tests use
isolated SQLite; a live Turso deployment was not exercised.

```powershell
.\.venv-ml\Scripts\python.exe -m unittest -v test_worker
.\.venv-ml\Scripts\python.exe benchmark.py --photos C:\evaluation\gallery --selfie C:\evaluation\selfie.jpg
```

Benchmark reads local files and reports model warm-up, first index, median
per-photo and repeated warm-search times. It does not persist selfies or vectors.
Local timings exclude Drive, HTTP and database latency. Use a 20-50 photo
evaluation gallery with known positive/negative selfies to assess actual quality.

Local check on 2026-09-21 (Windows, Python 3.13.7, two OpenCV threads): three
OpenCV 4.12.0 sample images (lena, messi5, fruits), two detected faces, one
matching image. Model load/warm-up: 411 ms; local index: 284 ms; median repeated
search: 114 ms; one HTTP search: 209 ms. Blank/corrupt uploads returned 422.
These small-sample results are not customer-gallery throughput or accuracy
measurements. Windows worker tests (10), API tests (8), culling/admin Playwright
tests (17), client/server typechecks and client build passed.

To smoke-test a running local HTTP worker with the same evaluation inputs, add
`--worker-url http://127.0.0.1:8088` to the benchmark command. This reads the worker
token from `.env` without printing it.

API regression test (isolated in-memory SQLite), from the repository root:

```powershell
bun test ./server/routes/face-index.test.ts
```

## Local HTTP burst load test

`load_test.py` launches an isolated worker subprocess on an automatically assigned
localhost port. It uses real OpenCV and HTTP/Uvicorn, but supplies a synthetic
900-record gallery through an in-memory snapshot callback. It does not connect
to application storage or Drive, change the worker at port 8088, or persist
the selfie/embedding values. Reports contain counts, sizes and timings only.
The test subprocess is stopped on completion or failure.

```powershell
.\.venv-ml\Scripts\python.exe -B load_test.py --image .evaluation/lena.jpg --output .evaluation/load-test-512.json
# To evaluate a different selfie, replace --image with its local path.
```

Default stages are simultaneous bursts of 10, 30 and 100 requests, each with
cold and warm cache, with a 30-second per-request deadline. Cold stages clear
only the isolated test cache. After timeouts, the harness waits for outstanding
server requests to finish before the next stage. This is not a sustained-load
or production end-to-end test. Use `--concurrency 10 30`, `--records 900`, and
`--deadline 30` to adjust the test. The harness exits normally even when requests
time out: read the report's `statuses` field, not just its process exit code.

Local results (Windows, 16 logical CPUs available, two OpenCV inference threads):

| Input decoded size | Burst | Warm success | Warm timeout | Successful-request p95 |
| --- | ---: | ---: | ---: | ---: |
| 512 x 512 sample | 10 | 10 | 0 | 1.05 s |
| 512 x 512 sample | 30 | 30 | 0 | 3.11 s |
| 512 x 512 sample | 100 | 100 | 0 | 10.18 s |
| 720 x 1280 WhatsApp portrait, detector retry | 10 | 10 | 0 | 3.72 s |
| 720 x 1280 WhatsApp portrait, detector retry | 30 | 30 | 0 | 9.91 s |
| 720 x 1280 WhatsApp portrait, detector retry | 100 | 73 | 27 | 28.60 s |

Each cold burst fetched one snapshot (~2.42 MB); every warm burst fetched zero
embedding bytes. The portrait's cold 100-request burst had 76 successes and
24 timeouts. After the 100-request warm burst, server work continued for 9.7 s
beyond the client deadline. Peak working set across the portrait test process
was 1,552,109,568 bytes (~1.45 GiB), versus ~0.49 MiB retained index cache.
Peak RSS is a cumulative process high-water mark, not per-stage allocation.
Decode and other worker threads may consume CPU beyond the two OpenCV threads.

These single bursts reuse one selfie and one gallery and exclude background
indexing, Fly, Turso, network latency and browser traffic. They do not establish
accuracy or guarantee capacity on a two-OCPU VM. At this configuration, 100
simultaneous large-selfie searches exceed the deadline; bounded admission,
queue limits and bounded image decoding need evaluation before promising that
traffic level. Cache reuse reduces transfer, not inference for each selfie.

### Isolated parallel inference matrix

The benchmark supports `--instances 1|2|4`, `--threads 1|2`, and `--repeats 3`.
`--matrix` tests all six combinations, beginning with the 1-instance/2-thread
baseline and rotating configuration order by two positions each repetition.
Each configuration/repetition starts a fresh process and warms every model.
OpenCV's thread setting is process-global, not a CPU quota per model.

```powershell
.\.venv-ml\Scripts\python.exe -B -m unittest test_worker test_embedding_cache test_benchmark_pool -q
.\.venv-ml\Scripts\python.exe -B load_test.py --image .evaluation/lena.jpg --matrix --repeats 3 --output .evaluation/parallel-512.json
# Repeat with the original portrait path and a separate output report.
```

Only the child benchmark process installs `BenchmarkPool`: each model instance
has its own detector, recognizer and lock. Native threads own model slots until
inference returns, even if their HTTP request is cancelled. Production retains
its original single inference semaphore. Admission waits asynchronously before
scheduling inference, so queued requests do not occupy Python executor threads.
The shared default Python executor also handles decoding and matching.
Wait timings include executor scheduling and model-slot waiting, but not decode.

Results validate every successful response against the first configuration's
reference file IDs, ordering and cosine distances (absolute tolerance `1e-5`).
The synthetic index repeats one embedding 900 times; this verifies consistency,
not recognition accuracy on a real gallery. The input, decode size, matching
threshold and selfie detection retry are unchanged between configurations.

Reports have `runs`, median/min/max `summary`, and `complete`. Completed matrices
also include `decision`: ranking by total successes at burst 100 (cold and warm),
then median successful-request p95 and throughput. Equal-success configurations
within 5% on both performance metrics prefer fewer models, then fewer threads.
Any configuration with incorrect results is excluded. Partial reports are saved
after each configuration, but must not be used to select a winner.
Inspect timeout/error totals alongside p95, which excludes unsuccessful requests.
RAM peaks are cumulative within each child process; native concurrency peaks
are likewise process-wide. No winner is automatically applied to the worker.

Completed portrait matrix (Windows laptop, 16 logical CPUs, 720 x 1280 decoded
selfie with detector retry, 900 synthetic records, deadline 30 s):

| Models | OpenCV threads | Burst-100 success, cold + warm | Timeouts | Warm p95 median [min, max], seconds |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 2 (baseline) | 479 / 600 | 121 | 28.717 [28.626, 28.797] |
| 1 | 1 | 479 / 600 | 121 | 28.659 [28.620, 28.942] |
| 2 | 1 | 600 / 600 | 0 | 19.310 [19.122, 19.397] |
| 2 | 2 | 600 / 600 | 0 | 20.049 [19.618, 20.054] |
| 4 | 1 | 600 / 600 | 0 | 10.724 [10.645, 10.748] |
| 4 | 2 | 600 / 600 | 0 | 11.206 [11.165, 11.560] |

The laptop candidate is four models with the global OpenCV thread setting at
one. Its warm burst-100 throughput was 8.91 [8.90, 8.97] successful requests/s;
mean queue wait was 4.653 [4.629, 4.686] s and mean inference was
347.1 [344.2, 349.7] ms. CPU usage was 4.95 [4.95, 5.04] core-equivalents.
Process peak RAM was median 1.86 GiB, maximum 1.87 GiB. This is not a two-CPU
configuration or a capacity promise for the Oracle VM.

Across all 5,040 portrait requests, only the single-model configurations timed
out (242 total); there were no incorrect-result responses. Every cold stage
loaded one 2,416,576-byte snapshot; every warm stage transferred zero embedding
bytes. For the candidate, cold p95 was 10.943 [10.918, 11.079] s; post-burst drain
was at most 0.015 s, versus up to 8.753 s for the baseline's warm bursts.
Figures in brackets are ranges across three repetitions, not confidence
intervals. p95 covers successful requests only. Aggregate details are generated
locally in `.evaluation/parallel-1280.json` (ignored by git).

The separate 512 x 512 sample matrix completed all 5,040 requests successfully,
including all cold/warm repetitions and smaller bursts. Warm burst-100 p95:

| Models | OpenCV threads | Median [min, max], seconds |
| ---: | ---: | ---: |
| 1 | 2 | 10.175 [10.101, 10.240] |
| 1 | 1 | 9.874 [9.738, 10.052] |
| 2 | 1 | 5.460 [5.242, 5.482] |
| 2 | 2 | 5.558 [5.436, 5.586] |
| 4 | 1 | 3.129 [3.092, 3.236] |
| 4 | 2 | 3.238 [3.219, 3.249] |

Four models/one thread was also the sample candidate: warm throughput median
29.48 [29.28, 29.71] requests/s, peak process RAM at most 0.62 GiB.
Cold stages fetched 2,419,276 bytes once; warm stages fetched no embeddings.
The full report is `.evaluation/parallel-512.json`. This is a different image,
not evidence that resizing the original portrait to 512 px preserves detection.
Both matrices are complete (36 child runs, 216 stages, 10,080 requests total).
All successful responses passed reference checks. The 35 worker/cache/benchmark
unit tests also passed. Production model concurrency remains unchanged.

## Ubuntu deployment

Copy this directory to the VM (exclude Windows venvs and local `.env`). Run
`deploy/setup-ubuntu.sh`, then create `/etc/orbit-face-worker.env` with restrictive
permissions. The script installs Python/venv/rclone, binary wheels, verified
models and the non-root systemd service. It does not install build tools.

```bash
sudo chmod 600 /etc/orbit-face-worker.env
sudo systemctl daemon-reload
sudo systemctl enable --now orbit-face-worker
sudo journalctl -u orbit-face-worker -f
```

Use a private network/tunnel from Fly; do not open port 8088 publicly. Set the
callback origin to the API reachable from the VM. Optional read-only mount:

```bash
rclone mount orbit-drive: /mnt/orbit-drive --read-only --vfs-cache-mode off \
  --dir-cache-time 30s --poll-interval 1m --daemon
```

Drive IDs are the source of truth. When using local files, prefer
`<MEDIA_ROOT>/<galleryId>/<driveFileId>` to avoid ambiguous filenames.

## Models and licenses

- [OpenCV face pipeline and matching baseline](https://docs.opencv.org/4.12.0/d0/dd4/tutorial_dnn_face.html)
- [YuNet model and MIT license](https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet)
- [SFace model and Apache-2.0 license](https://github.com/opencv/opencv_zoo/tree/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_recognition_sface)

Keep the applicable notices with deployed model distributions. Model downloads
are explicit setup operations; readiness never downloads code or weights.
