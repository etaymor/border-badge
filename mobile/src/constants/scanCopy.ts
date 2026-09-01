/**
 * scanCopy - Every user-facing sentence about the photo library scan.
 *
 * ONE SCAN, ONE STORY. The same pass over the library serves two features, and
 * for a long time each feature wrote its own words for it: trips said "scan",
 * quiz said "check"; trips said "GPS", quiz said "location data"; trips
 * promised the scan keeps going, quiz could not. The words drifted because
 * they lived at their call sites, so this module is deliberately in
 * `src/constants/` rather than under either screen's folder - putting it in
 * `screens/photos/` or `screens/quiz/` would just recreate the ownership
 * asymmetry that caused the drift. (Precedent: `constants/trackingPreferences`,
 * `utils/authErrors`. There is no i18n library.)
 *
 * ANYTHING PARAMETERIZED IS A FUNCTION HERE, never a template assembled by the
 * caller. Call-site assembly is exactly how two screens ended up with
 * different sentences from the same idea.
 *
 * LOCKED VOCABULARY. Most of the drift was synonym drift, so the words are
 * fixed:
 *
 *   corpus       "your library"            never camera roll, photos app
 *   operation    "scan" (first)            never import, sync, index
 *                "check" (incremental)
 *   looked at    "checked"                 never examined, processed
 *   selected     "found"                   never picked, matched
 *   location     "location data"           never GPS, EXIF, geotag*
 *   locality     "on your device"          never locally, offline
 *   persistence  "keeps going while you use the app"
 *                "picks up where it left off next time you open it"
 *                                          NEVER "in the background",
 *                                          NEVER "while the app is closed"
 *
 * (*`geotagged` survives only in the thin-library rule explanation, where it
 * names a real requirement rather than describing the scan.)
 *
 * THE "BACKGROUND" BAN IS LOAD-BEARING, AND IT SURVIVED THE FEATURE THAT
 * WOULD SEEM TO LIFT IT. The app does now register an iOS BGProcessingTask
 * (`services/jobs/backgroundJobTask`), so a scan sometimes DOES advance while
 * closed. The ban stands: iOS schedules that task opportunistically — often
 * overnight, on charge — it cannot be requested, and it may never run. What
 * these strings promise is what a user can RELY on, and nobody can rely on
 * that. So "survives" here still means: survives navigation, survives suspend,
 * resumes on next foreground. `__tests__/constants/scanCopy.test.ts` enforces
 * it as a test rather than a convention, because a convention is exactly what
 * a future contributor would not know about.
 *
 * THE ONE TIER-GATED EXCEPTION: `leaveHintWhileLeased`. iOS 26's
 * continued-processing lease (`services/jobs/continuationLease`) IS something
 * a user can rely on — while it is actually held. That string renders only
 * while `continuationLeaseStore` reads `running` on the `continued` tier, and
 * it still never uses the banned words.
 */

export type ScanJobKind = 'trip-scan' | 'quiz-build';

/** Sub-step of a quiz build, mirroring `QuizCreationProgress['step']`. */
export type QuizWorkingStep = 'scanning' | 'checking' | 'building';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const privacyTitle = 'Your photos stay private';

/**
 * Device-first, deliberately. The strongest claim leads, so the home-country
 * qualifier reads as detail rather than as a limitation to parse.
 */
function privacyBullets(homeCountryName?: string | null): string[] {
  return [
    'The scan runs entirely on your device',
    `Only location data from photos taken outside ${homeCountryName ?? 'your home country'} is read`,
    'Nothing is uploaded until you save a place or share a challenge',
  ];
}

/**
 * The two purpose lines. Both name both payoffs — that symmetry is what makes
 * the promise the same promise whichever door you came through — but each
 * LEADS with the feature the user actually asked for.
 */
const purposeTrips =
  'One scan of your library builds trips from where your photos were taken, and unlocks Guess Where challenges.';
const purposeQuiz =
  'One scan of your library picks the photos for this challenge. The same scan builds your trips, too — you never have to run it twice.';

const leaveHint =
  'You can keep using the app while this runs. A thin progress line stays at the top of the screen.';
const resumeHint =
  'If you close the app, the scan pauses and picks up where it left off next time you open it.';

/** The two hints as the one paragraph both scanning surfaces render. */
const persistenceParagraph = `${leaveHint} ${resumeHint}`;

/**
 * THE ONE TIER-GATED EXCEPTION to the persistence story. Rendered ONLY while
 * a continued-processing lease is actually running (`continuationLeaseStore`
 * phase `running`, tier `continued`) — not merely because the capability
 * exists, and never for the grace window, which cannot honor it. It keeps the
 * "leave" vocabulary and still never says "background" or "while the app is
 * closed": what it promises is what iOS 26's continued-processing task
 * actually does — keeps going for a while after the user leaves, with progress
 * in the system's own UI.
 */
function leaveHintWhileLeased(kind: ScanJobKind): string {
  const noun = kind === 'quiz-build' ? 'build' : 'scan';
  return `If you leave the app, the ${noun} keeps going for a while and shows its progress at the top of your screen.`;
}

/** The paragraph the scanning surfaces render while a lease is running. */
function persistenceParagraphWhileLeased(kind: ScanJobKind): string {
  return `${leaveHint} ${leaveHintWhileLeased(kind)}`;
}

/**
 * Magnitude, stated ONCE and up front — where it is context rather than a
 * wait. Returns '' for an unknown total: rendering nothing beats guessing.
 */
function scaleLine(total: number | null | undefined, isFirstScan: boolean): string {
  if (!total || total <= 0) return '';
  const count = total.toLocaleString();
  return isFirstScan
    ? `About ${count} photos to look through. The first pass is the long one — after this we only look at what's new.`
    : `Only the ${count} photos added since your last check.`;
}

/**
 * Duration in buckets, never a countdown. The classification step's per-batch
 * latency makes a smooth ETA impossible, and an ETA that slips is worse than
 * none at all.
 */
function durationLine(total: number | null | undefined): string {
  if (!total || total <= 0) return '';
  if (total < 5_000) return 'Usually under a minute.';
  if (total < 20_000) return 'Usually a few minutes.';
  return 'A library this size takes several minutes.';
}

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

const trips = {
  idleTitleFirst: 'Ready to scan',
  /**
   * Was "Import Travel Photos" — the last survivor of the "import" vocabulary,
   * and it disagreed with the button directly beneath it about the verb.
   */
  idleTitleReturning: 'Check for New Photos',
  idleBodyFirst: purposeTrips,
  idleBodyReturning:
    'Check for new photos since your last scan, or refresh to re-scan your entire library.',
  idleCtaFirst: 'Start Scan',
  idleCtaReturning: 'Check for New Photos',

  scanningTitle(phase: string | undefined, isIncremental: boolean): string {
    if (phase === 'geocoding') return 'Working Out Where They Were Taken';
    return isIncremental ? 'Checking for New Photos' : 'Reading Your Library';
  },

  /** "{current} of {total} photos checked · {n} with location data" */
  scanningProgress(current: number, total: number, withLocation?: number): string {
    const base = `${current.toLocaleString()} of ${total.toLocaleString()} photos checked`;
    return withLocation === undefined
      ? base
      : `${base} · ${withLocation.toLocaleString()} with location data`;
  },

  /**
   * The name, not the flag. `DiscoveredCountry.name` already exists and was
   * being discarded: VoiceOver announces regional-indicator pairs
   * inconsistently, so a bare flag reads as a truncated sentence.
   */
  discovery(countryName: string): string {
    return `Found photos from ${countryName}`;
  },
} as const;

// ---------------------------------------------------------------------------
// Quiz
// ---------------------------------------------------------------------------

const quiz = {
  permissionTitle: 'Your Photos, Their Guesses',
  permissionBody:
    'A challenge is built from your own travel photos. One scan of your library picks them — and the same scan builds your trips, too.',
  permissionCta: 'Allow Photo Access',

  introTitle: 'New Challenge',
  introBody: '5-10 photos from your trips. Play once to set the score, then share.',

  workingTitle: 'Building Your Challenge',

  /**
   * `scanning` used to read "Checking for new photos" unconditionally, which
   * LIES on a first run — precisely the moment the user is most confused about
   * why the wait is long.
   */
  workingStatus(step: QuizWorkingStep, options: { isFirstScan: boolean }): string {
    switch (step) {
      case 'scanning':
        return options.isFirstScan
          ? 'Reading your library. This is the one full pass.'
          : 'Checking for photos added since last time';
      case 'checking':
        return 'Finding photos that make good questions';
      case 'building':
        return 'Uploading the photos your challenge uses';
    }
  },

  /**
   * Two lines, not the full bullets: the working phase is not a consent
   * moment, and the bullets would crowd the slot grid.
   */
  workingPrivacy: [
    'Everything so far has happened on your device. Only the photos your challenge uses get uploaded, and only when you share it.',
    'This same scan is building your trips as it goes.',
  ] as const,

  /** Leave-it-running is only honest once the build outlives the screen. */
  leaveCta: 'Leave It Running',
  stopCta: 'Stop',

  freshnessNeverSynced:
    'First we scan your library. It runs on your device, and the same scan builds your trips, too.',
  freshnessStale: 'First we check your library for new photos. Usually quick.',
  freshnessSyncing: 'Your library is syncing right now — we will use the freshest photos.',
  freshnessReady(syncedAgo: string | null, cachedPhotoCount: number): string {
    const when = syncedAgo ? ` — ${syncedAgo}` : '';
    const count = cachedPhotoCount > 0 ? ` — ${cachedPhotoCount.toLocaleString()} photos` : '';
    return `Your photo library is ready${when}${count}. No scan needed.`;
  },
} as const;

// ---------------------------------------------------------------------------
// Permission recovery (denied / limited)
// ---------------------------------------------------------------------------

const permission = {
  recoveryTitleDenied: 'Photo Access Needed',
  recoveryTitleLimited: 'Full Access Works Best',
  recoveryBodyDenied:
    'Full Access is needed to find trips across your library. The scan runs on your device. Nothing is uploaded until you save a place or share a challenge.',
  recoveryBodyLimited:
    'Limited selection may miss trips in the rest of your library. Full Access lets the scan find them. The scan runs on your device. Nothing is uploaded until you save a place or share a challenge.',
  recoveryPrivacyReportTip:
    "You can inspect network activity in Apple's App Privacy Report (Settings → Privacy & Security → App Privacy Report).",
  recoveryOpenSettingsCta: 'Open Settings',
  recoveryContinueLimitedCta: 'Continue With Selected Photos',
  recoveryRetryCta: 'Try Again',
  preheatTitle: 'Connect Photos',
  preheatBody:
    'One scan of your library builds trips and Guess Where challenges. The scan runs on your device. Nothing is uploaded until you save a place or share a challenge.',
  preheatSelectPhotos: 'Select Photos',
  preheatAllowFullAccess: 'Allow Full Access',
  preheatDontAllow: "Don't Allow",
  preheatFooter: 'On your device until you choose to upload · Full Access finds more trips',
} as const;

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

/**
 * Label = state, hint = action. The label used to carry "tap for details",
 * which VoiceOver already announces for a `button` role, so it double-spoke.
 *
 * The trip-scan strings are preserved EXACTLY — existing tests assert them.
 */
const banner = {
  label(
    kind: ScanJobKind,
    state: 'running' | 'waiting' | 'completed' | 'failed',
    percentage: number,
    failureReason?: string | null
  ): string {
    if (kind === 'quiz-build') {
      if (state === 'waiting') return 'Guess Where challenge queued behind your photo scan';
      if (state === 'completed') return 'Your challenge is ready';
      if (state === 'failed') return 'Challenge build stopped';
      // Rounded to 10% steps: the live region re-announces on every change,
      // and per-percent updates spam VoiceOver. The visual fill keeps the
      // raw value.
      return percentage === 0
        ? 'Building your Guess Where challenge, starting'
        : `Building your Guess Where challenge, ${Math.round(percentage / 10) * 10} percent`;
    }
    if (state === 'completed') return 'Photo scan complete';
    if (state === 'failed') {
      return failureReason === 'no-trips' ? 'No travel photos found' : 'Photo scan stopped';
    }
    return percentage === 0 ? 'Photo scan starting' : `Photo scan in progress, ${percentage}%`;
  },

  hint(kind: ScanJobKind, state: 'running' | 'waiting' | 'completed' | 'failed'): string {
    if (kind === 'quiz-build') {
      if (state === 'completed') return 'Opens your challenge to play';
      if (state === 'failed') return 'Opens your challenge to retry';
      return 'Opens your challenge in progress';
    }
    if (state === 'completed') return 'Opens the trips we found';
    if (state === 'failed') return 'Opens scan details to retry';
    return 'Opens scan details';
  },
} as const;

export const SCAN_COPY = {
  shared: {
    privacyTitle,
    privacyBullets,
    purposeTrips,
    purposeQuiz,
    leaveHint,
    resumeHint,
    persistenceParagraph,
    leaveHintWhileLeased,
    persistenceParagraphWhileLeased,
    scaleLine,
    durationLine,
  },
  trips,
  quiz,
  banner,
  permission,
} as const;
