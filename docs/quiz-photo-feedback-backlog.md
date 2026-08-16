# Quiz + Photo Import — Walkthrough Feedback Backlog

Running list of issues found while walking through the app. Items are recorded roughly in the order
they were found; context and file pointers were added so each one is actionable later.

Captured: 2026-08-16 (branch `feat/travel-photo-quiz`)

## Resolution status (2026-08-16, same branch)

All items below were addressed in the Guess Where overhaul, one commit per phase:

| Items | Resolution |
| --- | --- |
| BUG-1, BUG-2 | `fix(quiz): survive failed answer persistence and collapse burst duplicates` — test-first; root causes were an unawaited react-query callback and burst frames clustering under newest-first ordering |
| Q12, Q2 (web), Q11a (unfurl card) | `feat(quiz-web): redesign the public Guess Where flow as a photo-first stage` |
| Q4, Q6, Q8, Q9, Q10, Q11a | `feat(quiz): full-bleed play stage, stamp-press results, and a discrete share link` |
| Q1, Q3, Q7, Q2 (app copy), Q4 (list/leaderboard) | `feat(quiz): Guess Where entry card, playable intro, and redesigned list/leaderboard` |
| P1, Q5 | `feat(photos): unified library refresh, sync observability, and the creation wizard` |

Decisions taken: feature renamed **Guess Where** (each quiz is a "challenge"; internal `quiz_*`
identifiers and `/q/` URLs unchanged); entry point is a card on the passport home; the share card
keeps its no-photos privacy rule (the redesigned server-rendered unfurl card is the share visual,
and the challenge link now travels in the share sheet's `url` slot); no per-question verdicts
anywhere — neutral gold acknowledgment in-run, score revealed once at the end, on app and web alike.

Still open / follow-ups:
- On-device pass for motion + haptics feel (all animation is Reduce Motion-aware).
- Custom art: a map-pin/compass "?" mark and an optional trophy stamp (same sticker style as the
  polaroids illustration); a real sample travel photo would upgrade the intro demo.
- The swap picker's own-photo exclusion applies to challenges finalized after this change (older
  quizzes have no local asset record).
- If the ErrorBoundary "Something went wrong" recurs, pull the `componentDidCatch` stack from
  device logs — the remaining hypothesis is the 401 sign-out navigator collapse, not quiz logic.

---

## Q1 — Quiz entry point needs to be far more visual

**Status:** Open · **Type:** Design / IA · **Size:** M

The only persistent way into the quiz feature is a plain text row buried in profile settings
(`mobile/src/screens/profile/ProfileSettingsScreen.tsx:606` — a title + subtitle pressable labeled
"My Quizzes"). There is no imagery, no preview of the user's own photos, no sense that this is a
game. It reads like a settings toggle.

The feature is inherently visual — it is built out of the user's own travel photos — and the entry
point should show that.

**Needs a decision on:**

- What the entry point actually looks like (photo-backed card? map/globe motif? score/streak surface?)
- Where it lives once Q3 is resolved

**Related:** Q2 (naming), Q3 (placement in the app)

---

## Q2 — "Quizzes" is the wrong name

**Status:** Open · **Type:** Product / Naming · **Size:** S (copy) + M (rename surface area)

"Quiz" reads academic and dull. The feature is a GeoGuessr-style game — guess where a photo was
taken — and the name should carry that energy.

**Scope of a rename:**

- User-facing copy only, if we keep internal identifiers: mobile screens under
  `mobile/src/screens/quiz/`, share card copy (`mobile/src/components/share/variants/QuizChallengeVariant.tsx`),
  onboarding offer screen (`mobile/src/screens/onboarding/FirstQuizOfferScreen.tsx`), and the public
  web page (`backend/app/templates/quiz.html`).
- If we also rename routes/tables/APIs, that reaches navigation types, `backend/app/api/quiz.py`,
  `backend/app/api/public_quiz.py`, the `quiz_*` services, and migration `0060_travel_photo_quiz.sql`.

**Recommendation to decide:** rename user-facing copy + public URLs first; leave internal
`quiz_*` identifiers alone unless there's a reason to churn them.

**Open:** Name candidates not yet chosen. Should avoid trademark collision with GeoGuessr.

---

## Q3 — Wrong placement in the app; needs real integration

**Status:** Open · **Type:** IA / Navigation · **Size:** M–L

Profile settings is not the right home. Today the quiz screens are registered on the root stack
(`mobile/src/navigation/RootNavigator.tsx:79-83`) and reachable only from:

1. The profile settings row (Q1)
2. A one-time onboarding launch (`useFirstQuizLaunch` in `mobile/src/navigation/MainTabNavigator.tsx:105`)

So after onboarding, the feature effectively disappears.

**What "integrate throughout the app" should mean — needs definition:**

- Where does a user naturally encounter it? (passport grid, trip detail, country detail, home?)
- Is it a tab, a recurring prompt, a card in an existing feed, or a share-driven loop?
- What triggers a *new* quiz vs. resuming/reviewing an old one?

**Blocked on:** a product call about whether this is a core loop or a side feature. Q1's design work
depends on the answer.

---

## Q4 — The quiz section itself is visually unfinished

**Status:** Open · **Type:** Design · **Size:** L

All five quiz screens are functional but visually raw:

| Screen                    | File                                                | Notes                                                        |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| My Quizzes (list)         | `mobile/src/screens/quiz/MyQuizzesScreen.tsx`        | Plain list, no visual hierarchy                               |
| Creation / progress       | `mobile/src/screens/quiz/QuizCreationScreen.tsx`     | Text-only step list; see also Q6                              |
| Play                      | `mobile/src/screens/quiz/QuizPlayScreen.tsx`         | The photo is the product — layout should let it dominate      |
| Results                   | `mobile/src/screens/quiz/QuizResultsScreen.tsx`      | Largest screen (572 lines); scoring moment has no payoff feel |
| Leaderboard               | `mobile/src/screens/quiz/QuizLeaderboardScreen.tsx`  | Plain rows                                                    |

Needs a real design pass against `STYLEGUIDE.md`, not incremental patching. Play and Results are the
emotional beats — they should be designed first and the rest follow.

**Constraint reminder:** no emojis or stock icon libraries (see `CLAUDE.md`); iconography must be
custom and approved.

---

## P1 — Consolidate the two photo-library flows into one

**Status:** Open · **Type:** Architecture / UX · **Size:** L

There are currently multiple separate paths that read the user's photo library, and they don't share
a single flow:

- **Trip photo import** — `mobile/src/screens/photos/PhotoImportScreen.tsx` and `PhotoTripsScreen.tsx`,
  driven by `usePhotoImportWorkflow` / `usePhotoScan`, entered from trip detail
  (`TripDetailScreen.tsx:138`), country detail (`CountryDetailScreen.tsx:122`), trip form
  (`TripFormScreen.tsx:84-94`), and the trips list callout (`TripsListScreen.tsx:167`).
- **Entry photo attach** — `mobile/src/screens/entries/EntryFormScreen.tsx:131-147` goes directly to
  `expo-media-library` and hands URIs to the media gallery.
- **Quiz candidate selection** — `mobile/src/services/quiz/quizCreation.ts` and `quizPlay.ts` read from
  the shared cache (`@services/photoImport/photoCacheDb`) but run their own scan/progress UX.

**Goal:** one flow, one permission prompt, one cache, one progress/resume story — whichever entry
point the user comes in from.

**Also in scope:** get the background sync path working properly. `mobile/src/services/photoImport/photoBackgroundSync.ts`
exists and is explicitly best-effort ("errors are swallowed silently"), gated on permissions + a prior
import + elapsed time. If the consolidated flow relies on a warm cache, silent failure isn't
acceptable — it needs observable state and a recovery path.

**Needs before work starts:**

- Inventory of every library-read entry point (the three above may not be exhaustive)
- Decision on whether the unified flow is a screen, a hook, or a service + thin screens
- Definition of what "background flow working" means (trigger conditions, failure surfacing, freshness SLA)

---

## Q5 — Quiz creation should be a multi-step wizard, with the photo scan as its own step

**Status:** Open · **Type:** UX · **Size:** M · **Depends on:** P1

`QuizCreationScreen` today is a single blocking screen that runs `scanning → checking → building`
as one uninterrupted sequence (`STEP_ORDER` at `QuizCreationScreen.tsx:44`), with permission phases
layered on top of the same screen (`checking-permission`, `permission-request`, `permission-denied`,
`working`, `thin-library`, `service-error`, `interrupted`).

The problem: **the photo scan won't be needed every time.** Once the library cache is warm, re-scanning
is wasted time and makes every quiz creation feel as heavy as the first.

**Wanted:** a proper multi-step wizard where the photo-check step is separable — skipped or reduced to
a fast confirmation when the cache is fresh, and only run in full when it genuinely needs to.

**Open questions:**

- What are the wizard's steps once the scan is factored out? (source/scope → scan-if-needed → build → ready?)
- What's the freshness rule that decides "skip the scan"? (ties directly into P1's background sync)
- Can the user back out of a step without losing progress?

---

## Q6 — Photo should be full-bleed; current treatment reads as generic Material

**Status:** Open · **Type:** Design · **Size:** M · **Sharpens:** Q4

Specific version of Q4, aimed at the Play screen. The photo is the entire product and it's currently
boxed into a card: `QuizPlayScreen.tsx:302-303` constrains the image to `width: '100%'` with a fixed
`aspectRatio: 4/3`, inside a `ScrollView` (`QuizPlayScreen.tsx:18`) with `resizeMode="cover"`. The
result is a cropped thumbnail sitting in a stack of default components — it looks like generic
Material scaffolding, not Border Badge.

**Wanted:**

- Photo goes **nearly full screen or fully full screen**. Controls and answer options layer over it
  rather than sitting in a column beneath it.
- Fixed `4/3` cover-crop has to go — it's silently cropping people's actual travel photos, which is
  both ugly and destroys the guessable detail the game depends on.
- **Landscape photos need a tasteful treatment**: fill the frame with a background derivation of the
  photo itself (blur/scale/darken) and let the true image sit correctly on top, rather than
  letterboxing or hard-cropping. Needs to be handled deliberately, not left to `resizeMode`.
- Must feel on-brand per `STYLEGUIDE.md` — this is the screen that sets the tone for the feature.

**Watch out for:** legibility of answer options over arbitrary photos (needs a scrim or equivalent),
and safe-area / notch handling once content goes edge to edge.

---

## Q7 — The intro doesn't sell what this is or make it feel fun

**Status:** Open · **Type:** Copy / Onboarding · **Size:** M

`FirstQuizOfferScreen.tsx` is the only introduction, and it's two lines of text plus two buttons
(`FirstQuizOfferScreen.tsx:64-73`) — a headline, a one-sentence explanation, "Make your first quiz" /
"Maybe later". No visuals, no example, no demonstration of the actual game.

A user who has never played something like this can't tell what they're agreeing to. And once past
onboarding there is **no** intro at all — the feature just has to be understood cold from wherever
Q3 eventually places it.

**Wanted:**

- A real intro moment that shows rather than tells — ideally the game itself in miniature (a sample
  photo, a guess, a reveal) before asking for photo permission or commitment.
- Tone should be playful and match Q2's new name; current copy is functional but flat.
- Reachable outside onboarding, not a one-shot.

**Related:** Q2 (name drives the copy), Q3 (where the non-onboarding intro lives), Q6 (the intro
should preview the full-bleed treatment, not the current boxed one)

---

## Q8 — Drop the per-question "Correct!" screen; score only at the end

**Status:** Open · **Type:** UX / Game feel · **Size:** M · **Related:** Q6

Every question currently detours through a full-screen text interstitial. `QuizPlayScreen.tsx:32`
defines a `'feedback'` phase, and `:254-272` renders it as a centered stack: "Correct!" / "Not quite",
a line naming the right answer, an optional year line, and a "next" button. It stops the game dead
between every photo and it's dull — plain text on a blank screen, and an extra tap to continue.

**Wanted:** cut the interstitial. Play straight through the questions and reveal the score **once, at
the very end**. Fewer taps, better rhythm, and the reveal becomes an actual payoff moment instead of
being spent piecemeal.

**Notes for whoever picks this up:**

- The backend already grades every answer server-side and the verdicts are persisted locally per
  question (`mobile/src/services/quiz/quizPlay.ts:45-60`), so nothing needs to be re-plumbed — the
  data for an end-of-quiz reveal is already there. This is a presentation change.
- The per-answer verdicts still need to survive the run so the final screen can show a
  question-by-question breakdown. Don't discard them just because they're no longer shown inline.
- Resume behavior depends on the graded-verdict replay described at `quizPlay.ts:4-8` — removing the
  feedback phase must not break mid-quiz resume.
- Open: does the player get *any* in-run signal (a subtle tick, a progress bar advancing), or total
  silence until the end? Silence is more suspenseful; some signal may feel more responsive.
- This makes `QuizResultsScreen.tsx` carry the whole emotional payload — reinforces Q4's call to
  design Results as a priority screen.

---

## Q9 — No motion anywhere; it needs to feel dynamic, smooth, and fun

**Status:** Open · **Type:** Design / Motion · **Size:** L · **Cuts across:** Q4, Q6, Q7, Q8

**None of the five quiz screens use any animation at all.** Zero imports of `react-native-reanimated`
or `expo-haptics` across `mobile/src/screens/quiz/`. Every transition is an instant state swap —
questions cut, phases cut, results appear. That's the root of why the section reads as static and
lifeless, separate from the layout problems in Q4/Q6.

This is a game. It should move.

**Wanted:**

- Motion as a first-class part of the design, not decoration added afterward — photo entrances,
  option selection, question-to-question transitions, and the score reveal should all be animated
  and continuous. No hard cuts.
- Genuinely **smooth** — gesture-driven and interruptible where it makes sense, not fire-and-forget
  timers that block input.
- Haptics on the beats that matter (selection, reveal, final score).
- The end-of-quiz score reveal (Q8) is the single biggest opportunity — it should build and land,
  not just render.

**The tooling is already in the project and already used elsewhere** — nothing new to add:

| Library                        | Version    | Already used in                                                       |
| ------------------------------ | ---------- | --------------------------------------------------------------------- |
| `react-native-reanimated`      | `~4.1.1`   | `PhotoTripsScreen`, `PhotoTripCard`, `SwipeToSkipCard`, `GlassButton`  |
| `react-native-gesture-handler` | `~2.28.0`  | swipe interactions in photo import                                     |
| `react-native-screen-transitions` | `^3.2.0` | shared-element / custom stack transitions                             |
| `expo-haptics`                 | `~15.0.8`  | —                                                                      |

`SwipeToSkipCard.tsx` and `PhotoTripCard.tsx` are the closest in-repo reference for the feel to match.
`useScreenEntrance` (used by `FirstQuizOfferScreen.tsx:34`) is the existing staggered-entrance hook,
though it's built on RN core `Animated` rather than Reanimated — worth deciding whether quiz work
adopts it or goes straight to Reanimated.

**Constraints — read before implementing:**

- React Compiler is enabled: never write to a ref during render; use `useStableCallback`
  (see `CLAUDE.md` note 10).
- Do not add `detachPreviousScreen` to `PassportNavigator`/`RootNavigator` — it kills pop animations
  (`CLAUDE.md` note 9, guarded by `mainStackDetach.test.tsx`).
- If any of this lands in a `FlashList`, never animate cell height, and per-item state needs
  `useRecyclingState`.

**Open:** how far to go — tasteful polish vs. a full game-feel pass with celebratory moments. Worth
settling alongside Q4's design direction so motion and layout are designed together rather than
bolted on in sequence.

---

## BUG-1 — Quiz appears to freeze when you reopen the app and answer questions

**Status:** Open · **Type:** Bug · **Severity:** High — blocks completing a quiz · **Size:** Unknown until reproduced

**Reported:** background the app mid-quiz, reopen it, then answer a question — the screen appears to
freeze. Exact repro steps (how long backgrounded, which phase it was left in, whether an answer was
mid-flight) not yet pinned down.

> Not investigated or fixed — the notes below are **unverified hypotheses** from a read of the code,
> recorded so whoever picks this up doesn't start cold. Per `CLAUDE.md`, the first step is a failing
> test that reproduces it, *before* any fix attempt.

**Follow-up from the reporter: a "Something went wrong" screen appeared.** That copy, with a
"Try Again" button, is the **default `ErrorBoundary` fallback** (`mobile/src/components/ui/ErrorBoundary.tsx:74-77`)
— not any handled error state in the quiz screens, whose own error copy reads "We could not load your
quiz right now…" (`QuizPlayScreen.tsx:195`). `RootNavigator.tsx:52-87` wraps the entire stack,
including all five quiz screens, in that boundary.

**This reframes the bug: it is very likely a thrown render error — a crash caught by the boundary —
not a hang.** The "freeze" is probably the moment between the throw and the fallback rendering. That
moves hypotheses 1 and 3 below well down the list and makes "what threw?" the whole question.

**Highest-value next step:** get the actual error and component stack. `componentDidCatch` already
logs it via `logger.error` (`ErrorBoundary.tsx:43`), and per `CLAUDE.md` note 11 `console.error`
survives production stripping — so the stack should be recoverable from device/Xcode logs or a dev
build. That single stack trace likely resolves this outright.

**Still worth establishing:** whether the freeze and the error screen are one event or two separate
failures — i.e. does it always end at the boundary, or does it sometimes just sit there unresponsive?

**Suspect areas, roughly in order of plausibility:**

1. **Silently swallowed taps while a mutation is stuck pending.** `handleSelectCountry`
   (`QuizPlayScreen.tsx:138`) and `handleSelectYear` (`:148`) both early-return when
   `answerMutation.isPending`. If an answer request was in flight when the app backgrounded and its
   promise never settles on resume, `isPending` stays `true` forever — every tap is ignored, with no
   error and no spinner. That matches "freezes when you answer" precisely.
2. **Resume effect is gated on `phase === 'loading'`** (`QuizPlayScreen.tsx:90`). If `phase` is
   anything else by the time `playState` resolves, the resume never runs and the screen sits on the
   loading state indefinitely. Note `sessionStartedRef` (`:52`) also guards `ensurePlaySession` to
   once per mount.
3. **Screen freezing is enabled app-wide.** `App.tsx` calls `enableFreeze()` and stacks set
   `freezeOnBlur` (`CLAUDE.md` note 9). Worth ruling out that the quiz screen isn't un-freezing after
   a background/foreground cycle — this would be a literal freeze rather than a logic bug.
4. **Stale persisted session.** `ensurePlaySession` (`quizPlay.ts:92-99`) reuses a stored `sessionId`
   indefinitely with no expiry check — deliberately, since the first session seeds the score-to-beat.
   If the server has since expired or completed that session, the answer POST fails. That *should*
   land in `onError → 'error'`, so this is likelier a secondary symptom than the freeze itself.
5. **No `AppState` handling in the quiz feature at all.** Eight other files across the app subscribe
   to `AppState` (photo scan, permissions, onboarding store, clipboard); nothing under
   `src/screens/quiz/` or `src/services/quiz/` does. There is no foreground re-sync path — whatever
   state the screen was left in is what it wakes up with.

**Also check:** the API client has a 10s timeout and signs the user out on 401
(`mobile/src/services/api.ts`) — worth confirming a token refresh on resume isn't interacting badly
with an in-flight answer request.

**Interacts with Q8:** removing the per-question feedback phase changes this state machine
significantly. Fix the freeze first, and keep its regression test — then make sure the Q8 rework
doesn't reintroduce it.

---

## BUG-2 — Duplicate photos within a single quiz (multiple, not a one-off)

**Status:** Open · **Type:** Bug · **Severity:** High — visibly broken, and wastes scarce questions · **Size:** M

**Reported:** a generated quiz contained duplicate photos — and on a second look, **multiple**
duplicates in one quiz. Not an edge case.

> Not fixed. Notes below are from a code read only — **unverified**. Per `CLAUDE.md`, reproduce with a
> failing test first. Worth capturing the actual quiz (photo asset ids / storage paths) before it's
> regenerated, since that alone distinguishes the two causes below.

**First question to settle, because it splits the fix cleanly:** are the duplicates the *same asset*
appearing twice, or *different assets that look the same* (burst frames, HDR pairs, edited copies,
re-imported iCloud dupes)? Multiple duplicates in one quiz leans toward the latter.

**The structural gap:** there is **no dedup by image content anywhere in the pipeline**, and no
explicit same-asset dedup at pick time either. `pickQuizPhotos` (`candidateSelection.ts:277-283`) just
takes the country-spread ordering and slices it — if the eligible list contains a photo twice, the
quiz contains it twice.

**Where it can come from:**

1. **Near-identical distinct assets (most likely given "multiple").** Dedup is by asset `id` only.
   A burst, an HDR pair, or an edited copy is several distinct ids with effectively the same image,
   and every one of them can pass the geo gate and the vision gate. A camera roll full of bursts
   would produce exactly this — several duplicates in one quiz. Also worth noting the softer version
   of the same problem: different photos of the *same scene on the same day* are technically not
   duplicates but play just as badly.
2. **Same asset twice — should be guarded, verify it holds.** Within a creation run, `classifiedIds`
   is threaded through as `excludeIds` (`quizCreation.ts:605-607`, `:632`) so a photo shouldn't be
   classified twice across the first batch and the resample. If duplicates *are* same-id, that guard
   is failing and `classifyBatch`'s bookkeeping is the place to look.
3. **`usedAssetIds` deprioritizes, it does not exclude.** Throughout the selection machinery, used
   assets are only sorted after fresh ones (`orderByCountrySpread`, `candidateSelection.ts:201-213`).
   On a thin library the ordering wraps back around to already-used photos. This is the documented
   KTD12 freshness behavior — worth confirming it can't also surface the same photo twice in one run.
4. **Swaps can re-introduce a photo already in the quiz.** `loadSwapCandidates`
   (`quizPlay.ts:133-157`) says outright that this quiz's own photos are merely "pushed to the back of
   the picker" — deprioritized, not filtered out. Swapping a question can therefore pick a photo the
   quiz already uses. Only relevant if the reported quiz was swapped, but it's a real duplicate path
   and should be closed regardless.

**If the cause is (1), the fix is a content-level dedup** the pipeline currently has no concept of —
perceptual hash, or a cheaper heuristic using what's already cached (capture timestamp proximity +
country + dimensions would catch bursts without any image work). Worth scoping both before choosing.

**Related:** duplicates are especially costly because quizzes are only `QUIZ_MIN_PHOTOS`–`QUIZ_MAX_PHOTOS`
long and classification runs against a per-quiz budget (`CLASSIFICATION_BUDGET_PER_QUIZ`) — a wasted
slot is a meaningful fraction of the whole game, and the vision spend on it is already sunk.

---

## Q10 — Share challenge: the link should be its own item, not buried in the share text

**Status:** Open · **Type:** UX / Sharing · **Size:** S–M

Today the challenge link is **concatenated into the message string**
(`QuizResultsScreen.tsx:164-167`) — score copy plus the raw `share_url` glued on the end. The `url`
slot of the share payload is spent on the captured results card image instead
(`:184`), and on Android there's no `url` at all: the message is the entire payload (`:188`).

**Consequences:**

- Many share targets won't unfurl a link that arrives inside a text blob, so the challenge shows up
  as a bare URL rather than a rich preview — the worst possible presentation for something whose
  whole job is to get tapped.
- The recipient sees the URL as raw text mixed into a sentence.
- Anyone editing the message before sending can mangle or delete the link.

**Wanted:** the link travels as a **discrete item, separate from the share text**, so targets treat
it as a link and can preview it properly.

**The real tension to resolve:** iOS `Share.share` gives you one `message` and one `url` slot, and the
card image currently occupies `url`. So "separate link" and "attached card image" are competing for
the same slot — that conflict is the actual design decision here, not an oversight. Options worth
weighing:

- Drop the card image from the share sheet and let `url` carry the link (simplest; loses the visual hook).
- Keep the image and rely on the destination page's OG tags for the preview — i.e. accept that the
  card is the visual and the link is plain.
- Move to a share API that supports multiple activity items properly rather than RN's two-slot
  `Share.share`.

**Also check:** the public quiz page's OG/preview tags (`backend/app/templates/quiz.html`,
`backend/app/api/public_quiz.py`) — if the link becomes the primary shared item, its unfurl preview
becomes the thing people actually see, and it needs to be as good as the card.

**Related:** Q2 (the share copy carries the old "quiz" name), Q4/Q6 (the card is part of the same
visual system)

---

## Q11 — The shared card image looks janky; consider putting photos on it

**Status:** Open · **Type:** Design + Policy decision · **Size:** M · **Pairs with:** Q10

The big image attached to the share is `QuizChallengeVariant.tsx` — a 9:16 card that is currently
all type on a flat cream background: eyebrow, headline, a large rotated score plate, attribution, and
a logo footer. No imagery at all.

### Two separable problems

**(a) It renders poorly — likely a resolution/rasterization issue, not just taste.** The card is laid
out at `375 × 667` (`constants.ts:2-3`) but captured at `1080 × 1920` (`constants.ts:12-13`) — a
**2.88× upscale**. Everything on the card is text and borders, which is exactly what shows softness
and edge artifacts when rasterized up rather than laid out at target size. Strong first suspect for
"janky", and worth confirming before any redesign — a redesign at the same scale factor would look
just as soft.

Also noticed while looking: three different capture qualities coexist — `0.8`
(`ShareCardOverlay.tsx:156`), `0.9` (`:289`), and `0.95` (`constants.ts:11`). Worth checking which
path the quiz share actually takes and whether that's intentional.

**(b) It's visually thin.** A single flat color behind large type. For a product built entirely on
people's travel photos, the share artifact having zero imagery is a real missed opportunity — which
is where your instinct to pull the photos in comes from.

### ⚠️ Pulling in photos collides with a deliberate privacy decision

`QuizChallengeVariant.tsx:22-24` states it outright:

> Deliberately renders NO quiz photos: this card is always the public share artifact, and
> messaging-app caches outlive revocation — so no personal imagery ever leaves the app on it
> (mirrors the link-unfurl decision).

So the absence of photos is a **considered choice, not an oversight**: once a card image is shared,
it lives in recipients' message caches permanently and cannot be pulled back when a quiz is revoked.
The same reasoning governs the link-unfurl behavior, so changing it here means changing it in both
places or accepting an inconsistency.

**This needs your explicit call before any work starts.** Options:

1. **Keep the no-photos rule; fix the render and strengthen the design.** Solve (a), and add visual
   interest that isn't personal imagery — the passport-stamp motif, map/route textures, country
   shapes for the countries featured. Preserves the privacy guarantee.
2. **Allow photos, scoped.** E.g. only heavily-treated/cropped fragments, or only from quizzes the
   owner marks shareable, with revocation implications spelled out to the user. Needs a deliberate
   policy change, not a component edit.
3. **Allow photos freely** — accept that shared cards outlive revocation, and say so in the UI.

**Recommendation:** do (a) regardless — it's a bug-level fix that benefits every option — and treat
the photos question as a separate product decision rather than bundling them.

**Related:** Q10 (this card currently occupies the share `url` slot, which is exactly what's blocking
a discrete link — the two tickets share one payload), Q4/Q6 (same visual system), Q2 (card copy says
"TRAVEL PHOTO QUIZ" and will need the new name)

---

## Q12 — The entire public web flow (`/q/{slug}`) looks unstyled, lame, and ugly

**Status:** Open · **Type:** Design (web) · **Size:** L · **Highest leverage item in this doc**

Reported against a live example (local ngrok tunnel, `/q/e8f0ece07ca5b0babdad0402f803da5d`) — the
Atlasi share page reads as unstyled. On further review: **not just the landing state — the whole
flow**, including the score-to-beat and results pages, is lame and ugly.

**Scope is the full recipient journey, not one screen.** From the template's own classes, the states
needing design are:

| State                    | Key classes                                          |
| ------------------------ | ---------------------------------------------------- |
| Challenge intro / score to beat | `quiz-eyebrow`, `quiz-title`, `quiz-score-to-beat` |
| Playing a question       | `quiz-photo-frame`, `quiz-photo`, `quiz-options`, `quiz-progress` |
| Per-answer feedback      | `quiz-feedback`                                       |
| Final result             | `quiz-result-score`                                   |
| Name entry               | `quiz-name-form`, `quiz-input`, `quiz-label`          |
| Leaderboard              | `quiz-leaderboard`, `quiz-leaderboard-list`           |
| Install CTA              | `quiz-install`, `quiz-cta-link`                       |
| Revoked / gone           | `quiz-gone`                                           |

Treat this as one designed flow with a consistent visual language, not eight states patched
individually.

**Cross-check with the in-app tickets:** the same complaints land on both sides — Q6 (photo should
be full-bleed, not a boxed frame), Q8 (per-question feedback is boring; score at the end), and Q9
(no motion, everything cuts). The web flow has the same `quiz-photo-frame` and `quiz-feedback`
structure, so **whatever gets decided for the app should be decided once and applied to both**.
Otherwise the two halves of the same product diverge.

**It is not actually missing CSS.** Checked: `quiz.html` extends `base.html`, which loads the
stylesheet (`base.html:73-75`), and there is a dedicated `backend/app/static/css/src/pages/quiz.css`
with rules for essentially every class the template uses. Rebuilt the CSS locally to confirm the
committed output is current — it is. Only `quiz-view` has no rule, and that appears to be a JS
mode-toggle hook rather than a style hook (worth a quick confirm).

**The likelier explanation is that the styling is simply thin.** Line counts for the public page
styles:

| Page      | Source file                 | Lines |
| --------- | --------------------------- | ----: |
| List      | `src/pages/list.css`        |   845 |
| Landing   | `src/pages/landing.css`     |   799 |
| Blog      | `src/pages/blog.css`        |   459 |
| **Quiz**  | **`src/pages/quiz.css`**    | **296** |
| Contact   | `src/pages/contact.css`     |   162 |

The quiz page carries roughly a third of the design investment of the other flagship public pages,
while being the one a recipient hits *first* — usually before they've ever seen the app. It's doing
functional layout, not design.

**Why this matters more than its size suggests:** this page is the entire first impression for every
invited player and the top of the acquisition funnel. Q10 and Q11 are both about driving people
*to* this page — if it doesn't hold up on arrival, those improvements convert into a worse
experience, not a better one. Worth prioritizing above the in-app polish tickets.

**Constraints to respect (they shape what's possible):**

- **Strict CSP** — no inline styles, no inline handlers; all dynamic text is set via `textContent`
  in `quiz-play.js` (documented in the `quiz.html` header comment). Any redesign has to work within
  that, and CSS must live in the source files.
- Edits go in `backend/app/static/css/src/`, then `node scripts/build-css.js` must be run and the
  generated `styles.css` + `styles.min.css` committed (per `CLAUDE.md`).
- The "gone"/revoked mode is deliberately content-free (no photos, names, or scores) and must stay
  that way — it needs to look intentional, not like an error.

**Also worth checking while in here:** the page's OG/unfurl tags, which Q10 makes load-bearing if the
link becomes a discrete share item.

**Note on verification:** I did not load the ngrok URL — it's a temporary tunnel to your local
machine, and the page is JS-hydrated, so fetching HTML wouldn't show what you're seeing anyway.
Findings above come from the template and CSS source. A screenshot would sharpen this ticket a lot.
