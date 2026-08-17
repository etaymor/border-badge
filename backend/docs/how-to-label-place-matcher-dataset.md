# How to Label a Place-Matcher Eval Dataset

This turns one real photo import into a labeled dataset the eval harness can
score — so the photo-match-quality fixes (recall levers C1/C5/C6, ranking levers
C3/C4) are **measured** instead of guessed. Most fields come pre-filled from the
diagnostic traces; the manual effort is ~15–30 clusters of place lookups plus a
small amount of rating backfill.

> **Read the decision gate first** (step 5b). The single most important number
> this produces is the **`expected: none` fraction** — how much of the ~50%
> no-match rate is legitimately place-less vs. an addressable matcher miss.
> Report that before committing to any cost-adding recall lever.

---

## 0. Prerequisites

- A dev/staging build of the backend you can run a real import against.
- Google Maps (web) for looking up `place_id`s and ratings.
- The eval harness: `backend/scripts/eval_place_matcher.py`.
- The schema reference: `backend/docs/place_matcher_eval_dataset.sample.json`
  (also documented in the eval script's module docstring).

Dev-env note (poetry path gotcha): if `poetry` is not on your PATH, invoke it by
full path, e.g.
`/Library/Frameworks/Python.framework/Versions/3.12/bin/poetry run python scripts/eval_place_matcher.py ...`.

---

## 1. Capture — run a real import with diagnostics on

Set the flag and run an import (the more varied the trip, the better — aim for
the kind of trip that exhibits the ~50% miss rate):

```bash
PLACES_DIAGNOSTICS=true poetry run uvicorn app.main:app --reload --host 0.0.0.0
```

Then trigger a photo import from the app against that backend. Each cluster emits
**one** structured trace line, logged twice for convenience:

- a structured-sink line: `logger.info("place_matcher_diagnostic_trace", extra={"trace": {...}})`
- a plain single-line JSON line: `{"place_matcher_diagnostic_trace": {...}}`

Collect the JSON lines from the server log. The greppable event name is
`place_matcher_diagnostic_trace`:

```bash
grep place_matcher_diagnostic_trace server.log \
  | sed 's/.*place_matcher_diagnostic_trace": //;s/}$//' > traces.jsonl
# (or extract via your log tooling; each line is one cluster's trace dict)
```

### What each trace already contains

| Trace field | Meaning |
| --- | --- |
| `cluster_id` | Stable id for the cluster. |
| `centroid` `{latitude, longitude}` | **Full precision** — paste into Google Maps to find the visited place. |
| `photo_count`, `density` | Context for interpreting recall. |
| `radii_searched`, `largest_radius_used`, `stopped_early` | Did the tiered search stop early (C1 signal)? |
| `raw_count_per_radius` | Raw (pre-filter) results per radius. |
| `raw_candidates` | **The full pre-filter candidate world** — every place at every radius. This becomes the dataset's `places[]`. |
| `quality_count_after_filter` | How many survived the quality filter. |
| `drop_counts` `{search, enrich}` | Per-reason drops, phase-attributed. `low_reviews` is structurally 0 in the `search` phase (the wide pass omits `userRatingCount`); a nonzero `low_reviews` only appears under `enrich`. |
| `vision` `{had_images, category, business_name_candidates, confidence, text_search_triggered, text_search_hit}` | The SIGNAL picture. `had_images=false` means no vision context at all (see U16). |
| `finalists` `[{name, place_id, distance_m, rating, review_count}]` | Top-3. `rating`/`review_count` may be `null` for name-match-locked or enrichment-skipped clusters — that is **expected, not a bug** (KTD3). |
| `top_finalist_name_matched_vision` | Whether the #1 finalist matched detected signage. |
| `final_suggestion_count`, `outcome` | `outcome` is one of `matched` / `empty_no_candidates` / `empty_after_filter` / `empty_after_text_search`. |

The trace's `outcome` already classifies the **empty** failure classes on its
own:

- `empty_no_candidates` → **RECALL** (nothing was fetched — C1/C5/C6).
- `empty_after_filter` → **FILTER** (fetched, then dropped — check `drop_counts`).
- `empty_after_text_search` → text rescue fired and still found nothing.
- `matched` but the labeled correct place is not the top suggestion → **RANKING**
  (C3/C4) — only knowable *after* you add the label in step 3.

---

## 2. Convert — fold each trace into the dataset schema

The dataset is a JSON array; each element is one cluster. Map trace → row:

```jsonc
{
  "id": "<cluster_id>",
  "cluster": {
    "centroid": { "latitude": <centroid.latitude>, "longitude": <centroid.longitude> },
    "time_hint": "<optional>",      // from the cluster if available
    "start_time": "<optional ISO>",
    "end_time": "<optional ISO>"
  },
  "places": [ /* trace.raw_candidates verbatim — the full candidate world */ ],
  "vision_results": [ /* the cluster's per-photo vision results, if you have them */ ],
  "expected_place_id": "<filled in step 3>"
}
```

`places[]` **must be the full candidate world** (`raw_candidates`), not the
finalists — the `--pipeline` mode treats `places[]` as the entire world it can
fetch, so a finalists-only list makes `candidate_recall` meaningless.

---

## 3. Label — add `expected_place_id` (or `expected: none`)

For each cluster, open the `centroid` in Google Maps and decide what the user
actually visited:

- If there is a clear visited place, find its Google `place_id` and set
  `"expected_place_id": "<place_id>"`. If that place is already present in
  `places[]` (by `id`), great. If it is **not** present (the matcher never
  fetched it — an `empty_no_candidates`/RECALL cluster), see step 4b.
- If there genuinely was no notable place (a food close-up, a beach, a friend's
  apartment, a generic street), set `"expected": "none"` and omit
  `expected_place_id`. Rows with `expected: none` are excluded from the
  recall/ranking metrics (they are not addressable matcher misses) but you
  **must still count them** for the gate in step 5b.

~15–30 labeled clusters is enough to see the signal.

---

## 4. Two manual backfill steps the metrics depend on

The wide Nearby/Text field mask strips `rating`/`userRatingCount` to keep the
bulk call off the Enterprise SKU, so `raw_candidates` carry **null ratings**
except for finalists (which U4 backfills from enrichment). This matters because
the two metrics read different fields:

- `candidate_recall` checks only `expected_place_id ∈ {p.id}` — **clean on
  null-rated candidates.**
- `e2e_top1` runs the real distance ranking, which reads `rating`/
  `userRatingCount`. On null-rated candidates the review/rating/fame terms
  collapse to zero, so `e2e_top1` would measure a **rating-blind** pipeline that
  does not match production.

### 4a. Ratings for ranking evaluation (every non-finalist you want ranked)

For any **non-finalist** candidate in `places[]` you want the ranking eval to
judge fairly, fetch its `rating` and `userRatingCount` from Google Maps and add
them to that `places[]` entry. Finalists already carry backfilled ratings (U4).
Without this, `e2e_top1` ranks rating-blind and is **not comparable to
production**.

### 4b. Inject the expected place for RECALL clusters (`empty_no_candidates`)

An `empty_no_candidates` cluster has `raw_candidates: []` — the place was never
in the captured world, so the trace alone **cannot** test "would a wider radius
(C1) have fetched the right place." To validate C1 on these clusters, manually
add the expected place's **full record** — `id`, `displayName`, `location`
(lat/lng), `types`, `rating`, `userRatingCount` — into that cluster's `places[]`,
positioned at its real coordinates. Then a widened-radius `--pipeline` run (or
`--stop-threshold`) can actually reach it.

> **Limitation to state plainly in your results:** without this injection, C1 —
> the diagnostic's most-probable recall contributor — is validated only on
> synthetic samples + the `--simulate-text-rescue`/`--simulate-type-filter`
> sims, never on the real empties it targets.

---

## 5. Measure & interpret

### 5a. Run the eval

```bash
poetry run python scripts/eval_place_matcher.py \
  --dataset <your-dataset.json> --pipeline --no-search

# Lever-specific sims (see U5):
poetry run python scripts/eval_place_matcher.py --dataset <f> --pipeline --no-search --simulate-type-filter   # C5
poetry run python scripts/eval_place_matcher.py --dataset <f> --pipeline --no-search --simulate-text-rescue   # C2
poetry run python scripts/eval_place_matcher.py --dataset <f> --pipeline --no-search --stop-threshold 8       # C1
```

Read the three pipeline numbers:

- **low `candidate_recall`** ⇒ the right place isn't being fetched ⇒ fix
  **C1** (raise `--stop-threshold` / widen radii) / **C5** (allowlist types,
  via `--simulate-type-filter`) / **C6** (sparse radii).
- **high `candidate_recall` but low `e2e_top1`** ⇒ the place is fetched but
  doesn't surface ⇒ fix **C3** (review gate) / **C4** (first-pass weights, via
  the weight search without `--no-search`).
- **`avg_nearby_calls` / `avg_text_search_calls`** ⇒ the cost side of each lever.

### 5b. The decision gate — report the `expected: none` fraction FIRST

Before committing to any cost-adding recall lever (C1/C2/C5), report:

```
addressable_empty_share =
  (# clusters with outcome=empty_* AND expected_place_id set)
  / (# clusters with outcome=empty_*)
```

i.e. of all the empty/no-match clusters, what fraction had a real place that the
matcher *should* have found vs. were legitimately place-less (`expected: none`).

- If a **large** fraction of the ~50% is legitimate empties, raising radii buys
  nothing on those clusters — the cost-lever math shifts and the levers should be
  **scoped down**, not shipped on the assumption the whole 50% is recoverable.
- If most empties are **addressable** (a real place that wasn't fetched/ranked),
  the recall levers are justified — size them to the addressable share.

This one fraction is the cheapest, highest-leverage number the first labeled pass
produces. Do not skip it.

---

## 6. Higher-fidelity alternative (if backfill proves error-prone)

The flow above (offline sim + manual backfill) was chosen for low one-time
complexity. If the first labeled pass shows the manual rating backfill (4a) or
the empty-cluster injection (4b) is error-prone — or C1 stays un-validated on
real empties — switch to **dual-radius capture**: run the diagnostics import
once and emit the candidate world **twice per cluster**, at current radii and at
proposed-widened radii (both behind `PLACES_DIAGNOSTICS`, off in production).
That measures C1/C5/C6 on **real** Google responses (correct ratings, no manual
injection, no geometric-sim circularity) at the cost of doubled Nearby calls in
a single user-run diagnostic import. See the plan's *Alternatives Considered*
(ADV-7) for the tradeoff.
