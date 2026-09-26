---
title: Scan Experience Redesign - Carousel Polish and One Scanning Stage
type: feat
date: 2026-09-20
status: ready-for-implementation
supersedes-in-part: docs/plans/2026-09-16-1750-feat-photo-permission-carousel-plan.md
execution: code
---

# Scan Experience Redesign - Plan

This plan follows the operator's review of the shipped permission carousel and
live country pull-in (commits `2c6880f5` through `85eb45ca` on
`photo-onboarding`). It is a hand-off for the implementing agent. No code was
written while preparing it.

Review screenshots referenced below live in
`~/Desktop/atlasi-scan-review-2026-09-20/` (numbered `01`–`22`, plus
`ref-aesty-beat{1,2,3}.png` from the reference video and two contact sheets,
`contact-quiz-door.png` and `contact-trips-door.png`).

---

## 1. Why the shipped work missed the brief

The brief was the aesty onboarding video: a three-beat walkthrough where the
visual does the talking, every beat sits inside one framed card on a calm
background, motion is continuous, and copy is a short title and one short line.

What shipped has the right skeleton (three beats, dots, persistent footer,
OS-shaped stack) but reads flat, and the scanning screens that follow are two
unrelated text-heavy layouts. Concretely:

**Carousel (both doors)**

- The beat visual floats on a plain cream field with no frame. The reference
  puts every visual inside one rounded card with a soft shadow, which is what
  makes the three beats feel like one object changing state (`ref-aesty-*`).
- Quiz door: the hero region is cream during the carousel (`permissionHero`
  in `quizCreationStyles.ts`), so the dark-navy stage the rest of the quiz
  screen uses disappears. The status bar is `light-content` on a cream
  background and is unreadable (`01-quiz-beat1.png`, top-left).
- Quiz door beat 1: the back button overlaps the first photo tile (`01`).
- Quiz door beat 3: the rows pin to the top-left under the back button and
  leave a large empty band above the title (`05`, `06`). Stamp and name sit
  far left, thumbnails far right (`justifyContent: space-between` in
  `CountryRow`), so the row does not read as "photo lands on its shelf".
- Trips door: the compact visual is centered in leftover flex space, so a
  blank band sits between the header and the grid (`15`–`17`).
- Beat 3 fly-in: thumbnails enter from far off-screen top-left one at a time
  (`PassportBeat` interpolates from `-110 - slot*42, -70`); mid-flight frames
  show tiles hanging in empty space (`05`, `17`). The reference flies items
  from the card's center into their row.
- Loop reset: all badges and tiles snap back to zero after the hold, then
  replay. It reads as a glitch rather than a loop (`02` vs `01`).

**The idle screen after the grant (operator screenshot, `23-trips-idle-after-grant-operator-device.png`)**

- On the trips door, when the entry did not pass `autoStart` (Trip Detail,
  Country Detail `Find via Photos`, Photo Trips), granting access lands on
  `IdlePhase`: a 120pt polaroid illustration, the `PrivacyNotice` title and
  three bullets, a second title (`Ready to scan`), a body sentence, the scale
  and duration lines, then `Start Scan`. That is a second, text-only pitch
  immediately after the user watched three beats and tapped Allow Full
  Access. The carousel did not replace this screen; it was stacked in front
  of it, so the combined flow now has more text than before the carousel
  shipped.
- Four text styles on one screen (Playfair title, Open Sans bold notice
  title, bulleted body, plain body), nothing animated, nothing on brand.
- The privacy bullets repeat claims the carousel and its lock footer already
  made, in longer form.

**Scanning surfaces (the operator's two screenshots)**

- `BuildProgressSheet` renders three paragraphs of body copy (about 90 words)
  plus two ghost buttons under the rows region (`10`–`13`). That is the
  longest wait in the app, and the screen is mostly grey text.
- The rows region reserves a fixed 5:2 block that sits empty for the first
  30–40 seconds of a large-library scan (`10`, `11`), then clips the third
  row mid-stamp (`13`).
- The hero above the sheet is a blank navy block with only the eyebrow
  during the whole build (`10`–`13`).
- Thumbnails are frequently absent. On the operator's device the Canada row
  had none; on the simulator no row ever got one (`12`, `13`, `21`). The
  picker excludes `isNetworkAsset` photos (`scanPreviewPicker.ts`,
  `addCandidate`), so on an iCloud-optimized library most countries never
  qualify, and a stamp-only row looks broken.
- The trips door's `ScanningPhase` is a different design entirely: spinner,
  different type scale, a full persistence paragraph above the rows, Cancel
  pushed to the bottom edge, and rows labelled with ISO codes ("CA", "GE",
  "TR") instead of names (`20`, `21`). `photoScanSteps.ts` names rows with
  `getCountryName`, which falls back to the code when `Intl.DisplayNames` is
  unavailable (Hermes), while the quiz path names rows from the countries
  reference (`quizPoolSetup.ts:211`).

---

## 2. Goals

1. One scanning stage, shared by both doors, that looks like the carousel's
   beat 3 come to life: photos land on country shelves inside a framed card.
2. Copy budget: a title of at most six words, one status line of at most ten
   words, and nothing else static. Any additional message rotates through
   the single status line with a crossfade.
3. The carousel matches the reference's polish: framed card, continuous
   motion, readable status bar, no overlaps, no dead bands.
4. Trips and quiz doors are visually identical apart from the header and the
   door-specific beat 3 title.
5. No second pitch. After Allow Full Access there is at most one screen
   before the scan starts, and it is the stage card holding still, not a
   text page. Every surface on the path from door to scan complete has a
   hard word budget (section 3.8), enforced by the copy test.

Non-goals: the OS-shaped stack (KD1), the analytics funnel, the copy law in
`scanCopy.ts` (locked vocabulary and banned words still apply), the preview
picker's cap (10 rows × 2 previews), backend.

---

## 3. Design specification

### 3.1 The frame

Both doors render the beat visual and, later, the live scan inside the same
container, called the **stage card** here:

- Rounded rectangle, radius 24, `warmCream` fill, soft shadow (`shadowOpacity`
  0.18, radius 24, offset y 12), 1px `withAlpha(midnightNavy, 0.06)` border.
- Sits on the navy hero region on the quiz door and on a navy hero band added
  to the trips door (the trips door currently has no dark region; add one the
  same height as the quiz hero so the two doors match).
- Fixed aspect ratio 4:5, width = screen width minus 48. The card never
  resizes between beats or between carousel and scan; only its contents
  change. This keeps the R9 alignment work intact because nothing below the
  card moves.
- Status bar is `light-content` on both doors during carousel and scan.
- The back button sits in the hero's safe-area row above the card, never
  over it.

### 3.2 Carousel beats inside the card

Each beat fills the card. Cross-fade between beats stays (existing
`PermissionBeatVisual`), but the incoming beat's animation starts from its
first frame when it becomes active, and the outgoing beat freezes.

**Beat 1 — grid.** 4 columns × 5 rows of tiles filling the card edge to edge
with 4pt gutters (the reference grid). Check badges pop (spring) onto the
travel tiles in reading order, stagger 140ms. After the last badge, hold
1.6s, then crossfade the whole grid to 0 over 300ms and start again. No snap
reset.

**Beat 2 — one photo.** The photo fills the card at `cover`. Three pills pop
in with a short leader dot, staggered 220ms, positioned around the subject
(top-right, mid-left, bottom-right as today). Hold 1.6s, crossfade out, loop.

**Beat 3 — shelves.** Three shelf rows inside the card, each: stamp (44pt)
+ country name on the left, two 56pt photo slots immediately to the right of
the name (gap 12, not `space-between`). Photos fly in from the card's center
(scale 0.6 → 1, opacity 0 → 1, translate from center to slot), one per
220ms, spring. Hold, crossfade, loop. Home country is skipped (unchanged).

### 3.3 The live scanning stage (replaces `BuildProgressSheet`'s rows region and `ScanningPhase`'s body)

The same stage card, now driven by real data:

- **Before the first row arrives:** the beat-1 grid shape, but with neutral
  tiles (the existing `SlotPlaceholderMark` style, never fake photos) and a
  slow left-to-right sweep highlight, 1.8s per pass. This replaces the empty
  5:2 block and the spinner. It communicates "reading" without words.
- **On the first arrival:** the grid crossfades out and the shelf layout
  fades in. Rows arrive one per `SCAN_MIN_ARRIVAL_GAP` as today, from the
  bottom of the card (new row pushes older rows up, translateY spring). The
  card shows the newest four rows; older rows scroll out of the top edge
  behind a 24pt gradient mask. The 10-row slice is unchanged.
- **Thumbnails** fly in from the center of the card as in beat 3. Same
  primitive, same timings (`scanMotion.ts`).
- **No thumbnail available:** render the row with the stamp only, but give
  the empty slot a subtle placeholder tile (same as the pre-arrival grid) so
  the row shape stays consistent. Today an empty slot renders nothing.
- **Scan complete:** queued arrivals drain immediately (unchanged), then the
  card holds its last frame while the host transitions.

### 3.4 Below the card (the sheet)

Identical on both doors, top to bottom:

1. Title, Playfair 26: `Building Your Challenge` (quiz) / `Finding Your Trips`
   (trips). One line each.
2. Counter, as today's quiz counter: `3,750` of `53,377`. Thin gold bar under
   it. (Trips currently shows a spinner and a long sentence; use the counter.)
3. **One rotating status line**, Open Sans 15, `stormGray`, single line,
   crossfade 400ms every 4s. Nothing else.
4. Actions in one row: `Leave It Running` (ghost) and `Stop` (text). First
   scan only, as today.

Everything else that is on screen today (`workingPrivacy[0]`,
`workingPrivacy[1]`, `persistenceParagraph`, the trips `scanningHint`) is
removed from these two surfaces. It is not deleted from `scanCopy.ts` while
other surfaces still use it.

### 3.5 Rotating status lines

Add `SCAN_COPY.shared.stageLines(kind)` returning an ordered list. Each line
at most ten words, all inside the locked vocabulary, registered in
`allStrings()`, passing the banned-phrase test. Proposed set (the agent may
tune wording but not length or claims):

| Order | Line | Source claim |
| ----- | ---- | ------------ |
| 1 | Reading where each photo was taken | scanning status |
| 2 | Everything stays on your device | `workingPrivacy[0]` |
| 3 | The same scan builds your trips | `workingPrivacy[1]` (quiz only) |
| 4 | Keeps going while you use the app | `leaveHint` |
| 5 | Picks up where it left off next time you open it | `resumeHint` |
| 6 | Only photos your challenge uses are ever uploaded | `workingPrivacy[0]` (quiz only) |

Rotation rules: the line under the card cycles in order and wraps; the
first line stays for 6s on mount, the rest 4s each. When the lease-held hint
applies (`useLeaseKeepsRunning`), line 4 is replaced by
`leaveHintWhileLeased` shortened to the same budget. Reduce Motion: no
crossfade, lines still rotate (opacity swap).

### 3.6 Copy budget for the carousel

Titles at most six words, subtitles at most twelve. Proposed:

| Beat | Title | Subtitle |
| ---- | ----- | -------- |
| 1 | Find your trips in your photos | We read only where each photo was taken. |
| 2 | Your phone does the reading | On your device. Location data only. |
| 3 trips | Every trip lands in your passport | And unlocks Guess Where. |
| 3 quiz | Your photos become challenges | The same scan builds your trips. |

Footer stays: `The scan runs on your device · Full Access finds more trips`.
The privacy claim dropped from beat 3's subtitle is carried by the footer,
which is on screen at the same time. R7's per-beat privacy point is met by
beat 1 (what is read), beat 2 (where), and the footer (during the scan).

### 3.7 The idle screen becomes the stage holding still

`IdlePhase` is rebuilt on the same frame, so door → idle → scan is one card
changing state, not three designs.

- **Arriving from the carousel grant (status was `undetermined`):** skip idle
  entirely. Allow Full Access is the consent; the scan starts as it does on
  the `autoStart` path today. `usePhotoImportWorkflow` treats a grant that
  came through the carousel as `autoStart: true` regardless of the route
  param.
- **First run, arriving with access already granted** (Trip Detail, Country
  Detail, Photo Trips): the stage card shows beat 3 held on its final frame
  (shelves full, no loop). Below the card: title `Ready to scan`, one line
  `About 53,000 photos · several minutes` (scale and duration merged, at
  most eight words, omitted when the count is unknown), the `Start Scan`
  button, and the lock footer. Nothing else. The polaroid illustration, the
  `PrivacyNotice` block, and the body sentence are removed from this screen.
- **Returning run:** the card shows the pre-arrival sweep grid held still.
  Title `Check for New Photos`, one line `Last scanned 3 days ago`, the
  button, and `Refresh All Photos` as a text link. The returning body
  sentence is removed.
- `PrivacyNotice` has no other consumer after this; delete it and its test.
  `privacyTitle` and `privacyBullets` stay in `scanCopy.ts` only if the
  profile `PhotoLibraryEnableModal` still reads them; otherwise delete.

### 3.8 Word budget for every surface on the scan path

The copy test gains a per-surface budget assertion. Budgets count words of
static text rendered at once, excluding button labels and the lock footer.

| Surface | Today (approx.) | Budget | What changes |
| ------- | --------------- | ------ | ------------ |
| Carousel beat (each) | 25–35 | 18 | 3.6 |
| Trips idle, first run | 95 | 12 | 3.7 |
| Trips idle, returning | 45 | 10 | 3.7 |
| Quiz intro (`New Challenge`) | 60–75 | 20 | Keep `introBody`. Replace `freshnessNeverSynced` + `scaleLine` + `durationLine` with the one merged line from 3.7. `freshnessReady` becomes `Library ready · 53,000 photos`. |
| Quiz build / trips scan | 90–100 | 16 | 3.4, one rotating line |
| Recovery sheet, denied | 45 + tip | 18 | `Full Access finds trips across your library. The scan runs on your device.` Drop the third sentence (footer carries it). Privacy Report tip moves behind a `Why is this safe?` disclosure, collapsed by default. |
| Recovery sheet, limited | 55 + tip | 20 | Same treatment. |
| Thin library | (unchanged) | 24 | Audit only; trim if over. |

Anything cut from a surface here is not deleted from `scanCopy.ts` until
`grep` shows no consumer; the test's `allStrings()` list is updated in the
same commit as the deletion.

---

## 4. Bugs to fix alongside (each gets a failing test first)

1. **Trips rows show ISO codes.** `photoScanSteps.ts:107` uses
   `getCountryName(code)`. Name rows from the countries reference the quiz
   path already uses, falling back to `getCountryName` only when the
   reference has no entry. Test: a scan batch for `CA` with the reference
   loaded yields a row named `Canada`.
2. **Thumbnails absent on iCloud-optimized libraries.** Decision for the
   agent to implement: keep `isNetworkAsset` photos as *last-resort*
   candidates (ranked below all local ones) and render them through
   `PhotoThumbnail` with `recoverOnError={false}` at the 56pt slot size.
   Photos keeps small thumbnails locally for offloaded assets, so a `ph://`
   request at that size usually resolves without a download; if it errors
   the slot drops as today (R18). Never call `resolveLoadableUri` from the
   scan. Test: picker with only network assets for a country still returns
   up to two previews, ranked after any local ones.
3. **Empty slot renders nothing.** Per 3.3, render the placeholder tile.
4. **Quiz rows region clips the third row.** Removed by the fixed-height card
   with a masked top edge (3.3).
5. **Status bar unreadable on the quiz carousel.** Fixed by the navy hero
   (3.1).

---

## 5. Implementation units

Dependency order. Each unit lands as its own commit on `photo-onboarding`
with lint, format, tests green (see CLAUDE.md pre-commit checklist).

### U1. Copy
- `mobile/src/constants/scanCopy.ts`: new beat titles/subtitles (3.6),
  `stageLines(kind)` (3.5), `trips.stageTitle`. Register in
  `mobile/src/__tests__/constants/scanCopy.test.ts` `allStrings()`.
- Add a length assertion in the copy test: every `stageLines` entry ≤ 10
  words, every carousel title ≤ 6 words, subtitle ≤ 12.

### U2. `StageCard` primitive
- New `mobile/src/components/photos/StageCard.tsx`: the frame from 3.1
  (size, radius, shadow, border, overflow hidden). Presentational only.
- Unit test: fixed aspect ratio and width; children rendered.

### U3. Beats inside the card
- `TripsFoundBeat`, `OnDeviceBeat`, `PassportBeat`: fill the card, new grid
  dims, fly-in from center, crossfade loop instead of snap reset
  (`permissionMotion.ts` gains `PERMISSION_BEAT_FADE_OUT`).
- `CountryRow`: slots follow the name with `gap: 12`; no `space-between`.
- `PermissionBeatVisual`: wraps in `StageCard`; drop the `compact` variant.
- Tests: existing `permissionBeats.test.tsx` updated; Reduce Motion still
  renders final frames.

### U4. Door layout
- `QuizCreationScreen`: `permissionHero` becomes navy; card centered in the
  hero with the back button in the safe-area row above it.
- `PhotoImportScreen` + `photoImportStyles.ts`: add the navy hero band and
  card above the carousel; header title moves into the band.
- Re-verify R9 (Allow Full Access alignment within 24pt on SE and 16 Pro
  Max, both doors) and update the alignment test if the band moved the
  stack.

### U5. `ScanStage` component (the live card)
- New `mobile/src/components/photos/ScanStage.tsx`: takes `rows`,
  `isComplete`, `isPaused`, `reduceMotion`. Pre-arrival sweep grid; shelf
  layout with bottom-in arrivals, top gradient mask, newest four visible;
  placeholder tile in empty slots. Reuses `CountryRow`, `scanMotion.ts`, and
  the FIFO from `CountryDiscoveryRows` (extract the queue into a hook,
  `useArrivalQueue`, so both can share it; then delete `CountryDiscoveryRows`
  once nothing imports it).
- Tests: sweep renders before rows; first arrival swaps layouts; queue
  drains on complete (port the existing `CountryDiscoveryRows` tests).

### U6. `RotatingStatusLine`
- New `mobile/src/components/photos/RotatingStatusLine.tsx`: takes `lines`,
  `firstHoldMs`, `holdMs`, `reduceMotion`. Crossfade with Reanimated.
- Test with fake timers (see memory note on `doNotFake: ['setImmediate']`).

### U7. Wire both doors
- `BuildProgressSheet`: hero region hosts `ScanStage` while
  `step === 'scanning'`, then the existing slot grid inside the same card for
  `checking`/`building`; sheet body per 3.4; remove the three paragraphs.
- `ScanningPhase`: same composition; remove spinner, hint paragraph, and the
  bottom Cancel in favour of the shared action row (Cancel keeps its
  confirmation alert).
- Tests: `BuildProgressSheet` and `ScanningPhase` snapshots assert no
  `quiz-privacy-line`, `quiz-trips-line`, `quiz-persistence-line`, or
  `scanningHint` testIDs render.

### U8. Bug fixes from section 4
- Country names (4.1), network-asset previews (4.2). Failing tests first.

### U9. Idle screen on the stage
- `IdlePhase.tsx`: rebuild per 3.7 on `StageCard` with `PassportBeat`
  (held, `isActive={false}`) for first run and the sweep grid for returning.
  Remove the polaroid image, `PrivacyNotice`, `idleBodyFirst`,
  `idleBodyReturning`, and the separate scale and duration lines.
- `usePhotoImportWorkflow.ts` / `useAutoStartWorkflow.ts`: a carousel grant
  starts the scan without showing idle, on every route.
- `scanCopy.ts`: `shared.scaleAndDurationLine(total)` (merged, ≤ 8 words),
  `trips.lastScannedLine(when)`.
- Delete `PrivacyNotice.tsx` and its test once unused.
- Tests: idle first-run renders no `photo-import-privacy` testID; a
  carousel grant on a non-autoStart route transitions to `scanning` without
  rendering idle.

### U10. Copy audit and budgets
- Implement the 3.8 table: quiz intro lines, recovery sheet bodies with the
  collapsed Privacy Report disclosure, thin-library check.
- `scanCopy.test.ts`: add `SURFACE_BUDGETS` and a test that renders each
  surface's static strings and asserts the word count. This is the guard
  that stops the text creeping back.

### U11. Docs
- Update `docs/photo-import.md` section on the scan surfaces and the
  carousel; note the removed paragraphs and where their claims now live.

---

## 6. Verification

Automated: `npm run lint`, `npm run format:check`, `npm test`, plus
`npx tsc --noEmit`, from `mobile/`.

Manual, on the iPhone 17 simulator (booted, UDID
`BBBE0480-054D-4B95-8F4A-9D9B4D05E1A4`) with Metro running:

1. Reset the photo permission so the carousel shows again:
   `xcrun simctl privacy booted reset photos com.atlasi.app`
   then relaunch: `xcrun simctl launch booted com.atlasi.app`.
2. **Trips door:** passport home → the `Sync Your Photos` card. This is the
   only carousel entry on the home screen for a fresh user; the Guess Where
   card replaces it only after a first import (`PassportScreen.tsx:88`,
   `showGuessWhere = hasInitialImport || quizCount > 0`).
3. **Quiz door:** passport home → gear (Profile) → scroll to the `Guess
   Where` row → `+` in the top-right of My Challenges → carousel.
4. Walk beats 1 → 2 → 3 with Continue, swipe back once, tap Allow Full
   Access, grant on the OS sheet. Quiz door then shows the New Challenge
   intro; tap Build My Challenge. Trips door auto-starts the scan.
5. Capture with `xcrun simctl io booted screenshot <file>.png` at 0s, 15s,
   45s, 90s. The simulator library has 53,377 photos, so the scan runs long
   enough to watch rows arrive.
6. **Idle screen:** with access already granted, passport home → United
   States stamp → `Find via Photos`. Before U9 this shows the text page in
   `23-trips-idle-after-grant-operator-device.png`; after U9 it shows the
   held stage card with one line and one button. Also confirm that
   completing the carousel on this route goes straight to scanning.

Review checklist for the operator (each should be a yes):

- Card frame identical on both doors and identical between beat 3 and the
  live scan.
- No text under the card other than title, counter, one rotating line,
  action row.
- After Allow Full Access there is never a text page before the scan; the
  idle screen (when reached directly) is the card, one line, one button.
- Every surface on the path is within its 3.8 budget; no bullets anywhere.
- Rows arrive from the bottom, photos fly from center; no tile ever hangs in
  empty space.
- Row names are country names on both doors.
- Every row shows at least a placeholder tile in each slot.
- Status bar readable on every screen.

---

## 7. Appendix A — driving the simulator from the terminal

Detox is configured (`mobile/.detoxrc.js`, `npm run e2e:build:ios`) but needs
a fresh simulator build and has no flow for this screen. The screenshots for
this review were taken against the dev client already installed on the
simulator using synthetic mouse events. The approach, for repeat passes:

1. Simulator → Window → uncheck `Show Device Bezels`. Read the screen rect
   with AppleScript (`System Events` → process `Simulator` → window 1 → first
   `AXGroup` position and size). On this machine it was origin (363, 126),
   size 347 × 754, for a 402 × 874 pt device, so screen = origin + pt × 0.863.
2. Post `CGEvent` mouse events with a 20-line Swift CLI (`tap x y`,
   `swipe x1 y1 x2 y2`, click state set to 1, posted to `.cghidEventTap`).
   The terminal app needs Accessibility permission (Cursor already has it).
3. Screenshot with `xcrun simctl io booted screenshot`.

Swipe-back on the pager works on the quiz door (`07`). It could not be
confirmed on the trips door because the drag missed the pager band; verify
by hand after U4 moves the layout.

## 8. Appendix B — observations not in scope

- The `A library this size takes several minutes.` duration line did not
  render on either the intro or the build sheet during the simulator pass;
  check `durationLine` wiring when touching U7.
- A dev-only RevenueCat error toast appears on relaunch; unrelated.
