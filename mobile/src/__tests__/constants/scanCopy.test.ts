/**
 * The scan narrative, enforced.
 *
 * Two features share one library scan, and for a long time each wrote its own
 * words for it. The words drifted because they lived at their call sites. This
 * file is the mechanism that keeps them from drifting again — and, more
 * importantly, the mechanism that stops anyone promising something the app
 * cannot do.
 *
 * THE BAN THAT MATTERS. The app now registers an iOS BGProcessingTask, so a
 * scan CAN make progress while closed — and the ban stands anyway, because
 * iOS schedules that task opportunistically (typically overnight, on charge)
 * and it may never run at all. Copy describes what a user can RELY on, and
 * nobody can rely on that. A sentence promising it is not a wording problem;
 * it is a lie the user finds out about by leaving the app and coming back to
 * no progress. So it is a failing test, not a style note.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { SCAN_COPY } from '@constants/scanCopy';

const SRC = join(__dirname, '../..');

/** Every string the module can produce, with a label for the failure message. */
function allStrings(): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const push = (label: string, value: string | readonly string[]) => {
    if (typeof value === 'string') entries.push([label, value]);
    else value.forEach((item, index) => entries.push([`${label}[${index}]`, item]));
  };

  const { shared, trips, quiz, banner, permission } = SCAN_COPY;

  push('shared.purposeTrips', shared.purposeTrips);
  push('shared.purposeQuiz', shared.purposeQuiz);
  push('shared.leaveHint', shared.leaveHint);
  push('shared.resumeHint', shared.resumeHint);
  push('shared.persistenceParagraph', shared.persistenceParagraph);
  for (const kind of ['trip-scan', 'quiz-build'] as const) {
    push(`shared.leaveHintWhileLeased(${kind})`, shared.leaveHintWhileLeased(kind));
    push(
      `shared.persistenceParagraphWhileLeased(${kind})`,
      shared.persistenceParagraphWhileLeased(kind)
    );
  }
  for (const total of [0, 900, 4_999, 12_000, 53_282]) {
    for (const first of [true, false]) {
      push(`shared.scaleLine(${total}, ${first})`, shared.scaleLine(total, first));
    }
    push(`shared.durationLine(${total})`, shared.durationLine(total));
    push(`shared.scaleAndDurationLine(${total})`, shared.scaleAndDurationLine(total));
  }
  for (const kind of ['trip-scan', 'quiz-build'] as const) {
    for (const leased of [false, true]) {
      push(`shared.stageLines(${kind}, leased=${leased})`, shared.stageLines(kind, { leased }));
    }
  }

  push('trips.stageTitle', trips.stageTitle);
  push('trips.idleTitleFirst', trips.idleTitleFirst);
  push('trips.idleTitleReturning', trips.idleTitleReturning);
  push('trips.idleBodyFirst', trips.idleBodyFirst);
  push('trips.idleBodyReturning', trips.idleBodyReturning);
  push('trips.idleCtaFirst', trips.idleCtaFirst);
  push('trips.idleCtaReturning', trips.idleCtaReturning);
  push('trips.lastScannedLine', trips.lastScannedLine('3 days ago'));
  for (const phase of ['scanning', 'geocoding', undefined] as const) {
    for (const incremental of [true, false]) {
      push(
        `trips.scanningTitle(${phase}, ${incremental})`,
        trips.scanningTitle(phase, incremental)
      );
    }
  }
  push('trips.scanningProgress', trips.scanningProgress(4_500, 53_282, 900));
  push('trips.scanningProgress(no gps)', trips.scanningProgress(4_500, 53_282));
  push('trips.discovery', trips.discovery('Iceland'));

  push('quiz.permissionTitle', quiz.permissionTitle);
  push('quiz.permissionBody', quiz.permissionBody);
  push('quiz.permissionCta', quiz.permissionCta);
  push('quiz.introTitle', quiz.introTitle);
  push('quiz.introBody', quiz.introBody);
  push('quiz.workingTitle', quiz.workingTitle);
  for (const step of ['scanning', 'checking', 'building'] as const) {
    for (const isFirstScan of [true, false]) {
      push(
        `quiz.workingStatus(${step}, ${isFirstScan})`,
        quiz.workingStatus(step, { isFirstScan })
      );
    }
  }
  push('quiz.workingPrivacy', quiz.workingPrivacy);
  push('quiz.leaveCta', quiz.leaveCta);
  push('quiz.stopCta', quiz.stopCta);
  push('quiz.freshnessNeverSynced', quiz.freshnessNeverSynced);
  push('quiz.freshnessStale', quiz.freshnessStale);
  push('quiz.freshnessSyncing', quiz.freshnessSyncing);
  push('quiz.freshnessReady', quiz.freshnessReady('2 hours ago', 53_282));
  push('quiz.freshnessReady(bare)', quiz.freshnessReady(null, 0));

  for (const kind of ['trip-scan', 'quiz-build'] as const) {
    for (const state of ['running', 'waiting', 'completed', 'failed'] as const) {
      push(`banner.label(${kind}, ${state})`, banner.label(kind, state, 42));
      push(`banner.label(${kind}, ${state}, 0)`, banner.label(kind, state, 0));
      push(`banner.hint(${kind}, ${state})`, banner.hint(kind, state));
    }
  }
  push(
    'banner.label(trip-scan, failed, no-trips)',
    banner.label('trip-scan', 'failed', 100, 'no-trips')
  );

  push('permission.recoveryTitleDenied', permission.recoveryTitleDenied);
  push('permission.recoveryTitleLimited', permission.recoveryTitleLimited);
  push('permission.recoveryBodyDenied', permission.recoveryBodyDenied);
  push('permission.recoveryBodyLimited', permission.recoveryBodyLimited);
  push('permission.recoveryPrivacyReportTip', permission.recoveryPrivacyReportTip);
  push('permission.recoveryOpenSettingsCta', permission.recoveryOpenSettingsCta);
  push('permission.recoveryAllowMorePhotosCta', permission.recoveryAllowMorePhotosCta);
  push('permission.recoveryContinueLimitedCta', permission.recoveryContinueLimitedCta);
  push('permission.recoveryRetryCta', permission.recoveryRetryCta);
  push('permission.preheatSelectPhotos', permission.preheatSelectPhotos);
  push('permission.preheatAllowFullAccess', permission.preheatAllowFullAccess);
  push('permission.preheatDontAllow', permission.preheatDontAllow);
  push('permission.carousel.beat1Title', permission.carousel.beat1Title);
  push('permission.carousel.beat1Subtitle', permission.carousel.beat1Subtitle);
  push('permission.carousel.beat2Title', permission.carousel.beat2Title);
  push('permission.carousel.beat2Subtitle', permission.carousel.beat2Subtitle);
  push('permission.carousel.beat2Pills', permission.carousel.beat2Pills);
  push('permission.carousel.continueCta', permission.carousel.continueCta);
  push('permission.carousel.footerNotice', permission.carousel.footerNotice);
  push('permission.carousel.tripsHeaderTitle', permission.carousel.tripsHeaderTitle);
  push(
    'permission.carousel.stepAnnouncement',
    permission.carousel.stepAnnouncement(2, 3, permission.carousel.beat2Title)
  );
  for (const door of ['trips', 'quiz'] as const) {
    push(`permission.carousel.beat3Title(${door})`, permission.carousel.beat3Title(door));
    push(`permission.carousel.beat3Subtitle(${door})`, permission.carousel.beat3Subtitle(door));
  }

  return entries;
}

describe('SCAN_COPY - banned phrases', () => {
  /**
   * The first two are the load-bearing ones: the app has no OS-level
   * background execution, so a string claiming it does is a promise the user
   * discovers is false. The rest are the vocabulary the two doors kept
   * drifting apart on.
   */
  const BANNED: Array<[RegExp, string]> = [
    [
      /\bbackground\b/i,
      'background execution is opportunistic and unpromisable — say "keeps going while you use the app"',
    ],
    [/app is closed/i, 'nothing the user can rely on runs while the app is closed'],
    [/minutes? (left|remaining)/i, 'no countdowns — per-batch latency makes an ETA slip'],
    [
      /bottom of the screen/i,
      'the progress line is at the TOP; describe the affordance, not chrome',
    ],
    [/camera roll/i, 'say "your library"'],
    [/\bGPS\b/, 'say "location data"'],
    [/\bimport(ed|ing|s)?\b/i, 'say "scan" (first) or "check" (incremental)'],
    [/\bexamin(e|ed|ing)\b/i, 'say "checked"'],
    [/\boffline\b/i, 'say "on your device"'],
    [/never upload/i, 'Atlasi uploads when the user saves a place or shares a challenge'],
  ];

  it.each(allStrings())('%s is clean', (label, value) => {
    for (const [pattern, why] of BANNED) {
      expect({ label, value, why, matched: pattern.test(value) }).toEqual({
        label,
        value,
        why,
        matched: false,
      });
    }
  });
});

describe('SCAN_COPY - the tier-gated leave hint', () => {
  it('keeps the resume story intact and separate from the leased hint', () => {
    expect(SCAN_COPY.shared.resumeHint).toMatch(/pauses/);
    expect(SCAN_COPY.shared.resumeHint).toMatch(/picks up where it left off/);
    expect(SCAN_COPY.shared.resumeHint).not.toMatch(/keeps going for a while/);
    // The leased paragraph REPLACES the resume sentence rather than stacking a
    // third one; the leave sentence (top-of-screen line) stays.
    for (const kind of ['trip-scan', 'quiz-build'] as const) {
      expect(SCAN_COPY.shared.persistenceParagraphWhileLeased(kind)).toContain(
        SCAN_COPY.shared.leaveHint
      );
      expect(SCAN_COPY.shared.persistenceParagraphWhileLeased(kind)).toContain(
        SCAN_COPY.shared.leaveHintWhileLeased(kind)
      );
    }
    expect(SCAN_COPY.shared.leaveHintWhileLeased('trip-scan')).toMatch(/the scan keeps going/);
    expect(SCAN_COPY.shared.leaveHintWhileLeased('quiz-build')).toMatch(/the build keeps going/);
  });
});

describe('SCAN_COPY - the one-scan promise', () => {
  it('names both payoffs from either door', () => {
    // Symmetry is the whole point: whichever door you came through, the scan
    // is described as doing both jobs.
    expect(SCAN_COPY.shared.purposeTrips).toMatch(/trips/i);
    expect(SCAN_COPY.shared.purposeTrips).toMatch(/guess where/i);
    expect(SCAN_COPY.shared.purposeQuiz).toMatch(/challenge/i);
    expect(SCAN_COPY.shared.purposeQuiz).toMatch(/trips/i);
  });

  it('leads with the feature the user asked for', () => {
    // Trips as a by-product of the challenge, never the reverse — a Guess
    // Where user must not read the scan as a favour done for another feature.
    const quizLine = SCAN_COPY.shared.purposeQuiz;
    expect(quizLine.indexOf('challenge')).toBeLessThan(quizLine.indexOf('trips'));
    const tripsLine = SCAN_COPY.shared.purposeTrips;
    expect(tripsLine.indexOf('trips')).toBeLessThan(tripsLine.toLowerCase().indexOf('guess where'));
  });
});

describe('SCAN_COPY - magnitude without a false denominator', () => {
  it('renders nothing rather than guessing at an unknown library size', () => {
    expect(SCAN_COPY.shared.scaleLine(null, true)).toBe('');
    expect(SCAN_COPY.shared.durationLine(undefined)).toBe('');
  });

  it('merges scale and duration into one short line', () => {
    expect(SCAN_COPY.shared.scaleAndDurationLine(null)).toBe('');
    expect(SCAN_COPY.shared.scaleAndDurationLine(0)).toBe('');
    expect(SCAN_COPY.shared.scaleAndDurationLine(53_000)).toBe(
      'About 53,000 photos · several minutes'
    );
    expect(wordCount(SCAN_COPY.shared.scaleAndDurationLine(53_282))).toBeLessThanOrEqual(8);
    expect(SCAN_COPY.trips.lastScannedLine('3 days ago')).toBe('Last scanned 3 days ago');
  });

  it('buckets duration instead of counting down', () => {
    expect(SCAN_COPY.shared.durationLine(900)).toBe('Usually under a minute.');
    expect(SCAN_COPY.shared.durationLine(12_000)).toBe('Usually a few minutes.');
    expect(SCAN_COPY.shared.durationLine(53_282)).toMatch(/several minutes/);
  });

  it('tells the truth about which pass this is', () => {
    // The old status said "Checking for new photos" on a FIRST run, which is
    // exactly when the user is most confused about the wait.
    expect(SCAN_COPY.quiz.workingStatus('scanning', { isFirstScan: true })).toMatch(/full pass/);
    expect(SCAN_COPY.quiz.workingStatus('scanning', { isFirstScan: false })).toMatch(
      /added since last time/
    );
  });
});

describe('SCAN_COPY - persistence claims are honest', () => {
  it('describes the affordance, not the chrome', () => {
    // A future reposition of the bar should cost one string, not a hunt.
    expect(SCAN_COPY.shared.leaveHint).toMatch(/top of the screen/);
  });

  it('says the scan pauses, never that it continues', () => {
    expect(SCAN_COPY.shared.resumeHint).toMatch(/pauses/);
    expect(SCAN_COPY.shared.resumeHint).toMatch(/picks up where it left off/);
  });
});

describe('SCAN_COPY - the banner splits state from action', () => {
  it('keeps the trip-scan strings byte-identical to what shipped', () => {
    expect(SCAN_COPY.banner.label('trip-scan', 'running', 0)).toBe('Photo scan starting');
    expect(SCAN_COPY.banner.label('trip-scan', 'running', 42)).toBe('Photo scan in progress, 42%');
    expect(SCAN_COPY.banner.label('trip-scan', 'completed', 100)).toBe('Photo scan complete');
    expect(SCAN_COPY.banner.label('trip-scan', 'failed', 100, 'no-trips')).toBe(
      'No travel photos found'
    );
    expect(SCAN_COPY.banner.label('trip-scan', 'failed', 100)).toBe('Photo scan stopped');
  });

  it('throttles the quiz label to 10% steps', () => {
    // `accessibilityLiveRegion="polite"` re-announces on every change; the
    // visual fill keeps the raw value.
    expect(SCAN_COPY.banner.label('quiz-build', 'running', 44)).toBe(
      'Building your Guess Where challenge, 40 percent'
    );
    expect(SCAN_COPY.banner.label('quiz-build', 'running', 46)).toBe(
      'Building your Guess Where challenge, 50 percent'
    );
  });

  it('never puts the action in the label', () => {
    for (const kind of ['trip-scan', 'quiz-build'] as const) {
      for (const state of ['running', 'waiting', 'completed', 'failed'] as const) {
        expect(SCAN_COPY.banner.label(kind, state, 50)).not.toMatch(/tap/i);
        expect(SCAN_COPY.banner.hint(kind, state)).toMatch(/^Opens /);
      }
    }
  });
});

describe('SCAN_COPY - permission recovery', () => {
  it('exports the recovery strings both doors render', () => {
    const { permission } = SCAN_COPY;
    expect(permission.recoveryTitleDenied).toBe('Photo Access Needed');
    expect(permission.recoveryTitleLimited).toBe('Full Access Works Best');
    expect(permission.recoveryBodyDenied.length).toBeGreaterThan(0);
    expect(permission.recoveryBodyLimited.length).toBeGreaterThan(0);
    expect(permission.recoveryPrivacyReportTip).toMatch(/App Privacy Report/);
    expect(permission.recoveryOpenSettingsCta).toBe('Open Settings');
    expect(permission.recoveryAllowMorePhotosCta).toBe('Allow More Photos');
    expect(permission.recoveryContinueLimitedCta).toBe('Continue With Selected Photos');
    expect(permission.recoveryRetryCta).toBe('Try Again');
  });

  it('never claims photos are never uploaded', () => {
    const recovery = allStrings()
      .filter(([label]) => label.startsWith('permission.'))
      .map(([, value]) => value)
      .join(' ');
    expect(recovery).not.toMatch(/never upload/i);
  });
});

function wordCount(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

describe('SCAN_COPY - permission carousel', () => {
  const carouselStrings = () =>
    allStrings()
      .filter(([label]) => label.startsWith('permission.carousel.'))
      .map(([, value]) => value)
      .join(' ');

  it('uses the short beat copy', () => {
    const { carousel } = SCAN_COPY.permission;
    expect(carousel.beat1Title).toBe('Find your trips in your photos');
    expect(carousel.beat1Subtitle).toBe('We read only where each photo was taken.');
    expect(carousel.beat2Title).toBe('Your phone does the reading');
    expect(carousel.beat2Subtitle).toBe('On your device. Location data only.');
    expect(carousel.beat3Title('trips')).toBe('Every trip lands in your passport');
    expect(carousel.beat3Subtitle('trips')).toBe('And unlocks Guess Where.');
    expect(carousel.beat3Title('quiz')).toBe('Your photos become challenges');
    expect(carousel.beat3Subtitle('quiz')).toBe('The same scan builds your trips.');
  });

  it('splits privacy across beat 1, beat 2, and the footer', () => {
    const { carousel } = SCAN_COPY.permission;
    expect(carousel.beat1Subtitle).toMatch(/only where each photo was taken/i);
    expect(carousel.beat2Subtitle).toMatch(/on your device/i);
    expect(carousel.beat2Subtitle).toMatch(/location data/i);
    expect(carousel.beat2Subtitle).not.toMatch(/\bGPS\b/);
    expect(carousel.footerNotice).toMatch(/scan/i);
    expect(carousel.footerNotice).toMatch(/on your device/i);
  });

  it('keeps carousel titles to six words and subtitles to twelve', () => {
    const { carousel } = SCAN_COPY.permission;
    const titles = [
      carousel.beat1Title,
      carousel.beat2Title,
      carousel.beat3Title('trips'),
      carousel.beat3Title('quiz'),
    ];
    const subtitles = [
      carousel.beat1Subtitle,
      carousel.beat2Subtitle,
      carousel.beat3Subtitle('trips'),
      carousel.beat3Subtitle('quiz'),
    ];
    for (const title of titles) {
      expect(wordCount(title)).toBeLessThanOrEqual(6);
    }
    for (const subtitle of subtitles) {
      expect(wordCount(subtitle)).toBeLessThanOrEqual(12);
    }
  });

  it('avoids broader photo-handling claims', () => {
    expect(carouselStrings()).not.toMatch(/\bnever\b|\bupload\b|the picture|the photo itself/i);
  });

  it('exports the accessibility announcement and trips header', () => {
    const { carousel } = SCAN_COPY.permission;
    expect(carousel.stepAnnouncement(2, 3, carousel.beat2Title)).toBe(
      `Step 2 of 3. ${carousel.beat2Title}`
    );
    expect(carousel.tripsHeaderTitle).not.toMatch(/import/i);
  });
});

describe('SCAN_COPY - scan stage lines', () => {
  const reading = 'Reading where each photo was taken';
  const onDevice = 'Everything stays on your device';
  const sameScan = 'The same scan builds your trips';
  const keepsGoing = 'Keeps going while you use the app';
  const picksUp = 'Picks up where it left off next time';
  const quizUpload = 'Only photos your challenge uses are ever uploaded';
  const whileLeased = 'It keeps going a while after you leave';

  it('orders the shared lines and keeps quiz-only claims on the quiz door', () => {
    expect(SCAN_COPY.shared.stageLines('trip-scan')).toEqual([
      reading,
      onDevice,
      keepsGoing,
      picksUp,
    ]);
    expect(SCAN_COPY.shared.stageLines('quiz-build')).toEqual([
      reading,
      onDevice,
      sameScan,
      keepsGoing,
      picksUp,
      quizUpload,
    ]);
  });

  it('replaces the leave line while a continued-processing lease is held', () => {
    expect(SCAN_COPY.shared.stageLines('trip-scan', { leased: true })).toEqual([
      reading,
      onDevice,
      whileLeased,
      picksUp,
    ]);
    expect(SCAN_COPY.shared.stageLines('quiz-build', { leased: true })[3]).toBe(whileLeased);
  });

  it('keeps every stage line to ten words', () => {
    for (const kind of ['trip-scan', 'quiz-build'] as const) {
      for (const leased of [false, true]) {
        for (const line of SCAN_COPY.shared.stageLines(kind, { leased })) {
          expect(wordCount(line)).toBeLessThanOrEqual(10);
        }
      }
    }
  });

  it('names the trips scanning stage', () => {
    expect(SCAN_COPY.trips.stageTitle).toBe('Finding Your Trips');
    expect(wordCount(SCAN_COPY.trips.stageTitle)).toBeLessThanOrEqual(6);
  });
});

describe('SCAN_COPY - provenance', () => {
  /**
   * Crude, and the only mechanism here that catches someone re-hardcoding a
   * string next to an import of the shared one. Each literal below is a
   * sentence that USED to live at a call site and drifted from its twin.
   */
  const RETIRED: Array<[string, string]> = [
    ['src/screens/quiz/QuizCreationScreen.tsx', 'Checking for new photos'],
    [
      'src/screens/quiz/QuizCreationScreen.tsx',
      'Your photos stay private until you share the challenge.',
    ],
    ['src/screens/photos/components/ScanningPhase.tsx', 'bar at the bottom'],
    ['src/screens/photos/components/ScanningPhase.tsx', 'with GPS'],
    ['src/screens/photos/components/IdlePhase.tsx', 'Only GPS data from photos outside'],
    ['src/screens/photos/components/IdlePhase.tsx', 'Import Travel Photos'],
    [
      'src/screens/quiz/QuizCreationScreen.tsx',
      'Turn on photo access in Settings, then come back.',
    ],
  ];

  it.each(RETIRED)('%s no longer hardcodes "%s"', (file, literal) => {
    const source = readFileSync(join(SRC, '..', file), 'utf8');
    expect(source).not.toContain(literal);
  });
});
