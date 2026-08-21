# Guess Where Design Elevation — Execution Plan

## Context

An external design brief ("Atlasi Social Guessing Game Design Brief", with four 9:16 mockups) sets a new visual bar for the Guess Where challenge: photography as the primary interface, editorial serif typography, a restrained motion system, and a sharper viral loop. The brief was written without knowledge of the current implementation, so this plan adapts it to what actually exists on `feat/travel-photo-quiz`:

- The play screen is already a dark full-bleed photo stage (blurred self-backdrop, deal-in/toss-out motion, gold acknowledgment ring).
- The web guest flow at `/q/{slug}` already exists (anonymous sessions, name capture, leaderboard, install CTA, revoked state) with an end-only score reveal.
- Creation, results, leaderboard, and the challenge list range from partially designed to text-only scaffolding — the creation "working" phase (which can run 90 seconds) is the weakest moment in the product.
- The share artifact is a deliberately photo-free server-rendered unfurl card.

The goal: bring every surface — mobile and web — up to the brief's fidelity, using the app's real design system, on one release of incremental commits.

**Mockup references** (Emerson's session, 2026-08-16): (1) play screen with 2×2 cream answer grid over a full-bleed photo, (2) "Building Your Challenge" with photo hero + thumbnail slot grid, (3) "Your Score to Beat" results with photo hero + serif score, (4) share composer *(not built — see Decision 3)*.

## Settled decisions (Emerson, 2026-08-16/17 — do not relitigate)

1. **End-only reveal stays.** The brief's per-question verdict reveal (§6: gold/terracotta, country name, "Next Photo") is rejected — it reverses the Q8 decision. In-run stays a neutral gold acknowledgment; the score lands once, at the end, on app and web alike. The brief's reveal *styling* (gold correct / terracotta incorrect, country names in serif) is adapted to the results/review moment only.
2. **User photos are now allowed on share artifacts.** This reverses the KTD11 privacy rule. The unfurl card at `/q/{slug}/card.png` becomes photo-rich. Accepted tradeoff: messaging-app CDN caches outlive revocation. The KTD11 rationale is documented in three places and each must be rewritten to record the reversal (see Traps).
3. **No share composer screen, no share video.** The brief's §10–12 composer and 8-second animated asset are out of scope. Sharing stays the native share sheet (message + link in the `url` slot); the investment goes into the photo-rich unfurl card and the share copy.
4. **Retire `StampScorePlate`.** The text-based rotated stamp plate reads as cheesy. Scores become large editorial Playfair serif over photography, per the mockups. The app's real country-stamp illustrations (227 files, `mobile/assets/stamps/processed/{ISO2}.webp` via `mobile/src/assets/stampImages.ts`) may appear as tasteful accents **post-answer only** (results review) — never during play, never on share assets, because a country stamp next to a photo reveals its answer.
5. **Target 10 photos, allow 5–9 fallback.** The hunt loop already runs until full (`while eligible.length < QUIZ_MAX_PHOTOS` with the ≥5 soft-deadline fallback) — this decision is UI and copy only. Do not re-implement selection. All layouts (progress segments, thumbnail grids) render N gracefully; the 10-slot visual system is the design target.
6. **Intro = rotating photo hero + the playable demo.** Full-bleed rotating photography (3–4 bundled sample photos, ~2s each, slow Ken Burns) behind a fixed headline and CTA, with the existing one-tap demo kept and layered in. Blocked on sample photography from Emerson (Asset checklist); placeholder photos are fine during development.
7. **Web reveal-first.** The friend's score and comparison show immediately on completion; name capture becomes an optional inline "post my score" module after the reveal. This requires a backend change — `POST /q/{slug}/complete` currently requires `display_name`.
8. **One release, incremental commits** on `feat/travel-photo-quiz`, one commit per unit below.
9. **KTD10 stays.** No universal links for `/q/`; the `/q/{slug}/install` tap remains the funnel proxy. The brief's §13 installed-app deep-link routing is explicitly out of scope.
10. **Real brand values win over brief values.** The product name genuinely is Atlasi (`com.atlasi.app`, `atlasi://`, "Get Atlasi"). Sunset gold is `#FFC636` (not the brief's `#F4C24E`); serif is Playfair Display; sans is Open Sans; the Dawning script accent voice (prompts, "sign the logbook") is an existing brand asset the brief didn't know about and is kept.

**Out of scope, with reasons** (so no brief section silently disappears): share composer + video (Decision 3), universal links (Decision 9), inline verdicts (Decision 1), exactly-10 hard requirement (Decision 5), per-destination share variants (§12 table — the OS share sheet + one card covers it), personalized per-player OG images (§15 — OG is per-slug, not per-viewer; friend reshare uses the same URL and prefilled text instead).

## Design direction

### The feel

Per the brief §1: entering someone's photographic travel history, not opening a geography trivia game. Emotional sequence: intrigue → immersion → guess → reveal → comparison → sharing → creation. Photography dominates every screen; type, choices, progress, and actions stay subordinate. This extends the existing "prints from the field" language — the dark photo stage, dealt prints, and Dawning prompts stay; the cheesy stamp plate and the text-only screens go.

### Constraints (brief §3, adapted)

Keep: 4 country choices per photo; no sound; no maps/route lines; no GPS/coordinates/pins; no flags or country imagery that could hint an answer; no dates or years anywhere in the friend experience; no confetti/trophies/medals/game-show styling; no system-blue (already enforced — `colors.primary` is banned from this feature); no oversized buttons or answer cards; unfound photos never shown blurred/faded — neutral placeholders only; photography visually dominant everywhere.

Amended: "exactly 10 photos" → target 10, 5–9 fallback (Decision 5). "No passport stamps" → no text-based stamp plates; real country-stamp artwork allowed post-answer (Decision 4). "Share assets must never reveal locations or answers" → still true (a photo alone reveals nothing; stamps/countries/years never appear on share artifacts).

### Palette and type mapping (brief role → real token)

| Brief role | Real token | Value |
| --- | --- | --- |
| Midnight navy | `colors.midnightNavy` | `#172A3A` |
| Warm cream | `colors.warmCream` | `#FDF6ED` |
| Sunset gold | `colors.sunsetGold` | `#FFC636` |
| Incorrect / terracotta | `colors.adobeBrick` | `#C1543E` |
| Supporting neutral | `colors.stormGray` / `colors.paperBeige` | `#666D7A` / `#F5ECE0` |
| Editorial serif | Playfair Display (`fonts.playfair`) | questions, scores, titles, reveals |
| Humanist sans | Open Sans (`fonts.body`) | answers, progress, buttons, leaderboard, inputs |
| *(not in brief)* script accent | Dawning (`fonts.dawning`) | prompts ("where was this taken?"), logbook moments — used sparingly, never for data |

Correct status is gold, never green, per the brief; `mossGreen` remains for secondary confirmations outside the game surfaces. On web, the same values already exist in `backend/app/static/css/src/variables.css`.

### Motion principles (brief §18, mapped to the stack)

- Durations 120–600ms; motion reveals hierarchy, never decorates. No bouncing, shaking, confetti, or continuous idle movement.
- Haptics only on answer commitment (`impactAsync(Light)`, existing) and final score (`notificationAsync(Success)`, existing).
- Every animation is gated by `useReducedMotion()` (existing hook, already respected in all quiz screens) — reduced motion replaces spatial movement with crossfades.
- Spring/stagger tokens come from `mobile/src/navigation/transitionConfig.ts`; new fixed-duration tokens (120/240/350/600ms) live with the quiz component kit rather than ad-hoc per screen.
- React Compiler is on: no ref writes during render; loops/timers live in effects or reanimated shared values (`useStableCallback` where identity matters).

## Per-surface specifications

### 1. Intro — `mobile/src/screens/quiz/GuessWhereIntroScreen.tsx`

Today: navy stage, small polaroid illustration, playable one-tap demo, StampScorePlate ack.

Target:
- **Rotating full-bleed hero**: 3–4 bundled sample photos (Asset checklist), each visible ~2–2.5s inside an 8–10s loop, slow Ken Burns (scale 1.0→1.06 drift, crossfade 600ms between photos). Reduce Motion → static first photo with simple crossfades. Small progress dots indicate rotation. Navy gradient scrim keeps type legible. Loop pauses while the demo reveal is showing.
- **Fixed copy over the hero**: headline `How well do your friends know your world?` (Playfair, 30–34pt); support line `Turn your travel photos into a challenge only your friends can solve.`
- **Primary CTA** `Create Your Challenge` → `navigation.replace('QuizCreation')`. **Secondary** `See how it works` reveals the demo in place.
- **Playable demo kept**: the existing one-tap guess (four `GuessOption`s, Dawning prompt) runs against a sample photo instead of the illustration; the ack uses the new `SerifScore` (small), not StampScorePlate. Haptic pattern unchanged.
- This screen deletes the last `StampScorePlate` reference (see execution order).

### 2. Creation — `mobile/src/screens/quiz/QuizCreationScreen.tsx` (mockup 2)

Today: a 510-line 9-phase state machine rendered as centered text; the `working` phase is a text step list with a literal `"Done"` string and an inline counter — the weakest screen in the feature despite being where users wait up to 90 seconds.

Target (the phase *machine* is untouched; the phase *UIs* are redesigned):
- **`working` phase** becomes the mockup's build stage: upper ~50–55% is a hero of the **most recently found photo** (sharp, contained, navy backdrop derived from it), swapping as new photos are found; lower cream sheet carries `Building Your Challenge` (Playfair), status line `Finding your travel photos`, a large serif counter `6 of 10`, a thin gold progress bar, a **5×2 thumbnail slot grid**, the privacy line `Your photos stay private until you share the challenge.`, and `Cancel`.
- **Slot treatment**: found slots show the crisp photo; unfound slots are warm-gray neutral placeholders with a minimal image-outline mark — never blurred, faded, or translucent (brief §7). On a photo's arrival: placeholder brightens briefly, photo replaces it over 180–240ms, counter increments, hero updates (brief §21). Before any photo is found, the hero area shows a neutral navy field with the status copy — no fake imagery.
- **Upload stage**: when hunting completes, status becomes `Building your challenge`; all found thumbnails stay visible; the same screen carries upload progress. No unrelated loading interface; completion transitions directly into the owner's first play (already `replace('QuizPlay', { quizId })`).
- **`intro` / `resume-draft` phases** get the same hero-over-cream structure (sample/last-known photo as hero) so the flow opens visually instead of as a text page. Permission/error/thin-library phases keep their copy but adopt the new layout shell.
- **Pipeline prerequisite**: `QuizCreationProgress` (`mobile/src/services/quiz/quizCreationTypes.ts`) is `{step, current?, total?}` — no photo URIs. Extend it to carry the running eligible picks (local `DraftPick.uri` values, which already exist in the draft flow) so the screen can render the hero + grid. Emission points are in `quizCreation.ts` (~lines 207, 277–289). This is a service API change and its own commit (Unit 1.3a).

### 3. Play — `mobile/src/screens/quiz/QuizPlayScreen.tsx` (mockup 1; refinement, not rebuild)

Today: already the strongest screen — full-bleed dark stage, blurred self-backdrop, contained sharp photo, deal-in/toss-out worklets, gold ack ring, `ProgressSegments`, Dawning prompt, bottom gradient.

Target changes:
- **Adaptive layout** (brief §5): portrait/square photos extend full-screen with progress and answers overlaid directly on the image (scrim-protected); landscape photos display edge-to-edge at ~60–70% height with the compact answer area below on the stage color. Orientation: use the question payload's `landscape` field if present at play time; otherwise derive from `expo-image` `onLoad` dimensions (verify which — see Traps).
- **Answer grid compacted**: `GuessOption` minHeight 56 → 46–52pt, text 16pt, gaps 8–10pt, radius 12–16pt, screen margin 16–20pt. Selection: compress to ~98%, surface to solid midnight navy, text warm cream, response within ~120ms (adapt the current gold-ring ack styling toward the mockup's cream buttons; the tapped state stays a neutral acknowledgment — no verdict).
- **Progress**: keep the 10-segment bar; add the `3 OF 10` label (Open Sans bold, letter-spaced, cream) above it per mockup. Tracker area 24–32pt.
- **Question type**: promote the question to the mockup's editorial serif — `Where in the world was this?` in Playfair 28–34pt over the photo, with the Dawning script retained as the smaller accent line. (Current: Dawning-only prompt.)
- **Between-photo transition** (brief §20): current photo fades toward navy over ~120ms, next appears over 240–320ms; controls hidden during the transition; progress advances; question/choices return after the image settles. This replaces the lateral toss-out (which reads as a card swipe, on the brief's avoid list) while keeping the deal-in spring for the photo's entrance settle (101.5% → 100% over ~600ms on round entry, brief §19).
- **Photo inspection** (brief §5): tapping the photo hides the interface; full photo aspect-fit; pinch-to-zoom; return restores the interface without affecting selection. Reuse the codebase's only pinch implementation (`mobile/src/components/media/MediaViewer.tsx`) — extract a `PhotoInspector` rather than rebuilding gesture math. Separable unit; droppable if it fights the stage.
- Keep: blurred backdrop for landscape/letterbox fill, prefetch-next, watchdog, resume behavior, haptics.

### 4. Results — `mobile/src/screens/quiz/QuizResultsScreen.tsx` (mockup 3)

Today: cream ScrollView; StampScorePlate; per-photo rows with verdict dots; swap/remove pre-share; share/revoke footer.

Target:
- **Photo hero, upper ~45–50%**: one challenge photo full-bleed (navy scrim), overlaid with the Atlasi wordmark small, `Your Score to Beat` (Playfair), and the score as a large editorial serif lockup — new `SerifScore` component (Playfair, ~72–88pt numerals, `8 / 10` form). No stamp plate, no count-up animation.
- **Cream sheet below**: explanation `Friends who play your challenge will try to beat this country score.`; the **private Memory module** (paperBeige card): `Memory` / `9 of 10 years right` / `Only you see this.` — existing `memory_correct/total` data, owner-only, unchanged semantics.
- **Photo recap**: a horizontal row/grid of all N thumbnails with **corner verdict marks** — small gold check / terracotta X (`VerdictMark`, replacing PolaroidThumb's colored dots), kept in a corner, never covering image content. Country names do NOT appear until `Review Answers` is opened (brief §8).
- **`Review Answers`** (secondary action) expands the current per-photo rows: country reveals in serif, `Right: {country}` gold / `It was {X} — you picked {Y}` terracotta, year lines, optional small country-stamp artwork accents (Decision 4 — the one sanctioned stamp moment). Swap/Remove chips unchanged, pre-share only.
- **Primary action** `Challenge Your Friends` (gold pill, 50–54pt, existing Button primary). Footer keeps Revoke/Done logic untouched.
- **Reveal choreography** (brief §22): hero settles → score rises slightly into place → thumbnails populate rapidly with staggered marks → share controls fade in last. Success haptic timing unchanged.

### 5. Leaderboard — `mobile/src/screens/quiz/QuizLeaderboardScreen.tsx`

Target: upper 30–38% `PhotoHero` (one challenge photo, scrim) overlaid with `Leaderboard` (Playfair), `Who knows {name}'s world best?`, and the creator benchmark line `{owner} · 8 / 10` (replacing the small StampScorePlate). Below on cream: ranked rows containing **only rank, name, score** — no avatars, timestamps, medals (brief §17). Rank in Playfair numerals, name in Open Sans, score right-aligned. Existing hide action stays as the `RowAction` chip; hidden rows keep the dimmed treatment. New score arriving while the screen is open: insert at rank, displaced rows move smoothly, new row gets a pale-gold background fading over ~1.2s, not replayed on revisit (brief §24). `Share Challenge` button retained.

### 6. My Challenges — `mobile/src/screens/quiz/MyQuizzesScreen.tsx`

Today: text-only rows — no imagery, in the one screen that is a gallery of the user's own challenges.

Target: each row gets a photo thumbnail (cover = first question's image), title, state pill, and meta line; empty state keeps the illustration until the Guess Where mark arrives. **Backend sub-task**: the list payload (`GET /quiz`, `useQuizzes`) has no image URL — add a `cover_image_url` field to the list response in `backend/app/api/quiz.py` (owner-only endpoint; the storage URLs are already public-bucket paths used by play).

### 7. Web guest flow — `backend/app/templates/quiz.html`, `static/css/src/pages/quiz.css`, `static/js/quiz-play.js`

Today: dark stage intro + question (already photo-first), cream card for name/results/gone; name-gated reveal ("sign the logbook" → "Reveal my score"); zero client analytics; strict CSP.

Target:
- **Reveal-first restructure** (Decision 7): after the last answer, call complete immediately with no name; results view shows the score + comparison headline at once (`You beat {owner}!` family, unchanged copy), then an inline optional module: `Add your name to the leaderboard` / first-name input / `Post My Score` → new `/name` endpoint → the player's row splices into the leaderboard with the pale-gold highlight. The "sign the logbook" Dawning voice moves onto this module. Resume path: a completed session with no stored name lands on results with the module open (needs `display_name` in the session snapshot — see API changes).
- **`Share My Score`** (brief §15): primary friend action after the reveal, before `Get Atlasi`. Uses `navigator.share({text, url})` with clipboard fallback; prefilled text `I scored {s}/{t} on {owner}'s challenge — can you beat me?`; same `/q/{slug}` URL so every reshare feeds one leaderboard. Built with textContent-safe DOM only (names are attacker-controlled; CSP forbids inline anything).
- **Visual polish pass** to mockup fidelity: serif question `Where in the world was this?`, `3 OF 10` progress label, compact 2×2 cream answer buttons (46–52pt) replacing the glassy navy ones on the question stage, results hero treatment matching the app's. The stage/scrim/deal motion largely exists; this is refinement, and the app and web must land the same decisions (they share the design system deliberately).
- **Photo inspection**: tap toggles chrome-hidden aspect-fit view; zoom via CSS `touch-action: pinch-zoom` on the inspector layer — no hand-rolled gesture math.
- CSS edits in `src/pages/quiz.css` → `node scripts/build-css.js` → commit `styles.css` + `styles.min.css`.

### 8. Unfurl card — `backend/app/core/quiz_image.py` + route in `backend/app/api/public.py`

Today: deterministic type-only 1200×630 Pillow render, zero network, `_RENDER_VERSION = 2` in the ETag, committed Playfair/Open Sans TTFs.

Target: a photo-rich card matching mockup 4's poster language: one challenge photo full-bleed, navy scrim gradient, small tracked `ATLASI` wordmark, eyebrow `{NAME}'S CHALLENGE` (gold, tracked), Playfair headline `Can you beat 8 / 10?` (or `Can you guess where?` when unseeded), support line `10 photos. 4 choices.`, gold `Play the challenge` line. Implementation decisions:
- **Photo choice: the LAST question's photo, never photo 1** — the web intro deliberately blurs photo 1 at 48px so it stays a mystery; a crisp photo 1 on the link preview would spoil question 1 for every recipient.
- Route fetches the photo via httpx GET from the public storage bucket (`build_media_url` pattern in `backend/app/core/media.py`) with a short timeout; **any failure falls back to the current type-only render — the route must never 500**.
- ETag gains the chosen `storage_path`; bump `_RENDER_VERSION` to 3. Revocation already 404s the card before ETag handling; CDN cache persistence is the accepted tradeoff (Decision 2).
- **Rewrite the KTD11 docstrings in all three places** (see Traps) to record the reversal, or a future reader will "fix" it back.

### 9. Share copy — `mobile/src/screens/quiz/shareChallenge.ts`

Message becomes the brief §12 shape: `I made a challenge from {n} of my travel photos. Can you beat my {s}/{t}?` — editable in the native sheet, link stays in the dedicated `url` slot (iOS) / appended (Android). No other share plumbing changes.

### 10. Analytics — brief §27 mapped to what's feasible

Primary metric: **completed friend plays per created challenge** (= `session_completed` ÷ `quiz_created`).

| Brief event | Where it lands |
| --- | --- |
| Challenge created | mobile `track('quiz_created')` — exists |
| Creator completed first run | mobile `track('quiz_first_run_completed')` — new |
| Share composer opened | n/a (no composer) |
| Share initiated / completed | mobile `track('quiz_share_initiated'/'quiz_share_completed')` — new; `Share.share` resolves with the action on iOS |
| Shared link opened | server `quiz_funnel.page_view` — exists |
| Challenge started | server `quiz_funnel.session_started` — exists |
| Challenge completed | server `quiz_funnel.session_completed` — exists |
| Name submitted | server `quiz_funnel.name_submitted` — **new event** |
| Score shared (friend reshare) | server `quiz_funnel.score_reshared` — **new event**, fired from the web share action |
| New challenge creation started/created | mobile `first_quiz_offer_*` + `quiz_created` — exists |

Plus web GA (gtag already nonce-loaded in `base.html` with a `typeof gtag !== 'undefined'` guard pattern): per-question answer events from `quiz-play.js` to close the **drop-off blind spot** (today there is no signal for where guests abandon a 10-photo run).

New funnel events require editing the `quiz_funnel` CHECK constraint in migration `0060_travel_photo_quiz.sql` — see Traps.

## Backend API changes (enabler for web reveal-first)

In `backend/app/schemas/quiz.py` and `backend/app/api/public_quiz.py`:

1. `PublicQuizCompleteRequest.display_name` → `str | None = None` (keep trim/one-letter-or-digit validation when present). DB is already fine: `quiz_session.display_name` is nullable, and `quiz_leaderboard.py` already filters unnamed sessions off the board.
2. Fix the None-name path in `complete_public_quiz_session` (~line 353): `bound_name = str(session.get("display_name") or data.display_name)` mis-keys when both are None — viewer key must become None and `is_you` false for unnamed completions.
3. Add `display_name` to `_session_snapshot` / `PublicQuizSessionResponse` so a resuming completed player knows whether to show the post-my-score module.
4. New `POST /q/{slug}/name` `{token, display_name}`: bind-once conditional write (`completed_at` not null AND `display_name` is null — copy the existing conditional-write idiom) so replays can never rename someone; returns the refreshed leaderboard; own rate-limit tier (~`20/minute`); fires `name_submitted`.

## Execution order (one commit per unit)

| Unit | Scope | Files (primary) | Depends on |
| --- | --- | --- | --- |
| 0 | Settle the dirty working tree (in-flight changes committed or stashed before design work begins) | — | — |
| 0.1 | Component kit: `SerifScore`, `PhotoHero`, `VerdictMark`; motion duration tokens. StampScorePlate NOT deleted yet | `mobile/src/screens/quiz/components/` (+`index.ts`) | — |
| 0.2 | `sampleAssets.ts` indirection + placeholder art wiring; asset checklist doc update | `mobile/src/screens/quiz/sampleAssets.ts` (new) | — |
| 1.1 | Play: adaptive layout, compact options, progress label, serif question, navy-fade transition | `QuizPlayScreen.tsx`, `GuessOption.tsx`, `ProgressSegments.tsx` | 0.1 |
| 1.2 | Photo inspection (tap-to-inspect + pinch), extracted from MediaViewer. Separable/droppable | `components/PhotoInspector.tsx` (new), `QuizPlayScreen.tsx`, `MediaViewer.tsx` | 1.1 |
| 1.3a | Creation pipeline: `QuizCreationProgress` carries running picks (URIs) | `quizCreationTypes.ts`, `quizCreation.ts`, service tests | — |
| 1.3b | Creation screen redesign (hero + slot grid + copy) | `QuizCreationScreen.tsx`, screen tests | 0.1, 0.2, 1.3a |
| 2.1 | Results redesign (hero + SerifScore + VerdictMark recap + review reveal) | `QuizResultsScreen.tsx`, `PolaroidThumb.tsx` | 0.1, 1.1 |
| 2.2 | Leaderboard + My Challenges (incl. `cover_image_url` backend sub-task) | `QuizLeaderboardScreen.tsx`, `MyQuizzesScreen.tsx`, `useQuizzes`, `backend/app/api/quiz.py` | 0.1 |
| 2.3 | Intro rotating hero + demo restage; **delete `StampScorePlate.tsx`** (last referrer) | `GuessWhereIntroScreen.tsx`, `components/` | 0.1, 0.2 |
| 3.1 | Backend reveal-first API (optional name, snapshot, `/name` endpoint, crash fix) | `schemas/quiz.py`, `public_quiz.py`, backend tests | — (parallel-safe) |
| 4.1 | Web reveal-first + name module + Share My Score | `quiz-play.js`, `quiz.html` | 3.1 |
| 4.2 | Web visual polish + inspection + CSS rebuild | `quiz.css`, generated `styles*.css`, `quiz.html` | 4.1 |
| 5.1 | Funnel events: migration CHECK edit + `test_quiz_migration.py` + server call sites | `0060_travel_photo_quiz.sql`, `quiz_funnel.py`, `public_quiz.py` | 3.1 |
| 5.2 | Photo-rich unfurl card + KTD11 docstring rewrites | `quiz_image.py`, `public.py`, card tests | — (schedule late) |
| 5.3 | Client analytics (mobile track calls + web gtag) | `analytics.ts`, screens, `shareChallenge.ts`, `quiz-play.js` | everything (last) |

Recommended sequence: 0 → 0.1 → 0.2 → 1.1 → 1.3a → 1.3b → 2.1 → 2.2 → 2.3 → 1.2 → 3.1 → 4.1 → 4.2 → 5.1 → 5.2 → 5.3. (3.1 can run in parallel with any mobile unit; 2.3 can slip until sample photos arrive; 1.2 is the droppable risk unit.)

## Asset checklist (Emerson owes — extends the hand-off list in `docs/quiz-photo-feedback-backlog.md`)

1. **3–4 sample travel photos** for the intro hero + demo. Yours; they ship in the bundle and are visible to every user — treat as public. Recognizable-but-not-trivial outdoor scenes, no people, mixed portrait/landscape welcome. JPEG, longest edge ~1600px, <500KB each. Drop at `mobile/assets/guess-where-samples/…`; tell Claude which country each is (the demo's options get rewritten so the real country is among them).
2. **Guess Where mark** (map pin/compass "?") — unchanged from the existing checklist; `mobile/assets/illustations/guess-where-mark.png`.
3. *(Optional)* neutral placeholder glyph for the creation slot grid — otherwise it's drawn in code (warm-gray fill + simple image outline), which is acceptable per the mockup.

All are JS/asset changes: shippable over EAS Update.

## Traps (verified in code — read before implementing)

1. **Reveal-first sharp edges**: (a) the `public_quiz.py:353` None-name crash path; (b) `_session_snapshot` lacks `display_name`, breaking resume UX; (c) `/name` must be a bind-once conditional write or replays could rename players. The `already_completed` path and the sessionStorage name key in `quiz-play.js` change meaning (stored name = "posted", no longer "used to complete").
2. **`test_quiz_migration.py:188` asserts the funnel event list exactly** — any 0060 CHECK edit must update that test in the same commit. Migration 0060 states in-file it is unapplied in production; **verify that's still true** (`supabase migration list` / dashboard) before editing it in place; if it has been applied, new events need a follow-on migration instead.
3. **KTD11 lives in three places**: `quiz_image.py` module docstring, its render-function docstring, and the `public.py` card-route docstring. `grep KTD11` and rewrite all of them when reversing the rule.
4. **StampScorePlate has three referrers** (`QuizResultsScreen`, `QuizLeaderboardScreen`, `GuessWhereIntroScreen`); delete the file only in Unit 2.3 so every commit builds.
5. **Target-10 is already implemented** in the hunt loop — do not touch selection; only UI copy and the 10-slot grid remain.
6. **Orientation at play time**: `landscape` exists on creation-side `DraftPick`; verify whether the play payload carries it before relying on it — otherwise derive from `expo-image` `onLoad` dimensions.
7. **Creation hero is a pipeline change first** (1.3a), then UI (1.3b) — the progress emissions carry no URIs today.
8. **React Compiler + Ken Burns**: rotation timers/loops in effects or reanimated shared values only; never write refs in render; Reduce Motion branch required.
9. **Web CSP**: no inline styles/handlers anywhere; all dynamic text via `textContent`; display names are attacker-controlled; share text built by string concat into `navigator.share`, never innerHTML. CSS must go through `build-css.js` with generated files committed.
10. **Jest hangs at exit** — run `npx jest --forceExit` (piped runs look frozen otherwise). Backend has 4 pre-existing unrelated failures (canonical-tag assertions in blog/public tests).
11. **Card photo networking**: current render is deliberately zero-network; the photo fetch belongs in the route (not the pure render fn), with timeout + type-only fallback so the route never 500s.

## Verification

- **Backend** (`poetry run pytest`, `ruff check`, `ruff format --check`): new tests — complete with null name; `/name` bind-once + rename rejection; snapshot returns `display_name`; unnamed sessions never appear on the leaderboard; card renders with photo, falls back on fetch failure, ETag changes with `storage_path`; funnel CHECK test updated.
- **Mobile** (`npm run lint`, `npm run format:check`, `npx jest --forceExit`): update `QuizCreationScreen`, `QuizPlay`, `MyQuizzes`, `QuizResultsScreen` tests; new tests for progress-carries-picks and the component kit.
- **Web**: rebuild CSS and commit generated files; manual pass with the browser console open for CSP violations; test resume-after-complete both named and unnamed; test the Web Share fallback in a non-supporting browser.
- **Visual pass** (on device): portrait AND landscape photos in play; Reduce Motion on/off for the intro hero, play transitions, and results reveal; the unfurl card checked in a real preview surface (iMessage/Slack/WhatsApp or an OG debugger).
- **Full-flow smoke**: create (a 10-photo run and a 5–9 fallback run) → owner play → share → anonymous web play → immediate reveal → post name → reshare → revoke → card and page 404.
- Pre-commit checklists per `CLAUDE.md` on every unit.

## Critical files

Modify: `mobile/src/screens/quiz/*.tsx` (all six screens), `mobile/src/screens/quiz/components/*` , `mobile/src/screens/quiz/shareChallenge.ts`, `mobile/src/services/quiz/quizCreation.ts` + `quizCreationTypes.ts`, `mobile/src/services/analytics.ts`, `mobile/src/hooks/useQuizzes*`, `backend/app/api/public_quiz.py`, `backend/app/api/public.py`, `backend/app/api/quiz.py`, `backend/app/schemas/quiz.py`, `backend/app/core/quiz_image.py`, `backend/app/services/quiz_funnel.py`, `backend/app/templates/quiz.html`, `backend/app/static/js/quiz-play.js`, `backend/app/static/css/src/pages/quiz.css` (+ generated bundles), `supabase/migrations/0060_travel_photo_quiz.sql`, `backend/tests/test_quiz_migration.py`.

Create: `mobile/src/screens/quiz/components/SerifScore.tsx`, `PhotoHero.tsx`, `VerdictMark.tsx`, `PhotoInspector.tsx`, `mobile/src/screens/quiz/sampleAssets.ts`.

Delete (Unit 2.3): `mobile/src/screens/quiz/components/StampScorePlate.tsx`.
