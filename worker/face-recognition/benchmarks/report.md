# Initial Optimization Results

Date: 2026-10-16. Status: local audit / opt-in candidates only. **No production
rollout. ARM performance and labeled wedding accuracy are NOT MEASURED.**

## Environment and Protocol

Windows AMD64, 16 logical CPUs, Python 3.13.7, OpenCV 5.0.0, NumPy 2.5.4.
Existing YuNet 2023mar, SFace 2021dec, NanoDet 2022nov artifacts/checksums,
thresholds, alignment and 1280px decode preserved. No database/schema changes.

Synthetic A/B: seed 20261016, 3 repeats, 30 calls per case per repeat, alternating
baseline/candidate order. Same normalized FP32 matrix and query. Exact output
assertion after every timed call. Table values are medians of the three run-level
p50/p95/throughput values, NOT pooled percentiles. Startup/fixture preparation is
excluded from operation timings. Process CPU includes parity checks, so it is not
a pure function CPU-cost estimate. Short microbenchmarks have scheduling noise.

Offline model smoke: 3 existing public portfolio images, one image reused as the
query, 3 repeats, jobs=1 / photo consumers=3 / OpenCV threads=2. Real production
indexing/NanoDet/search; local disk and mocked snapshot callback. No Drive/Fly/DB.
This tiny unlabeled fixture is a plumbing check, not a representative evaluation.

## Synthetic Before/After

| Operation | Baseline p50 / p95 ms | Candidate p50 / p95 ms | Baseline / candidate ops per second |
| --- | --- | --- | --- |
| Match 3k faces, 2% matching | 0.483 / 0.836 | 0.247 / 0.441 | 1,781 / 3,964 |
| Match 10k faces, 2% matching | 2.302 / 3.945 | 0.992 / 1.393 | 403 / 1,008 |
| Match 50k faces, 2% matching | 8.314 / 13.570 | 2.221 / 3.947 | 112 / 406 |
| Match 3k faces, all matching | 1.925 / 3.051 | 1.989 / 3.377 | 478 / 465 |
| Match 10k faces, all matching | 7.287 / 13.408 | 7.645 / 13.849 | 127 / 109 |
| Match 50k faces, all matching | 41.288 / 49.913 | 41.686 / 52.888 | 24.3 / 23.3 |
| Serialize 100 faces | 2.148 / 4.604 | 1.217 / 3.620 | 363 / 632 |

The initial unconditional filtered iteration regressed badly on dense results
(50k p50 about 41 -> 67 ms in the exploratory run). The final candidate uses the
old sequential iteration when at least half the rows pass the match threshold.
Dense cases still show overhead/noise, so this is not a universal win and the flag
remains OFF. Sparse results and single-normalization show local operation-level
improvements only; no claim about ARM or overall user-visible speed follows.

Peak RSS in this synthetic process reached 206 MiB across both variants. It is a
cumulative process high-water mark including generated fixtures, not a production
cache size or per-variant memory comparison. Per-case CPU figures are in JSON/CSV.
No model inference occurs in the synthetic run. Exact parity passed all cases.

## Real-Model Plumbing Smoke

| Metric (median across 3 runs unless stated) | Baseline | Candidate |
| --- | --- | --- |
| Index photos/sec | 5.515 | 5.338 |
| Per-photo total p50 ms, including wait | 319.667 | 316.936 |
| Per-photo total p95 ms | 543.141 | 560.443 |
| Cold-cache query latency ms | 411.737 | 434.988 |
| Warm-cache query latency ms | 418.208 | 406.320 |
| Peak process RSS, maximum MiB | 306.457 | 305.547 |
| Index CPU percent, 100% = one core | 185.650 | 182.850 |
| Index / query errors | 0 / 0 | 0 / 0 |
| Faces per completed index | 2 | 2 |
| Repeated-run exact parity | pass | pass |
| Retrieval accuracy | NOT MEASURED | NOT MEASURED |

Only one query per cache mode per run: its p50 and p95 are the same single value.
The table does not imply a meaningful search p95 distribution. Across this tiny
smoke, throughput/latency changes are mixed; there is no demonstrated pipeline
speedup. Baseline index detect p50 was 83.6-92.3 ms, wait p50 77.0-198.9 ms,
SFace embed p50 28.1-34.8 ms (face-positive samples), and person stage p50
59.6-80.1 ms. These local observations support measuring inference contention next,
not replacing models or changing small-face resolution.

## Commands and Artifacts

Run from `worker/face-recognition`:

```powershell
.\.venv-ml\Scripts\python.exe benchmark_cpu.py --micro --repeat 3 --samples 30 --output benchmarks/results/local-micro-final.json
.\.venv-ml\Scripts\python.exe benchmark_cpu.py --manifest benchmarks/smoke-manifest.json --media-root ../.. --variant baseline --repeat 3 --output benchmarks/results/local-cpu-final-baseline.json
.\.venv-ml\Scripts\python.exe benchmark_cpu.py --manifest benchmarks/smoke-manifest.json --media-root ../.. --variant candidate --repeat 3 --output benchmarks/results/local-cpu-final-candidate.json
.\.venv-ml\Scripts\python.exe -m unittest test_optimization test_worker test_embedding_cache test_person_detector test_drive_source test_benchmark_pool test_worker_processes
```

Each benchmark writes JSON and CSV; generated results are local and git-ignored.
Final JSON includes implementation hashes and library/build metadata. Earlier
`local-micro.json`, `local-micro-v2.json` and `local-cpu-baseline.json` are exploratory
iterations, not the final reported artifacts.

Verification: **67 Python tests passed**, including decode pixel parity, exact
matching at threshold boundaries/ties/duplicates/solo, normalization/filter parity,
timing isolation/privacy, cache behavior, Drive safeguards, process independence,
and nonzero grouped/interleaved NanoDet outputs. **27 Hono face-index tests passed**
(183 assertions), and `bun tsc --noEmit` in `server` passed. `git diff --check` passed.
The initial sandbox run failed filesystem/process tests due to Windows temporary
directory permissions; all passed when rerun with approved permissions.
No client code changed in this increment, so a client build/Playwright run was not
used as evidence for worker performance.

## Changes, Risks and Next Gate

- `main.py`, `engine.py`, new `telemetry.py`: opt-in stage timing; same processing.
- `embedding_cache.py`: default-off sparse match iteration with dense fallback.
- `main.py`: default-off single-normalization serialization; same stored values.
- `server/routes/face-index.ts`: optional DB write duration only; same SQL/guards.
- `benchmark_cpu.py`, `benchmark_metrics.py`, benchmark fixtures/docs: offline
  runner and aggregate accuracy/resource reporting; no service or DB access.
- `test_optimization.py`, `test_person_detector.py`: focused parity/metric/NanoDet tests.
- `.env.example`, `README.md`, `AUDIT_FINDINGS.md`: flags, audit, commands, rollback.

Regression risks: sparse/dense workload dependence, optional telemetry overhead,
FP32 boundary behavior (tested on local NumPy), and CPU/BLAS scheduling differences
on ARM. Existing partial-job loss, unbounded search admission, NanoDet contention,
callback JSON capacity and adapter edge cases remain documented follow-ups.

Next gate: run the four PRD concurrency profiles on the actual Ubuntu ARM64 2-vCPU,
12-GB machine with a permissioned labeled dataset; separately measure live Drive,
Hono/DB publication and concurrent indexing/search. Confirm no quality loss,
agree p95/throughput targets, then approve a limited canary. Until then retain the
defaults. Rollback is flags=0 plus idle restart; no index rebuild or migration.
