# On-Device Sweep Checklist — U4 / U5 / U6

Companion to `2026-07-12-001-fix-perf-pass-nav-regressions-plan.md`.
U1–U3 are landed (PR #110). Everything below needs a **dev build on a physical device** —
Jest cannot observe react-freeze, `activityState`, or animation smoothness, which is
exactly how the original regression shipped green.

Work top to bottom. **Step 1 is the flagship** — if it fails, stop and report; the rest is moot.

---

## Setup (once)

**Frame metrics are OFF by default.** To get the START/STOP perf overlay to appear:

`mobile/src/utils/perf/frameMetrics.ts:115`
```js
const ENABLED_IN_DEV = false;   // -> true
```
The overlay (`PerfOverlay`) is already mounted in `App.tsx:187` and is `__DEV__`-gated,
so nothing ships. **Revert this line before committing.**

Then: `cd mobile && npx expo start --dev-client` and build to the device.

---

## 1. Flagship — the regression itself (R1, R2)

The whole point of U1. Do this first.

| # | Action | Pass = |
|---|---|---|
| 1.1 | Passport → tap a country → **back** | During the pop, the **passport grid underneath visibly scales (0.95→1) and translates**. It is *not* a frozen/dead layer. |
| 1.2 | Same, watching the grid on return | **No flash.** No empty-then-fill on the ~200 stamp/country cards, no skeleton, no re-decode. |
| 1.3 | Same, watching row fade-in on return | **No entrance-stagger replay.** Rows already shown do not re-fade from 0.4 opacity. → this is the **U5 decision** (see §3). |
| 1.4 | Dismiss the **paywall** over Main | Main co-animates underneath, same as 1.1. (R2 — same U12 mechanism on RootNavigator.) |
| 1.5 | Dismiss **auth** over Main | Same. |

> If 1.1 still shows a dead underlayer, **stop.** That is the plan's stop-condition (a):
> removing `detachPreviousScreen` did not restore the pop. Report before going further.

---

## 2. U4 — React Compiler A/B

Only meaningful **after** U1+U2, which is the point: the compiler is judged on *residual*
behavior, so it can't be blamed for a defect the detach flag was causing.

**Toggle** — `mobile/app.config.js:20`:
```js
experiments: {
  reactCompiler: true,   // <- comment out for the "off" pass
},
```
Requires a **dev-build restart** (not a store build). It is a build-time transform.

⚠️ **Commit hygiene:** `app.config.js` also carries your uncommitted `buildNumber: '3'→'4'`
hunk (line 28, unrelated photo-match work). If you end up changing the compiler flag for
real, stage **only** that hunk: `git add -p mobile/app.config.js`.

| # | Action | Record |
|---|---|---|
| 2.1 | Compiler **ON**: passport→detail→back; CountryDetail **hero scroll** (the `Animated.Value` one — prime suspect); Dreams taps; celebration overlay | Any drift/jank? |
| 2.2 | Compiler **OFF**: same three | Any difference? |

**Decision:**
- **Indistinguishable** → keep it enabled. Record that. *(most likely outcome)*
- **Drift with it on** → add `'use no memo'` **only** to the screens driving legacy
  `Animated.Value` styles during render — `CountryDetailScreen.tsx` first — and re-test.
- **Opt-outs can't stabilize it** → disable the flag in its own commit **with the evidence**.
  A silent revert is not an acceptable outcome (R4).

---

## 3. U5 — Entrance-stagger replay guard (conditional)

**Decided entirely by result 1.3.** Do not build this speculatively.

- **No replay on back-nav** → **skip the unit**, record the skip. Expected: the row bookkeeping
  (`animatedRowKeysRef` in `usePassportAnimations.ts`) is component-scoped, so it only resets
  on remount — and U1 should have removed the remount.
- **Replay persists** → hoist that bookkeeping outside the component (module-level map keyed
  by country set) so restored rows seed at 1 instead of 0.4.

Note: **double-tap tab reset is *expected* to re-stagger** — that's a fresh visit, not a
restore. The target is *back-navigation* only.

---

## 4. U6 — Full 14-surface sweep

One line per origin perf unit. Mark ✅ / ⚠️ / ❌. Anything new: fix if it's a one-liner,
otherwise file it **with a cause hypothesis**.

| Origin unit | Surface to exercise | Looking for |
|---|---|---|
| U2 | Onboarding forward **and back** | Jank on back-nav → if present, this navigator still has its detach; file the same treatment as U1 (plan pre-authorizes this as a follow-up). |
| U3 | Country tap responsiveness | Lag between tap and push. |
| U4 | Onboarding country selection (rapid taps) | Persistence debounce still batching. |
| U5 | Card look **at rest and in motion** | Static substitution already user-accepted — only flag *motion* problems. |
| U6 | Welcome carousel / slider video | Plays, releases decoder on blur. Depends on `enableFreeze()`, which U1 kept. |
| U7 | Entry grids, galleries | Image decode flashes. |
| U8 | Photo-import upload flow (smoke) | Uploads still resize. |
| U9 | Leave app idle → return (token refresh) | No flicker/re-render storm on `TOKEN_REFRESHED`. |
| U10 | **Cold start** | Boot feel vs before. |
| U11 | Dreams taps, trip open | Tap one card → siblings must not re-render. (U2's memo-hold wins.) |
| U12 | *This is what U1 reverted* | Covered by §1. |
| U13 | Stamp + hero art on the 3× device | Softness from the downscale. **Flag only — do not fix here** (scope boundary). |
| U14 | *Covered by §2.* | |
| — | Paywall/auth dismiss | Covered by 1.4/1.5. |

---

## 5. Frame metrics (quantify the give-back from un-detaching)

Un-detaching restores the grid's liveness under CountryDetail — the thing origin-U12 targeted.
Confirm we didn't hand back the perf win. **Same build type as the origin baselines.**

Two scripted runs (per origin plan U1), using the overlay's START/STOP:

1. **Onboarding run** — full onboarding flow with ~30 country taps.
2. **Main-tab tour** — passport scroll → Dreams taps → trip open.

Record per run: total frames, drops >17 ms, hard drops >34 ms, longest stall, duration.

**Pass:** no return to the *pre-perf-pass* baseline drop counts. A modest give-back vs the
peak is acceptable and expected; a full regression to baseline is not.

---

## Reporting back

For each of §1–§5: ✅ / ⚠️ / ❌ + what you saw. I'll turn that into U4's config commit
(if any), U5's build-or-skip, and the PR evidence table.

**Remember to revert `ENABLED_IN_DEV` to `false`.**
