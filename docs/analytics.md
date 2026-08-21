# Analytics

Three tools, three questions. Which one a signal belongs in is decided by the
surface it happens on, not by who is asking.

| Surface | Tool | Answers |
| --- | --- | --- |
| Mobile app | PostHog (`mobile/src/services/analytics.ts`) | What do our users do in the app, and where do they drop off |
| Public web pages | Google Analytics (`gtag`, loaded nonce'd in `base.html`) | What do anonymous visitors do on a shared link |
| Cross-surface attribution | Postgres | Did a thing one user made cause something in someone else |

**Do not add PostHog to the public pages.** It would be a third copy of data
Postgres already holds, and anonymous page views would force a bad choice
between inflating PostHog person counts with drive-by traffic and emitting
profile-less events that behave unlike everything else in the project.

Backend PostHog (`backend/app/core/posthog.py`) exists for LLM and extraction
telemetry, which has no client to report it. It is not a general server-side
event bus, and it hashes user ids (`hash_user_id`) where mobile identifies
with the raw Supabase id — so backend and mobile events do **not** join on
person. Join on a resource id instead.

## Adding a mobile event

1. Add a typed helper to the `Analytics` object in
   `mobile/src/services/analytics.ts`. **Feature code never calls `track()`
   directly** — the helper is where camelCase props become snake_case ones and
   where derived values are computed, so a property means the same thing at
   every call site.
2. Event names are `snake_case`: `view_<screen>` for views, imperative for
   actions (`create_trip`), past tense for outcomes (`share_completed`),
   `<domain>_failed` for errors, and a feature prefix for families (`quiz_*`).
3. Properties are scalars only. Coerce optionals with `?? null` — never let
   `undefined` reach PostHog. Join arrays with `.join(',') || null`.
4. Screen views go in a plain `useEffect(..., [])`, not `useFocusEffect`:
   screens that push other screens would otherwise re-count on every
   back-navigation, and tabs would re-count on every switch.
5. Never emit free-text server messages, display names, session ids, photo
   URIs, or coordinates. Place and venue ids are hashed through
   `stableHashOrNull` (rule R27); our own resource ids (`quiz_id`, trip ids)
   stay raw, because they are the join keys.
6. Extend the partial `jest.mock('@services/analytics', …)` in any test whose
   module tree now calls a **new** helper name. Enriching an existing helper's
   props never breaks a `jest.fn()` mock; adding a name it does not have
   surfaces as "undefined is not a function".

## The Guess Where funnel

The one loop that spans all three tools. `quiz_id` is the join key throughout.

**Owner side — PostHog.**

```
passport_entry_card_shown        the slot rendered (guess_where | photo_sync)
  → view_guess_where_intro       entry_point says which of five entries
  → view_quiz_creation           initial_phase, permission, library freshness
  → quiz_creation_started        attempt_index, retry_from
  → quiz_created                 success
      ↘ quiz_creation_failed     thin_library | service_error | interrupted
      ↘ quiz_creation_abandoned  walked out mid-build
  → view_quiz_play → quiz_first_run_completed
      ↘ quiz_play_abandoned      how far they got before leaving
      ↘ quiz_play_failed         load | answer | complete | stalled
  → view_quiz_results → quiz_shared → quiz_share_initiated/completed
      ↘ quiz_share_failed
  → quiz_leaderboard_players_arrived
```

Two things worth knowing before reading these numbers:

- **`quiz_share_completed` is iOS-only by design.** Android resolves
  `sharedAction` the moment the sheet opens, so firing there would count every
  open as a completed share. Segment by platform or the funnel reads as ~0%
  Android completion.
- **Failure and abandonment are separate events on purpose.** A thin library
  is a gate-tuning problem — `dominant_reason` says whether the eligibility
  gate or the user's actual library killed the run. A walk-out at seventy
  seconds is a patience problem. Collapsing them would hide both.

`quiz_leaderboard_players_arrived` is the only owner-side signal in PostHog
that the loop closed, precisely because the guest half lives elsewhere.

**Guest side — Google Analytics**, from `backend/app/static/js/quiz-play.js`:
`quiz_start` (the denominator for everything after it), `quiz_answer` per
question, `quiz_completed`, `quiz_name_submitted`, `quiz_score_reshared`
(`method`: share sheet vs clipboard), `quiz_error` (`stage`), and
`quiz_unavailable` for a revoked link. App Store CTAs report through the
shared `data-track-location` wiring in `base.html` as `click_app_store`.

Note that the `quiz_results` CTA routes through `/q/{slug}/install`, so it
lands in **both** GA and the server-side `install_cta_tap` counter; the
`quiz_gone` CTAs deliberately do not.

**Loop attribution — Postgres.** `quiz_funnel` holds one counter row per
`(quiz_id, event)` for the six guest steps (`page_view`, `session_started`,
`session_completed`, `install_cta_tap`, `name_submitted`, `score_reshared`),
written atomically through the `increment_quiz_funnel` RPC and never
double-counted on refresh or resume. `quiz.owner_id` joins them back to the
creator, so "challenges created this month → guest plays → installs, by owner
cohort" is one query — and the only place that question can be answered
honestly.
