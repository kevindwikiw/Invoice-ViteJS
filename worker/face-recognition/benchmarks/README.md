# CPU Benchmark and Rollout Protocol

Read `../AUDIT_FINDINGS.md` first. This increment implements PRD Stage 0 and two
opt-in Stage 1 candidates. Staging/production rollout and P1 tuning remain pending
the actual ARM host and labeled evaluation set. No new dependency is required.

## Flags and Rollback

All default to `0`. Add explicitly to the service environment only for a planned
measurement/canary. Restart the worker when idle to apply changes.

| Flag | Effect |
| --- | --- |
| `FACE_WORKER_METRICS=1` | Request-local, aggregate stage timing logs |
| `FACE_WORKER_MATCH_CANDIDATE_FILTER=1` | Filter sparse threshold matches before Python reduction; dense results use original iteration |
| `FACE_WORKER_NORMALIZE_ONCE=1` | Serialize each indexed face using one normalization instead of two |

The Hono service also accepts `FACE_WORKER_METRICS=1` to emit `index_write_ms` around
the existing completion transaction. Worker `index_publish_ms` includes callback
network/validation/write/response time and must NOT be described as DB-only time.

Rollback: set the two optimization flags to `0` and restart the idle face worker.
Existing indexes remain valid. Do NOT delete indexes, change the model version or
run rebuild jobs for these changes. Archive worker configuration is unaffected.
Any future preprocessing/model change needs an approved version/rebuild plan;
none is authorized by this benchmark work.

Instrumentation measures `decode_ms` (Pillow load/EXIF/RGB), `resize_ms`, `color_ms`,
`detect_ms`, `align_ms`, `embed_ms`, `face_ms`, `person_ms`, `serialize_ms`,
`fetch_ms`, `wait_ms`, `index_load_ms`, `query_match_ms`, `total_ms` and publication.
Detection includes YuNet blob/decode/NMS; embedding includes blob creation/forward.
Nested stages overlap: do not sum `face_ms` with its child timings.
`queue_and_face_ms - face_ms` approximates search admission wait. Index retry stage
times accumulate across attempts except `wait_ms`, which reports the last attempt;
the legacy text `decode_ms` has a broader meaning
than the new structured field. Use structured `Face metrics` records consistently.
New logs contain numeric counts/internal IDs, workload and safe exception class,
never input values, URLs, selfie bytes, embeddings or exception messages.
Existing Drive fetch logs still contain file IDs and fallback categories.

## Offline Synthetic A/B

From `worker/face-recognition`, Windows:

```powershell
.\.venv-ml\Scripts\python.exe benchmark_cpu.py --micro --repeat 3 --samples 30 --output benchmarks/results/local-micro.json
```

Ubuntu deployed directory (or replace `.venv` with the evaluation venv):

```bash
.venv/bin/python benchmark_cpu.py --micro --repeat 3 --samples 100 --output benchmarks/results/arm-micro.json
```

Runs paired baseline/candidate in alternating order with deterministic FP32
vectors: 3k/10k/50k face rows, sparse and all-match cases, duplicate photo IDs;
also compares 100-face serialization. Asserts exact results on every iteration.
This measures in-memory math/Python only. It is NOT face-recognition accuracy,
index throughput, HTTP latency or an ARM substitute. Baseline paths remain in code.

## Offline Production Pipeline

Use a private directory outside git (or ignored `benchmarks/datasets/`) containing
permissioned media and a manifest. Do not put real identity labels in source control.
Paths must stay within the manifest directory or explicit `--media-root`.

```json
{
  "labeled": true,
  "photos": [
    {
      "id": "photo-001",
      "path": "photos/001.jpg",
      "faces": [{"identity": "guest-01", "bbox": [30, 40, 80, 95]}],
      "person_count": 1,
      "tags": ["low_light"]
    }
  ],
  "queries": [
    {"id": "query-001", "path": "queries/001.jpg", "identity": "guest-01", "tags": ["profile"]},
    {"id": "unknown-001", "path": "queries/unknown.jpg", "identity": null}
  ]
}
```

Use pseudonymous identities. Annotate bounding boxes as `[x,y,width,height]` AFTER
the production decode/EXIF/draft/1280px resize, never guessed original dimensions.
Person count includes people without visible faces. `labeled:false` explicitly
marks accuracy NOT MEASURED and omits label requirements.

```bash
.venv/bin/python benchmark_cpu.py --manifest /srv/orbit-eval/test/manifest.json --variant baseline --photo-concurrency 3 --threads 2 --repeat 3 --output benchmarks/results/arm-baseline.json
.venv/bin/python benchmark_cpu.py --manifest /srv/orbit-eval/test/manifest.json --variant candidate --photo-concurrency 3 --threads 2 --repeat 3 --output benchmarks/results/arm-candidate.json
```

Run baseline/candidate in reversed order for another pair if results vary. Candidate
enables both small optimizations; use the synthetic runner to isolate each one.
Run with the same library environment and CPU limits as the actual service, while
it is idle; record contention with archive separately. Do not change live service
thread settings or launch a second live index during a clean CPU measurement.

The runner uses actual `process_index_job`, production decode/inference/NanoDet,
and ASGI `/v1/search` with a mock snapshot callback. Photo reads use local disk;
completion stays in RAM. Each query measures a cold cache fill then warm reuse.
No `.env`, production endpoints, real Drive downloads or DB writes are used.
Model startup/warmup are separate; actual input-shape reallocations remain measured.
Peak RSS is process high-water mark, NOT per-stage allocated memory. CPU utilization
is process CPU/wall seconds: 200% means two fully occupied cores. NumPy build and
thread environment, OpenCV build, affinity, model checksums and source hashes are
captured. Windows/Intel results do not establish ARM instruction/backend behavior.

Output: JSON plus flattened CSV. Reports contain aggregate metrics and a dataset
fingerprint, not paths, identities, photo IDs, matches, boxes or embeddings. Raw
results are git-ignored. Inspect sanitized summaries before publishing them.
Retain per-run results, sample counts, errors and throughput. `requests_per_second`
counts all completed requests, including errors; never interpret it as successful
throughput when `search_errors` is nonzero. Index throughput is null if publication
failed. All failures block rollout until investigated.

## Quality and ARM Matrix

Use >=500 diverse wedding photos and independent positive/unknown queries.
Repeat at whole-gallery scales 500/1,000/3,000. Keep validation and final test
identities separate; never tune thresholds against the test set.

- Detection: greedy one-to-one box matching at IoU >=0.5; TP/FP/FN and recall.
- Face identity: same fixed Balanced threshold against every detected face;
  one-to-one ground-truth assignment, count unmatched/wrong-identity positives and
  all missed identity faces, including missed detections.
- Retrieval: best match per photo; photo TP/FP/FN, macro precision/recall,
  thresholded Precision@5/Recall@5 (unreturned slots are misses; denominator is
  min(5, gallery photos)), unknown-query false-accept and positive-query miss rate.
- Solo: confusion against true person count, not just visible face count.
- Slices: `small_face`, `profile`, `low_light`, `backlight`, `crowd`; annotate photo
  and query tags. Empty slices return null rates, not perfect scores.
- Candidate must preserve outputs; synthetic exact parity and aggregate equality
  do not replace a labeled test. Current runner checks repeated-run exact parity
  in RAM; cross-process A/B comparison uses aggregate metrics, not saved biometrics.

Keep job concurrency 1 and test `(photo concurrency, OpenCV threads)`:
`(3,2)`, `(1,2)`, `(2,1)`, `(1,1)`. Run both variants for each profile, 3+ repeats.
The runner always uses one job; no model pool is introduced. Then separately test
BLAS/thread caps on ARM as controlled experiments if runtime information indicates
oversubscription. Do not assume `cv2.setNumThreads()` controls OpenBLAS.

Later resize experiments 960/1280/1600, alternate runtimes and quantization are
NOT implemented here. They change the quality risk and require the PRD gates.

## End-to-End and Overload Design

Offline measurements intentionally exclude Drive/Fly/Turso. On approved staging:
measure sync-to-ready and client-search-to-response separately with metrics enabled.
Use fresh thumbnails, stale thumbnails, original fallback, warm/cold OAuth,
unchanged sync, one changed photo, interrupted/retried index and cache eviction.
Collect worker stage timing plus Hono DB write time, fallback counts/bytes, callback
payload size, HTTP errors/timeouts and CPU/RSS from the actual systemd process.
Do not export raw journals containing media IDs/URLs; extract aggregate fields.

Test single queries then 2/5/10 simultaneous queries while indexing, also archive
idle vs active. Report arrival pattern, queue wait, successful requests/sec, failed
requests, p50/p95 and memory. Existing `load_test.py` supports isolated localhost
bursts with real inference, but uses repeated synthetic embeddings and a model pool;
use `--instances 1 --threads 2` for the production-like starting point. Its memory
helper is Windows-only; use service/process RSS on Ubuntu. It does not measure
simultaneous indexing or quality. No production load test is automatically run.

Acceptance targets must be agreed after the ARM baseline. Require no unexplained
quality loss or correctness failures, no new capacity errors, and consistent p95/
throughput results across repeats. Production go/no-go remains explicit.
