# Photo Match Quality — Diagnostic

**Status:** Diagnostic only. No code changes have been made. This documents likely causes of
two reported quality problems and a measurement plan to confirm them before any fix.

**Branch context:** `less-nearby` has, until now, been a Google Places **cost**-reduction
effort. Some of the cost optimizations have quality side-effects called out below (notably
C4).

## The two problems

1. **~50% of photos never get matched** to a real place.
2. **Some photo clusters silently never appear** on the Photo Trip Suggestions screen.

All `file:line` references below were read and verified directly against the current branch,
not inferred.

---

## Part A — The ~50% match rate: ranked likely causes

A cluster returns **zero usable suggestions** for one of four reasons. Telling them apart
**requires real data** (see Part D); the ordering below is by **code-analysis confidence**,
not measured impact.

- **RECALL** — the right place was never fetched from Google.
- **FILTER** — it was fetched, then dropped by a quality gate.
- **RANKING** — it was fetched and kept, but didn't surface in the top 3.
- **SIGNAL** — the matcher had no vision/text signal, so it degraded to GPS-only.

### Verified per-cluster pipeline

1. Tiered Nearby search, density-adaptive radii, **accumulate until ≥5 quality places** or
   radii exhausted — `backend/app/services/place_matcher/_matcher_search.py:82-147`.
2. Quality filter applied as results arrive — `_matcher_search.py:494-550`.
3. Optional Text Search, **only if vision detected a business name not already present** —
   `_matcher_cluster_processing.py:129-199`.
4. First-pass distance ranking → top 3 finalists — `_matcher_ranking.py`,
   `_matcher_cluster_processing.py:227-258`.
5. Enrich finalists with live rating, re-gate by review count, backfill, re-rank —
   `_matcher_cluster_processing.py:260-326`.
6. The backend **always** returns one `ClusterSuggestion` per cluster, with `places: []` when
   empty. It never silently omits a cluster — so the missing-cluster bug is **client-side**
   (Part B).

### Ranked causes

**C1 — RECALL: tiered search stops at 5 quality places before reaching the visited venue.**
`_matcher_search.py:129-145`. Each radius's results are fully absorbed before the threshold is
checked (milder than "stop at first hit"), **but** with 20–80 m indoor GPS drift the
actually-visited place can sit one tier out (e.g. 110 m) while 5 nearer places already
satisfied the probe at 15/50 m. Once 5 accumulate, the outer radius is never searched and that
candidate is never fetched. `MIN_QUALITY_RESULTS_BEFORE_STOP = 5` and the radii are
**hardcoded** (`constants.py:21-61`), not tunable. *Most probable single contributor.*

**C2 — SIGNAL: no vision signal → GPS-only matching.** Text-search rescue fires **only** when
vision extracts a non-generic business name (`_matcher_cluster_processing.py:160-167`;
`has_business_name` in `photo_vision/classifier.py`). Indoor shots, food close-ups, people,
dark nightlife, and non-Latin signage without romanization produce no name → no rescue. If the
client sends no vision images for a cluster, there is zero vision context. GPS-only matching
inherits every C1/C4 weakness.

**C4 — RANKING: the cost-saving wide field mask strips rating/review signals.**
`WIDE_FIELD_MASK` (`constants.py:362-372`) intentionally drops `rating`/`userRatingCount` for
cost. First-pass finalist selection is therefore distance-dominated (distance + dwell + vision
+ name-match). A closer tourist trap can beat the slightly-farther place actually visited and
consume a top-3 slot. Enrichment only re-ranks *within* the 3 finalists, so a correct place
that never reached the top 3 is unrecoverable. **This is a direct side-effect of the cost
work** — a quality/cost coupling worth surfacing.

**C5 / C6 — RECALL: allowlist and sparse-density gaps.** The `includedTypes` allowlist is at
the API's 50-type max (`constants.py:167-226`); a place whose types don't intersect it is never
returned. Known gaps: `place_of_worship` (Table B — regional temples/shrines tagged only that
way), `comedy_club`, `funfair`, `bookstore`/`antique_shop` (only generic `store`). Separately,
`DENSITY_SEARCH_RADII["sparse"] = [100, 250]` (`constants.py:49-53`) skips the 15 m tier, so a
venue at 30–80 m can be missed in a sparse area. Both likely small but real.

**C3 — (mostly ranking, not a recall killer): the review-count gate.** `MIN_REVIEW_COUNT = 5`
with an `INSTITUTIONAL_TYPES` exemption (`constants.py:325-350`). **Important correction:** the
gate is only applied where `userRatingCount` is present (`_matcher_search.py:499, 533-537`). The
wide pass omits that field, so the gate does **not** filter during search — it only re-applies
to the top-3 enriched finalists (`_matcher_cluster_processing.py:279-312`), and a dropped
finalist is **backfilled** from the first-pass order. Worst case is "a new/small real place
ranked top-3, then got demoted below a backfill" — a ranking degradation, rarely a true
zero-result. A prior analysis pass overstated this as a heavy hard filter; the code does not
support that.

**C7 — FILTER (low impact): non-tourist secondary-type filter.** `_matcher_search.py:505-517`.
Already softened (a museum in a historic bank stays recallable). Residual risk only when a real
venue has a generic primary type plus a blocklisted secondary type.

### Takeaway

The **recall ceiling** is C1 + C2 (+ C5/C6 at the margins). The **surfacing ceiling** is C4
(+ C3). No numeric impact split should be committed until Part D produces measured per-cluster
outcomes.

---

## Part B — Missing clusters on the Suggestions screen

The backend always returns one record per cluster (`places: []` when empty), so any
disappearance is **client-side**. Verified drop points, ordered by likelihood of explaining the
report:

**B1 — Transient API/chunk failure renders uncached clusters as "No place found."**
`mobile/src/screens/photos/usePlaceSuggestions.ts:319-341`. On network error / timeout / unknown
error the `catch` shows an Alert, `setCachedSuggestions` already holds only the *cached* subset,
and the uncached clusters get no suggestion. After `fetchingSuggestions` clears they render as
photos-only "No place found nearby" cards — **indistinguishable from a real no-match**, even
though it was a transient failure. With chunked requests, one failed chunk silently degrades its
clusters. *Most likely explanation.*

**B2 — Venue-split / re-segmentation id↔cache mismatch.** Splitting mints `__venue_N` ids
(`mobile/src/services/photoImport/photoClustering.ts:361-373`); cache is keyed by `cluster_id`
with a `location_key` geohash fallback (`photoCacheDbSuggestions.ts:161-219`). If a re-import
reshapes the split so the centroid shifts across a geohash boundary, **both** the id lookup and
the location fallback miss → the cluster looks uncached and must be re-fetched; if that fetch
also fails (B1), it shows empty.

**B3 — Stale-request race can drop the current candidate's results.**
`usePlaceSuggestions.ts:176-181` and `:282-289` return `undefined` when `isStaleRequest()`. The
`try/finally` in `useWorkflowNavigation.ts:153-163, 235-245` correctly clears
`fetchingSuggestions`, so the loading flag does **not** get stuck (a theory that was checked and
ruled out). But on rapid candidate switching the stale guard can discard results for what becomes
the active candidate, leaving its clusters empty until a manual re-entry.

**B4 — `merged-suggestion` null path silently drops a card.**
`mobile/src/screens/photos/photoImportHelpers.ts:79-83` returns `null` if the primary cluster is
missing from the suggestion map; `useClusterItems.ts:132-135` then pushes nothing. A race (one
cluster dismissed mid-merge) makes a whole merged card vanish with only a dev-only
`console.error`.

**B5 — Photos-only clusters hidden during fetch (by design, fragile).**
`useClusterItems.ts:138-146` withholds suggestion-less clusters until `fetchingSuggestions` is
false. Correct in the happy path; the fragility is coupling "is this a real no-match?" to a
global loading flag.

**B6 — Auto-dismiss when all of a cluster's photos were already uploaded.**
`mobile/src/services/photoImport/photoClusteringDisplay.ts:331-337`. Legitimate behavior, but
indistinguishable to the user from a bug; deserves a visible affordance rather than a code fix.

### Fix direction

Every non-dismissed cluster should **always** render a card, with three honest terminal states
the UI currently conflates: `matched` · `no-place-found` (real empty) · `lookup-failed`
(transient — offer retry). B1/B3 become "lookup-failed → retry" instead of silent "no place."
B4 gets a point fix (degrade to individual cards) with a reproducing test.

---

## Part C — Per-cluster diagnostics (design)

Goal: one real import emits enough structured per-cluster data to classify every zero-result as
RECALL / FILTER / RANKING / SIGNAL **without** hand-labeling every cluster.

**Backend — one structured JSON trace per cluster** (behind a `PLACES_DIAGNOSTICS=true` flag, in
`_matcher_cluster_processing.py`):

- `cluster_id`, centroid, photo count, `density`, `radii_searched`, `stopped_early`,
  `largest_radius_used`.
- `raw_count_per_radius`, `quality_count_after_filter`, and **filter-drop reasons tallied**
  (`non_tourist`, `closed`, `no_name`, `low_reviews`) — reuse the existing `logger.debug` drop
  sites in `_filter_low_quality_places`, just aggregate counts.
- `vision`: `had_images`, `category`, `business_name_candidates`, `confidence`,
  `text_search_triggered`, `text_search_hit`.
- `finalists` (top 3: name, place_id, distance_m, rating, review_count), `final_suggestion_count`.
- `outcome`: `matched` | `empty_after_filter` | `empty_no_candidates` |
  `empty_after_text_search`.

That single trace separates the failure classes for empty clusters on its own:
`empty_no_candidates` → RECALL; `empty_after_filter` → FILTER; finalists present but wrong top →
RANKING; `had_images = false` or no name → SIGNAL.

**Mobile — surface the terminal state** (ties to Part B): tag each rendered cluster `matched` /
`no-place-found` / `lookup-failed` so failures are visible instead of a uniform "photos-only."

**Eval harness:** `backend/scripts/eval_place_matcher.py` already has a `--pipeline` mode
reporting `candidate_recall` vs `e2e_top1` vs `avg_nearby_calls`. The only missing piece is a
**real** dataset to feed it (Part D).

---

## Part D — How to produce a labeled dataset (future)

This turns the Part-A estimates into measured numbers and shows which fixes actually move the
needle. Most fields come pre-filled from the Part-C traces; manual effort is minimal.

1. **Capture:** run a real import on a build with `PLACES_DIAGNOSTICS=true`; collect the
   per-cluster JSON traces. Each already carries centroid, finalists, and outcome.
2. **Label minimally:** for each cluster, add `expected_place_id` (the Google place_id of the
   correct place, found via Google Maps) **or** mark `expected: none` when there genuinely was no
   notable place. ~15–30 clusters is enough.
3. **Convert:** fold traces + labels into the existing
   `backend/docs/place_matcher_eval_dataset.sample.json` schema (`cluster`, `places[]`,
   `expected_place_id`).
4. **Measure:** `poetry run python scripts/eval_place_matcher.py --dataset <file> --pipeline`
   → `candidate_recall` (recall ceiling) vs `e2e_top1` (ranking ceiling) vs cost/cluster.
5. **Interpret:** low `candidate_recall` ⇒ fix C1 / C5 / C6 (search). High recall but low
   `e2e_top1` ⇒ fix C3 / C4 (ranking).

A standalone step-by-step version of this should ship as
`backend/docs/how-to-label-place-matcher-dataset.md` alongside the diagnostics implementation.

---

## Part E — Remediation, split by cost impact (for later approval)

Nothing here is implemented yet.

### Set 1 — Free wins (no added Places API cost)

- **B1 / B3:** add a `lookup-failed` terminal state + retry; stop conflating transient failures
  with real no-matches. (`usePlaceSuggestions.ts`, `useClusterItems.ts`, `SuggestionsPhase.tsx`)
- **B4:** guard the merged-suggestion null path so a missing primary degrades to individual cards.
  (`photoImportHelpers.ts`, `useClusterItems.ts`)
- **B2:** verify `location_key` geohash precision matches clustering; widen the fallback if
  centroid drift defeats it. (`photoCacheDbSuggestions.ts`, `photoClustering.ts`)
- **C4 (partial, free):** improve first-pass ranking using already-fetched signals
  (vision / name-match / dwell) so fewer correct places fall out of the top 3 — tune existing
  config weights, no new API calls.
- **Diagnostics (Part C)** and the **how-to doc (Part D)** — pure observability.

### Set 2 — Cost-adding recall changes (opt-in, with estimates)

- **C1:** make `MIN_QUALITY_RESULTS_BEFORE_STOP` and the radii config-driven; raise the threshold
  / add a wider tier. Cost: ~+1 Nearby (Pro-tier) call per affected cluster, partly absorbed by
  the persistent cache once migration `0057` is applied.
- **C3:** make `MIN_REVIEW_COUNT` config-driven and lower it (e.g. 5 → 3). Cost: ~none; mild
  ranking tradeoff.
- **C2:** trigger Text Search rescue more often (e.g. on empty / low-confidence Nearby even
  without a vision name). Cost: +Text Search (Enterprise-tier) calls — the most expensive lever;
  gate tightly.
- **C5:** rotate a few higher-value types into the 50-type allowlist. Cost: marginal.

Each Set-2 item should be measured against the Part-D dataset **before/after**, keeping the
ranking eval gate at `top1=1.000 mrr=1.000`.

---

## Bug-fix workflow note

Per `CLAUDE.md`, each B-path fix must start with a **failing test that reproduces the bug**
before the fix. Backend changes must keep `pytest` + `ruff` green; mobile changes must keep
`npm test` + `lint` + `format:check` green.

## Open questions

- True impact magnitudes are unknown until Part-D data exists; Part A is ranked by confidence,
  not measured percentage.
- Whether the client reliably sends vision images for every cluster (C2) needs a quick check of
  `prepareVisionImagesBounded` / `mapClusterToApiPayload` during implementation.
