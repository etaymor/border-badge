# Photo library permission preheat plan

Users who open Guess Where or trip scan get a trust-first Photos ask that favors Full Access without lying about uploads. Maintainers get one permission phase machine and one funnel. The rule is honest SCAN_COPY claims, Sundrop preheat mechanics, no buried OS sheet on autoStart. PR order is photo-perm-01, photo-perm-02, photo-perm-03, photo-perm-04, photo-perm-05.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. The operator reviews and lands every PR. photo-perm-02, photo-perm-03, and photo-perm-04 are review-gated.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on her explicit go.
- [ ] On her go, arm a `/goal` with this exact text. "docs/plans/2026-08-31-001-feat-photo-library-permission-preheat-plan.md, PR ids photo-perm-01 through photo-perm-05 in order, verification rule is unit plus live plus perf, operator merges each PR after review-gated ones clear chat review, done when photo-perm-05 is merge-ready on the stack."
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `git show origin/main:pstack/skills/swarm/SKILL.md`
  - [ ] `git show origin/main:.cursor/skills/verify-atlasi/SKILL.md` (fallback when pstack path missing, use `ios-simulator-skill`)
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `git show origin/main:pstack/skills/principle-model-the-domain/SKILL.md`
  - [ ] `git show origin/main:pstack/skills/principle-experience-first/SKILL.md`
- [ ] Arm the 30-minute audit tick. In a local session, a real terminal `/loop`. In a cloud root, a cloud-sleeper wake chain. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk and the armed /goal. Audit the operation against both and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then send the operator a status message, whether or not anything changed, with the queue table of PR, owner, state, and head SHA, the verdicts since the last tick, what merged, open operator gates, and blockers."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] photo-perm-01 is first from `main`.
  - [ ] photo-perm-02 after photo-perm-01.
  - [ ] photo-perm-03 after photo-perm-02.
  - [ ] photo-perm-04 after photo-perm-03.
  - [ ] photo-perm-05 after photo-perm-04.
- [ ] Hold the file boundaries. photo-perm-01 touches only analytics plus thin call-site hooks. photo-perm-02 touches permission UI and phase types. photo-perm-03 touches preheat layout and autoStart. photo-perm-04 touches limited picker wiring. photo-perm-05 touches Info.plist strings and secondary ImagePicker callers.
- [ ] Hold the review gate. photo-perm-02, photo-perm-03, and photo-perm-04 change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Open the PR ready, never draft, with `gh pr create` and `draft: false`, or with Graphite `gt` for a stack.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Rebase onto current trunk before babysit and again before the merge-ready report.

### Verdict and merge, for every PR

- [ ] At the merge-ready head SHA, run the swarm per `pstack/skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. One audit lane that reads the diff and the receipts and distrusts the PR body.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner. A new head gets a fresh swarm and a fresh verdict.
- [ ] Root appends the PR to the Graphite stack on a clean verdict. The operator lands. If `gt` is missing, open stacked `gh` PRs with explicit bases and the same no-auto-merge rule.

### Boot recipe, for every live lane

Each live lane runs on its own cloud VM at the PR head. Drive through the iOS simulator skill (`.claude/skills/ios-simulator-skill` or repo `verify-atlasi`).

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Start Metro and the iOS Simulator Atlasi build. Wait for the passport home.
- [ ] Deliver input only through simulator navigator and accessibility maps. Read-only diagnostics are `sim_health_check`, `screen_mapper`, and device logs.
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## Instrument the permission funnel (photo-perm-01)

**Depends on.** None.

**Files.**

- [ ] Edit `mobile/src/services/analytics.ts`.
- [ ] Edit `mobile/src/hooks/usePhotoPermissions.ts`.
- [ ] Edit `mobile/src/screens/quiz/creation/useQuizCreationFlow.ts`.
- [ ] Edit `mobile/src/services/photoImport/photoImportService.ts`.
- [ ] Edit `mobile/src/screens/photos/useAutoStartWorkflow.ts`.
- [ ] Create `mobile/src/__tests__/services/photoPermissionAnalytics.test.ts`.

**Build.**

- [ ] Add `photo_permission_soft_ask_shown` and `photo_permission_os_result` with `door` in `quiz | trips | profile | other` and `status` in `granted | limited | denied | undetermined`. Fire soft-ask when quiz shows `permission-request` or trips would prompt, and fire os-result wherever `requestPermissionsAsync` returns.

**You see.**

- [ ] A first Guess Where ask logs soft-ask then os-result. A Passport autoStart trip scan logs os-result with `door=trips` even before preheat exists.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `photoPermissionAnalytics.test.ts` asserts both events get the door and status props. Run `cd mobile && npm test -- --testPathPattern=photoPermissionAnalytics`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Open Guess Where create on undetermined. Save `quiz-soft-ask.png`. Pass when the permission sheet is visible.
- [ ] Lane 2. Tap Allow Photo Access and grant Full Access in the OS sheet. Save `quiz-granted.png`. Pass when intro or build UI appears.
- [ ] Lane 3. Reset Photos to undetermined, open Guess Where, deny. Save `quiz-denied.png`. Pass when Settings CTA shows.
- [ ] Lane 4. From passport PhotoSyncCard with no prior scan, open import. Save `trips-autostart.png`. Pass when the OS sheet or scanning UI appears without a new soft-ask UI yet.
- [ ] Lane 5. Deny on that trip path. Save `trips-deny.png`. Pass when a failure state is visible.
- [ ] Lane 6. Profile Photo Library Enable while undetermined, then grant. Save `profile-grant.png`. Pass when status shows granted.
- [ ] Lane 7. Confirm soft-ask and os-result appear in debug analytics for quiz. Save `analytics-quiz.png`. Pass when both event names are present in the log dump.
- [ ] Lane 8. Confirm os-result for trips in the same dump. Save `analytics-trips.png`. Pass when `door=trips` is present.
- [ ] Lane 9. Cold launch, skip quiz offer, reach passport. Save `no-onboarding-prompt.png`. Pass when no Photos OS sheet appears during onboarding alone.
- [ ] Lane 10. Limited grant on quiz. Save `quiz-limited.png`. Pass when intro still appears and os-result status is limited.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from quiz permission CTA tap to OS sheet visible.
- [ ] Probe. Stopwatch on simulator from tap to sheet, trunk then head, three runs each interleaved.
- [ ] Baseline. Record the trunk median ms first.
- [ ] Rule. Head median must stay within 100ms of trunk or the PR fails.

**Review gate.** None. photo-perm-01 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Root appends to the stack. Operator lands.

## Add permission phases and recovery sheet (photo-perm-02)

**Depends on.** photo-perm-01.

**Files.**

- [ ] Create `mobile/src/permissions/photoLibraryPermission.ts` with the phase union and request helper.
- [ ] Create `mobile/src/components/photos/PhotoPermissionRecoverySheet.tsx`.
- [ ] Edit `mobile/src/constants/scanCopy.ts` for recovery strings only. Keep the three privacy bullets truthful.
- [ ] Edit `mobile/src/screens/quiz/QuizCreationScreen.tsx` and `useQuizCreationFlow.ts` to use the shared phases.
- [ ] Edit trip scan fail path so deny shows recovery, not generic Scan Failed.
- [ ] Edit `PhotoLibraryEnableModal.tsx` to reuse recovery content where it fits.
- [ ] Create tests under `mobile/src/__tests__/permissions/` and component tests for the recovery sheet.

**Build.**

- [ ] Encode `PhotoPermissionPhase` as `checking | soft-ask | recovery | ready | blocked-settings`. Screens own UI. Services never prompt. Recovery explains Full Access with SCAN_COPY honesty plus a light App Privacy Report inspect tip. Limited may continue after one recovery view.

**You see.**

- [ ] Quiz deny opens recovery. Trip deny opens the same recovery. Copy never says photos are never uploaded.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Phase helper tests cover mapping from Expo status. Recovery copy tests ban the substring `never upload`. Run `cd mobile && npm test -- --testPathPattern='permissions|PhotoPermissionRecovery|scanCopy'`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Quiz undetermined soft-ask still works. Save `soft-ask-still.png`. Pass when Allow CTA is visible.
- [ ] Lane 2. Deny on quiz shows recovery. Save `quiz-recovery.png`. Pass when Full Access why-copy is visible.
- [ ] Lane 3. From recovery, Open Settings works. Save `recovery-settings.png`. Pass when iOS Settings opens or the deep link fires.
- [ ] Lane 4. Limited path shows recovery once then can continue. Save `limited-continue.png`. Pass when intro or scan proceeds after dismiss.
- [ ] Lane 5. Trip autoStart deny shows recovery not Scan Failed. Save `trips-recovery.png`. Pass when recovery title is visible.
- [ ] Lane 6. App Privacy Report tip is present and secondary. Save `privacy-report-tip.png`. Pass when the tip text is on screen and not the headline.
- [ ] Lane 7. Recovery uses Atlasi brand colors, not Sundrop purple. Save `brand-check.png`. Pass when adobeBrick or sunsetGold appears on primary CTA.
- [ ] Lane 8. VoiceOver reads recovery title. Save `a11y-recovery.png`. Pass when mapper shows an accessibility label for the title.
- [ ] Lane 9. Rotate or large text does not clip primary CTA. Save `dynamic-type.png`. Pass when CTA remains tappable in the mapper.
- [ ] Lane 10. Analytics soft-ask still fires for quiz. Save `analytics-soft-ask.png`. Pass when the event is in the dump.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. JS thread stall on opening recovery (ms of longest frame).
- [ ] Probe. React Native perf monitor or `systrace` style frame dump on open, trunk recovery-equivalent deny screen vs head.
- [ ] Baseline. Record trunk deny-screen open stall first.
- [ ] Rule. Head stall must not exceed trunk by more than 50ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 and lane 5 screenshots into `docs/plans/media/photo-perm-02-review-quiz-recovery.png` and `docs/plans/media/photo-perm-02-review-trips-recovery.png`.
- [ ] Record a 30 to 60 second video of deny to recovery on quiz. Save it as `docs/plans/media/photo-perm-02-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Root appends to the stack. Operator lands after review click.

## Ship the OS-aligned preheat and autoStart gate (photo-perm-03)

**Depends on.** photo-perm-02.

**Files.**

- [ ] Create `mobile/src/components/photos/PhotoPermissionPreheat.tsx`.
- [ ] Edit quiz and trip entry points so undetermined always shows preheat before `requestPermissionsAsync`.
- [ ] Edit `useAutoStartWorkflow.ts` so autoStart waits for ready phase when permission is undetermined.
- [ ] Remove dead single-CTA soft-ask once preheat owns the ask.
- [ ] Add layout tests and screenshot fixtures from the prototype branch listed in Appendix A.

**Build.**

- [ ] Render a fake Select Photos / Allow Full Access / Don't Allow stack under the real OS sheet. Full Access uses system-blue so it bleeds. Select Photos and Don't Allow open recovery before or instead of an immediate OS call, matching the Sundrop pattern. Only Full Access (and recovery retry) calls `requestPermissionsAsync` while the fake stack stays mounted.

**You see.**

- [ ] Passport PhotoSyncCard no longer pops the OS sheet before the user sees Atlasi chrome. Finger on Full Access lands on the OS Full Access control on current iPhone sizes used in Appendix A.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Preheat action tests cover Full Access vs recovery branches. AutoStart gate test proves undetermined does not call extract until ready. Run `cd mobile && npm test -- --testPathPattern='PhotoPermissionPreheat|useAutoStart'`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Quiz undetermined shows preheat three buttons. Save `preheat-quiz.png`. Pass when all three labels exist.
- [ ] Lane 2. Tap Full Access, confirm OS sheet overlays. Save `os-over-preheat.png`. Pass when OS Allow Full Access and fake stack both appear.
- [ ] Lane 3. Tap Select Photos on preheat, see recovery, not OS first. Save `preheat-select.png`. Pass when recovery is visible and OS sheet is absent.
- [ ] Lane 4. Tap Don't Allow on preheat, see recovery. Save `preheat-dont.png`. Pass when recovery is visible.
- [ ] Lane 5. From recovery retry Full Access, OS sheet appears. Save `recovery-retry.png`. Pass when OS sheet is visible.
- [ ] Lane 6. Passport autoStart undetermined shows preheat before OS. Save `autostart-gated.png`. Pass when preheat is visible and scanning has not started.
- [ ] Lane 7. After grant, autoStart continues into scan. Save `autostart-continues.png`. Pass when scanning progress is visible.
- [ ] Lane 8. iPhone SE size alignment check. Save `align-se.png`. Pass when Full Access fake button center is within 24pt of OS Full Access center.
- [ ] Lane 9. iPhone 16 Pro Max alignment check. Save `align-pro-max.png`. Pass when the same 24pt rule holds.
- [ ] Lane 10. Blue bleed visible on Full Access under the translucent sheet. Save `blue-bleed.png`. Pass when the reviewer marks bleed present on the video frame.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from Full Access tap to OS sheet visible.
- [ ] Probe. Stopwatch three interleaved runs on trunk soft-ask CTA vs head preheat Full Access.
- [ ] Baseline. Record trunk median ms first.
- [ ] Rule. Head median must stay within 150ms of trunk.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, lane 6, and lane 10 screenshots into `docs/plans/media/photo-perm-03-review-*.png`.
- [ ] Record a 30 to 60 second video of preheat to OS grant on quiz. Save it as `docs/plans/media/photo-perm-03-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Root appends to the stack. Operator lands after review click.

## Wire limited photo picker upgrades (photo-perm-04)

**Depends on.** photo-perm-03.

**Files.**

- [ ] Edit `mobile/src/services/photoImport/photoImportService.ts` callers of `presentLimitedPhotoPicker`.
- [ ] Edit quiz thin-library limited branch and recovery limited CTA.
- [ ] Edit Settings limited manage path to prefer the picker when available.
- [ ] Add tests that the picker is invoked for limited upgrade.

**Build.**

- [ ] Call the existing `presentLimitedPhotoPicker` from limited recovery and quiz thin-library Allow More Photos. Keep Settings as fallback when the picker API throws.

**You see.**

- [ ] A limited user can expand the set in-app without hunting Atlasi in Settings first.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Tests assert `presentPermissionsPickerAsync` is called from the limited upgrade CTA. Run `cd mobile && npm test -- --testPathPattern='presentLimited|thin-limited|PhotoPermission'`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Force limited, open quiz thin-library. Save `thin-limited.png`. Pass when Allow More Photos is visible.
- [ ] Lane 2. Tap Allow More Photos, system limited picker appears. Save `limited-picker.png`. Pass when the picker UI is visible.
- [ ] Lane 3. Add photos in the picker, return, retry build. Save `limited-retry.png`. Pass when build progresses or thin copy updates.
- [ ] Lane 4. Recovery limited CTA opens the picker. Save `recovery-picker.png`. Pass when picker is visible.
- [ ] Lane 5. Settings limited manage still reaches Settings if picker fails. Save `settings-fallback.png`. Pass when Settings opens on forced throw.
- [ ] Lane 6. Full access users never see limited picker CTA. Save `full-no-picker.png`. Pass when that CTA is absent.
- [ ] Lane 7. Analytics os-result still records limited. Save `analytics-limited.png`. Pass when status limited is logged.
- [ ] Lane 8. Freshness permission-changed after expanding selection triggers rescan eligibility. Save `freshness-changed.png`. Pass when a check-for-new path is offered or runs.
- [ ] Lane 9. A11y label on Allow More Photos. Save `a11y-more.png`. Pass when mapper exposes the button.
- [ ] Lane 10. Deny path still uses recovery, not the picker. Save `deny-no-picker.png`. Pass when recovery shows without picker.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from Allow More Photos tap to picker visible.
- [ ] Probe. Stopwatch three runs at head. Trunk baseline is Settings open time for the same CTA.
- [ ] Baseline. Record trunk Settings-open median ms first.
- [ ] Rule. Head picker median must be less than or equal to trunk Settings median plus 500ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 screenshots into `docs/plans/media/photo-perm-04-review-picker.png`.
- [ ] Record a 30 to 60 second video of limited upgrade. Save it as `docs/plans/media/photo-perm-04-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Root appends to the stack. Operator lands after review click.

## Align usage strings and secondary callers (photo-perm-05)

**Depends on.** photo-perm-04.

**Files.**

- [ ] Edit `mobile/app.config.js` so Info.plist and expo-media-library plugin photo read strings match.
- [ ] Edit `FirstQuizOfferScreen` if it overclaims stay-on-phone without the upload caveat.
- [ ] Decide entry and cover ImagePicker asks stay thin. Document the decision in the PR body.
- [ ] Add a small test or lint comment guard only if a shared helper now owns full-library asks.

**Build.**

- [ ] One usage description naming travel photo trips and Guess Where. Secondary attach and save-to-library paths stay out of the full-library preheat unless product expands scope later.

**You see.**

- [ ] The OS sheet purpose string matches in-app privacy intent. Onboarding teaser does not contradict SCAN_COPY.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] A unit test or config assertion proves plugin and infoPlist photo strings are identical. Run `cd mobile && npm test -- --testPathPattern='app.config|photoUsage'`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.6-fast-xhigh` at the PR head, per the boot recipe.

- [ ] Lane 1. Reset Photos, open quiz preheat to Full Access, read OS purpose string. Save `os-purpose.png`. Pass when the string mentions trips or challenges.
- [ ] Lane 2. FirstQuizOffer copy still honest. Save `offer-copy.png`. Pass when upload caveat or SCAN_COPY-aligned phrasing is present.
- [ ] Lane 3. Entry attach still works without preheat. Save `entry-attach.png`. Pass when picker opens from entry form.
- [ ] Lane 4. Cover picker still works. Save `cover-picker.png`. Pass when cover flow opens.
- [ ] Lane 5. Share card save still works. Save `share-save.png`. Pass when save succeeds or Settings prompt is clear.
- [ ] Lane 6. Full library preheat still on quiz. Save `quiz-preheat-still.png`. Pass when three buttons show.
- [ ] Lane 7. Full library preheat still on trips undetermined. Save `trips-preheat-still.png`. Pass when preheat shows.
- [ ] Lane 8. No never-upload claim on FirstQuizOffer. Save `no-false-claim.png`. Pass when that phrase is absent.
- [ ] Lane 9. Analytics door values unchanged for quiz and trips. Save `analytics-doors.png`. Pass when both doors still log.
- [ ] Lane 10. Profile info modal still opens. Save `profile-info.png`. Pass when info content is visible.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Cold start to passport interactive.
- [ ] Probe. Three cold launches trunk then head interleaved.
- [ ] Baseline. Record trunk median ms first.
- [ ] Rule. Head median must stay within 5% of trunk.

**Review gate.** None. photo-perm-05 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Root appends to the stack. Operator lands.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

Settled without a device run. Limited may continue after one recovery. App Privacy Report is a secondary inspect tip, not a zero-network claim. Profile reuses recovery content in photo-perm-02.

Unproven until photo-perm-03. Finger alignment and blue bleed on SE and Pro Max. That PR starts with a throwaway prototype branch and must attach branch name, SHA, and screenshots here before production UI lands.

## Appendix B. Alternatives rejected

Copy Sundrop never-upload claims. Rejected as false for Atlasi.

Stronger soft ask only, no preheat. Rejected as the main conversion mechanic.

Move the ask into core onboarding before account. Rejected. Worse context and more denials.

Autopilot-full auto-merge. Rejected. UI is review-gated and the operator lands the stack.

## Appendix C. Risks

Preheat misalignment on new iOS sheet chrome. Lands in photo-perm-03. Owner watches the 24pt rule.

False privacy copy regressions. Lands in photo-perm-02 and photo-perm-05. Owner watches the `never upload` ban test.

autoStart deadlocks if preheat never reaches ready. Lands in photo-perm-03. Owner watches the gate test and lane 7.

ImagePicker first-ask still uneducated. Lands in photo-perm-05 as accepted scope limit. Owner watches entry and cover lanes.

`gt` missing on some machines. Program checklist allows stacked `gh` PRs with explicit bases.

## Appendix D. Links and reading list

Read `mobile/src/constants/scanCopy.ts`, `mobile/src/hooks/usePhotoPermissions.ts`, `mobile/src/screens/quiz/creation/useQuizCreationFlow.ts`, `mobile/src/screens/photos/useAutoStartWorkflow.ts`, `mobile/src/services/photoImport/photoImportService.ts`, and `docs/photo-import.md` before editing.

photo-perm-02 and photo-perm-03 get `how` before build and `interrogate` if design forks reopen.

Trail per `show-me-your-work` stays local in each owner's `decisions.tsv`.
