# Photo Match Speed — Measurement Runbook

Operational procedure for the two performance dials shipped by the
[Photo Match Progressive Loading and Speed plan](plans/2026-08-15-001-perf-photo-match-progressive-loading-plan.md).

**Why this document exists.** Every unit of that plan is implemented and merged, but
its two speed levers ship **off**. The plan gates both on device measurements that
cannot be taken from a development machine: they need a real trip of ~100 uncached
clusters, a cold cache, and the project's Google Places quota page. This runbook is
how those measurements get taken and what to do with them.

---

## Prerequisites

Do these once, in order, before any measurement.

1. **Apply migration `0058_photo_import_entitlement_guard.sql`.**
   Until it runs, `read_photo_import_entitlement` selects a column that does not
   exist, the read fails, and **every `suggest-places` request returns a
   header-less 503**. The endpoint is dead, not degraded. The migration also adds
   a trigger blocking client writes to the subscription and usage columns, so
   review it before applying.

2. **Deploy the backend before the client reaches users.** The backend units are
   backward compatible with the current sequential client, but the client
   concurrency change must not arrive before the bounds and entitlement
   enforcement are live.

3. **Use a premium test account**, or a free account whose import is unconsumed.
   The free tier is now enforced server-side for the first time; a free account
   that already imported will be gated at 402 unless the grandfather pass has run
   on that device.

4. **Confirm replica count is 1.** Both the rate limiter and the module-level
   concurrency bounds are **per-process**. A second uvicorn worker or replica
   multiplies the effective request limit _and_ the outbound fan-out to a metered
   API together. Every number below assumes one process.

---

## The two dials

Both ship at their pre-plan values, so merging changed no runtime behavior.

| Dial                              | Where                                                   | Ships at | Target | Rolls back via                  |
| --------------------------------- | ------------------------------------------------------- | -------- | ------ | ------------------------------- |
| `VISION_MAX_CONCURRENT_REQUESTS`  | backend env                                             | `5`      | `15`   | env + restart                   |
| `SUGGESTION_DISPATCH_CONCURRENCY` | `mobile/src/services/photoImport/suggestionDispatch.ts` | `1`      | `3`    | **EAS update, no native build** |

`15` is the single-wave value: a batch is 5 clusters × up to 3 images = 15 images,
so at 5 a batch costs three sequential concurrency waves. `3` is
`MAX_SUGGESTION_DISPATCH_CONCURRENCY`, the widest client pool that stays inside the
backend's 5/second burst cap.

Raise them **in step**. Cutting the vision wait shortens the window the concurrent
search phase hides behind, so the search bound becomes the next constraint. If you
raise client concurrency without raising vision, you buy less than the numbers
suggest.

---

## The three measurement points

The plan asks for three points so concurrency is not credited with the earlier
units' win. Because both levers are dials rather than code paths, you can reach all
three from the **merged branch** — no checking out intermediate commits.

| Point                  | How to reach it                                                            | What it isolates                            |
| ---------------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| **A — baseline**       | `git checkout main` (pre-plan), build, measure                             | the "before"                                |
| **B — after U5 + U12** | merged branch, `VISION_MAX_CONCURRENT_REQUESTS=15`, client concurrency `1` | preparation pipelining + single-wave vision |
| **C — after U6**       | point B, plus `SUGGESTION_DISPATCH_CONCURRENCY=3`                          | concurrency's own contribution              |

> Measuring only A and C would credit concurrency with the pipelining win, which is
> expected to be the larger of the two. Point B is the one that makes the "at least
> 30% below B" criterion meaningful.

### Cache control is mandatory

The persistent place cache means **a trip yields exactly one cold run**. Three trips
cannot supply nine cold datasets. Either:

- clear the persistent place-cache rows **and** the on-device suggestion cache
  between runs, **or**
- use nine distinct cold trips.

State which you used. A run is admissible only when its L2 hit rate is below a
threshold you name in advance, and **every latency number must be reported with its
cache composition**. A fast run on a warm cache is not a fast run.

### Ranking baseline — capture this first

Capture the top-ranked place per cluster on **pre-plan `main`** for the benchmark
trips, using `backend/scripts/eval_place_matcher.py`. Comparing concurrency levels
within already-changed code cannot detect a regression the changes themselves
introduced. `main` is still pre-plan until this branch merges, so this is still
capturable — but not after.

---

## Where the numbers come from

**Backend**, one structured line per request, log event `place_matcher_phase_metrics`:

| Field                                                                                | Use                                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `phase_ms.search` / `.vision_wait` / `.enrichment` / `.backfill`                     | the phase split                                         |
| `cache.l1_hits` / `.l2_hits` / `.single_flight_waits` / `.google_calls`              | cache composition; sums to lookups attempted            |
| `outbound.peak_concurrent`, `.requests_per_second`, `.by_method`                     | the quota comparison, in requests per minute per method |
| `retries.rate_limited` / `.slot_unavailable` / `.circuit_open` / `.budget_exhausted` | leading indicators                                      |
| `vision.total_ms`, `vision.null_rate`, `vision.null_reasons`                         | the vision half, and the regression watch               |

**On `vision_wait` vs `vision.total_ms` — these are different numbers and the
distinction decides the vision dial:**

- `phase_ms.vision_wait` is the **residual** wait vision adds _on top of_ search,
  because the two run concurrently. Reading only this **under**-credits vision.
- `vision.total_ms` is **total** vision wall time. Reading only this
  **over**-credits it, since much of it hides behind search.

Use the **residual** to decide whether widening vision is the right first lever
(KTD16's ordering claim). Use the **total** to size the bound once you have.

**Client**, on `photo_import_suggestions_completed`:
`time_to_first_suggestion_ms`, `wall_clock_ms`, `cache_hit_rate`,
`peak_in_flight_batches`, `mean_in_flight_batches`, plus the existing
`api_p50_ms` / `p95` / `p99`.

> Two population caveats for anyone reading dashboards across this release:
> `failed_chunks` was **always 0** before this work (it read a stale closure), and a
> rate-limited run now emits **completion as well as an error**, with a lower
> suggestion count and a failure count that population never carried.

---

## Exit criteria

Evaluate all nine. The relative and ranking criteria must hold at point C.

| Criterion                         | Target                                                             |
| --------------------------------- | ------------------------------------------------------------------ |
| Time to first suggestion          | under 10s from entering the suggestions phase                      |
| Total wall-clock matching time    | at least 50% below point A                                         |
| Concurrency's own contribution    | at least 30% below point B                                         |
| Absolute wall-clock, largest trip | stated and accepted before release, not merely relative            |
| Failed-cluster count              | no higher at the chosen concurrency than at concurrency 1          |
| Top-ranked place per cluster      | **identical to pre-plan `main`** at every concurrency level tested |
| Vision-null rate                  | no higher at the chosen concurrency than at concurrency 1          |
| Batch time ratio                  | below 1.3× the concurrency-1 batch time                            |
| Peak request rate per method      | below the project's Google Places quota, compared in req/min       |

**If concurrency does not clear its own 30% criterion, ship
`SUGGESTION_DISPATCH_CONCURRENCY = 1` and keep everything else.** The code ships
either way; the default is the lever. This is the plan's own instruction, not a
fallback.

### Stop rule

Batch time ratio is the general signal and works without visibility into Google's
quota. Ordered leading indicators:

1. `retries.rate_limited` — rate pressure
2. batch time ratio
3. pool wait time
4. `vision.null_rate`

Failed-cluster count is **lagging and coarse** — a gate, not a signal.

`retries.slot_unavailable` is the specific signal that **our own** concurrency bound,
not Google and not the connection pool, is what callers are waiting on. A non-zero
count there means raise `PLACES_MAX_CONCURRENT_REQUESTS_PROCESS`, currently 15.

---

## The open question this cannot answer

**The project's Google Places per-method quota is unknown.** Google publishes no
numeric limit for Places API (New); limits are per method per project and must be
read from the Cloud console. Read it, and compare against measured
`outbound.requests_per_second × 60` per method. This is a Definition-of-Done item
and the only exit criterion that requires a source outside the repo.

Sizing constraints already encoded, for reference when tuning:

```
circuit breaker threshold (8 per 10s)
        <  process ceiling (15)  <  private pool size (20)
```

Below the pool so pool-exhaustion 503s stay rare rather than becoming the
enforcement mechanism; above the breaker threshold so a fully throttled wave can
still trip it — which it could never do if fewer calls than the threshold could be
in flight at once. A test pins this relationship; changing one constant without the
others will fail it.

---

## Manual verification (independent of the numbers)

Do this on any build, dials off or on:

- Open an already-imported trip from trip detail. A progress indicator with a count
  appears **immediately**.
- A pending row renders for **every** location — not just the ones in the live
  batch.
- Rows resolve **in place**: nothing reorders, nothing disappears mid-scroll.
- Same-place cards merge **once**, only after matching completes.
- Resolved cards are confirmable while others are still matching.
- **No location shows a failed card while its lookup is still running.**
- Repeat on a trip containing two locations at the same venue.
- Background the app mid-import and return: dispatch pauses and resumes without a
  burst, and nothing is painted as failed while paused.

---

## Release watch list

Rate-limit retry count · cache composition · vision-null rate · failed-cluster count
· pool wait time · `retries.slot_unavailable` · photo-import gate-hit and
paywall-view rate · free-import consumption · conversion-event volume against its
captured baseline (see the Telemetry section of
[photo-import.md](photo-import.md)) · **deployed replica count**.

Replica count appears on this list three times over: the rate limiter, the
module-level concurrency bounds, and the in-process enrichment cache merge are all
per-process. Changing it multiplies request limits and outbound fan-out together.
