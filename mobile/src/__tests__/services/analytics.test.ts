/**
 * Analytics service tests
 *
 * Tests the PostHog analytics wrapper to ensure events are properly tracked
 * in production and logged to console in development.
 */
import { initAnalytics, identifyUser, resetUser, track, Analytics } from '@services/analytics';

// Mock the env config
jest.mock('@config/env', () => ({
  isProduction: false,
}));

// Mock PostHog SDK - mock the class constructor
const mockPostHogInstance = {
  identify: jest.fn(),
  reset: jest.fn(),
  capture: jest.fn(),
};

jest.mock('posthog-react-native', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockPostHogInstance),
}));

describe('Analytics Service', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('initAnalytics', () => {
    it('logs to console in non-production mode', async () => {
      await initAnalytics();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Analytics] Non-production mode - events will be logged to console'
      );
    });
  });

  describe('identifyUser', () => {
    it('logs user identification in non-production mode', () => {
      identifyUser('user-123');

      expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Identify:', 'user-123');
    });
  });

  describe('resetUser', () => {
    it('logs user reset in non-production mode', () => {
      resetUser();

      expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Reset user');
    });
  });

  describe('track', () => {
    it('logs events with properties in non-production mode', () => {
      track('test_event', { key: 'value' });

      expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'test_event', {
        key: 'value',
      });
    });

    it('logs events without properties in non-production mode', () => {
      track('simple_event');

      expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'simple_event', {});
    });
  });

  describe('Analytics typed helpers', () => {
    /** Pull the props object of the last `[Analytics] Track:` console log. */
    const lastTrackedProps = (): Record<string, unknown> => {
      const trackCalls = consoleLogSpy.mock.calls.filter(
        (call) => call[0] === '[Analytics] Track:'
      );
      return trackCalls[trackCalls.length - 1][2] as Record<string, unknown>;
    };

    describe('Onboarding events', () => {
      it('tracks viewOnboardingWelcome', () => {
        Analytics.viewOnboardingWelcome();

        expect(consoleLogSpy).toHaveBeenCalledWith(
          '[Analytics] Track:',
          'view_onboarding_welcome',
          {}
        );
      });

      it('tracks viewOnboardingContinent with continent parameter', () => {
        Analytics.viewOnboardingContinent('Europe');

        expect(consoleLogSpy).toHaveBeenCalledWith(
          '[Analytics] Track:',
          'view_onboarding_continent',
          { continent: 'Europe' }
        );
      });

      it('tracks viewOnboardingProgress with countries count', () => {
        Analytics.viewOnboardingProgress(15);

        expect(consoleLogSpy).toHaveBeenCalledWith(
          '[Analytics] Track:',
          'view_onboarding_progress',
          { countries_count: 15 }
        );
      });

      it('tracks completeOnboarding with all properties', () => {
        Analytics.completeOnboarding({
          countriesCount: 10,
          homeCountry: 'US',
          trackingPreference: 'un_member',
        });

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'complete_onboarding', {
          countries_count: 10,
          home_country: 'US',
          tracking_preference: 'un_member',
        });
      });
    });

    describe('Core engagement events', () => {
      it('tracks appOpened with session ID', () => {
        Analytics.appOpened('session-abc-123');

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'app_opened', {
          session_id: 'session-abc-123',
        });
      });

      it('tracks viewPassport with countries count', () => {
        Analytics.viewPassport(25);

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'view_passport', {
          countries_count: 25,
        });
      });

      it('tracks createTrip with country code', () => {
        Analytics.createTrip('FR');

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'create_trip', {
          country_code: 'FR',
        });
      });

      it('tracks createEntry with all properties', () => {
        Analytics.createEntry({
          entryType: 'food',
          hasPlace: true,
          hasMedia: false,
        });

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'create_entry', {
          entry_type: 'food',
          has_place: true,
          has_media: false,
        });
      });
    });

    describe('Country events', () => {
      it('tracks addCountryVisited', () => {
        Analytics.addCountryVisited('JP');

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'add_country_visited', {
          country_code: 'JP',
        });
      });

      it('tracks addCountryWishlist', () => {
        Analytics.addCountryWishlist('NZ');

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'add_country_wishlist', {
          country_code: 'NZ',
        });
      });
    });

    describe('Sharing events', () => {
      it('tracks sharePassport', () => {
        Analytics.sharePassport();

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'share_passport', {});
      });

      it('tracks shareTrip with trip ID', () => {
        Analytics.shareTrip('trip-456');

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'share_trip', {
          trip_id: 'trip-456',
        });
      });

      it('tracks shareList with list ID', () => {
        Analytics.shareList('list-789');

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'share_list', {
          list_id: 'list-789',
        });
      });

      it('tracks shareMilestone with milestone metadata', () => {
        Analytics.shareMilestone({
          countryCode: 'US',
          countryRegion: 'North America',
          countrySubregion: 'Northern America',
          totalCount: 10,
          milestoneTypes: ['round_number', 'new_continent'],
        });

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'share_milestone', {
          country_code: 'US',
          country_region: 'North America',
          country_subregion: 'Northern America',
          total_count: 10,
          milestone_types: 'round_number,new_continent',
          milestone_count: 2,
        });
      });
    });

    describe('Skip events', () => {
      it('tracks skipToLogin with source screen', () => {
        Analytics.skipToLogin('motivation_screen');

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'skip_to_login', {
          from_screen: 'motivation_screen',
        });
      });
    });

    describe('Photo import place events (R27 place-id redaction)', () => {
      it('emits a hashed place id, not the raw id, on confirm', () => {
        Analytics.photoImportPlaceConfirmed({
          category: 'food',
          suggestionRank: 1,
          wasFromCache: false,
          originalSuggestionPlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
        });

        const props = lastTrackedProps();

        expect(props).not.toHaveProperty('original_suggestion_place_id');
        expect(props.original_suggestion_place_hash).toMatch(/^[0-9a-f]{16}$/);
        expect(JSON.stringify(props)).not.toContain('ChIJ');
      });

      it('emits a hashed place id, not the raw id, on reject', () => {
        Analytics.photoImportPlaceRejected({
          suggestionCount: 3,
          wasFromCache: true,
          originalSuggestionPlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
        });

        const props = lastTrackedProps();

        expect(props).not.toHaveProperty('original_suggestion_place_id');
        expect(props.original_suggestion_place_hash).toMatch(/^[0-9a-f]{16}$/);
        expect(JSON.stringify(props)).not.toContain('ChIJ');
      });

      it('produces the same hash for the same place across confirm and reject', () => {
        Analytics.photoImportPlaceConfirmed({
          category: 'food',
          suggestionRank: 1,
          wasFromCache: false,
          originalSuggestionPlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
        });
        const confirmedHash = lastTrackedProps().original_suggestion_place_hash;

        Analytics.photoImportPlaceRejected({
          suggestionCount: 3,
          wasFromCache: false,
          originalSuggestionPlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
        });
        const rejectedHash = lastTrackedProps().original_suggestion_place_hash;

        expect(confirmedHash).toBe(rejectedHash);
      });

      it('keeps a missing place id null instead of hashing it', () => {
        Analytics.photoImportPlaceConfirmed({
          category: 'stay',
          suggestionRank: 0,
          wasFromCache: false,
          originalSuggestionPlaceId: null,
        });
        expect(lastTrackedProps().original_suggestion_place_hash).toBeNull();

        Analytics.photoImportPlaceRejected({
          suggestionCount: 0,
          wasFromCache: false,
        });
        expect(lastTrackedProps().original_suggestion_place_hash).toBeNull();
      });
    });

    describe('Guess Where funnel events', () => {
      it('coerces every absent creation-view field to null', () => {
        Analytics.viewQuizCreation({
          entryPoint: 'passport_card',
          initialPhase: 'intro',
          permissionStatus: 'granted',
          limitedAccess: false,
          hasDraft: false,
        });

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'view_quiz_creation', {
          entry_point: 'passport_card',
          initial_phase: 'intro',
          permission_status: 'granted',
          limited_access: false,
          has_draft: false,
          draft_uploaded_count: null,
          draft_total_count: null,
          library_fresh: null,
          freshness_reason: null,
          cached_photo_count: null,
        });
      });

      it('tracks a creation start with its retry provenance', () => {
        Analytics.quizCreationStarted({
          entryPoint: 'my_quizzes',
          attemptIndex: 2,
          isResume: false,
          scanExpected: true,
          limitedAccess: false,
          retryFrom: 'thin-library',
        });

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'quiz_creation_started', {
          entry_point: 'my_quizzes',
          attempt_index: 2,
          is_resume: false,
          scan_expected: true,
          limited_access: false,
          retry_from: 'thin-library',
        });
      });

      it('carries the dominant decline reason on a thin library', () => {
        Analytics.quizCreationFailed({
          entryPoint: 'passport_card',
          reason: 'thin_library',
          attemptIndex: 1,
          durationMs: 42_000,
          limitedAccess: true,
          eligibleCount: 2,
          hasGeoCandidates: true,
          dominantReason: 'people_present',
        });

        const props = lastTrackedProps();
        expect(props.reason).toBe('thin_library');
        expect(props.dominant_reason).toBe('people_present');
        expect(props.eligible_count).toBe(2);
        // Interrupted-only fields stay null rather than undefined.
        expect(props.uploaded_count).toBeNull();
        expect(props.total_count).toBeNull();
        expect(props.stage).toBeNull();
      });

      it('distinguishes a swipe-back abandon from the cancel button', () => {
        Analytics.quizCreationAbandoned({
          entryPoint: 'onboarding_first_quiz',
          phase: 'working',
          attemptIndex: 1,
          durationMs: 71_000,
          step: 'building',
          foundCount: 4,
          examined: 220,
          uploadedCount: 2,
          viaCancelButton: false,
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
          '[Analytics] Track:',
          'quiz_creation_abandoned',
          {
            entry_point: 'onboarding_first_quiz',
            phase: 'working',
            attempt_index: 1,
            duration_ms: 71_000,
            step: 'building',
            found_count: 4,
            examined: 220,
            uploaded_count: 2,
            via_cancel_button: false,
          }
        );
      });

      it('derives is_resume from the resumed question number', () => {
        Analytics.viewQuizPlay({
          quizId: 'quiz-1',
          questionCount: 8,
          resumedAtNumber: 1,
          alreadyComplete: false,
        });
        expect(lastTrackedProps().is_resume).toBe(false);

        Analytics.viewQuizPlay({
          quizId: 'quiz-1',
          questionCount: 8,
          resumedAtNumber: 5,
          alreadyComplete: false,
        });
        expect(lastTrackedProps().is_resume).toBe(true);
      });

      it('derives the play completion rate and guards a zero total', () => {
        Analytics.quizPlayAbandoned({
          quizId: 'quiz-1',
          answeredCount: 3,
          total: 8,
          activeNumber: 4,
          durationMs: 12_000,
          exit: 'back_button',
        });
        expect(lastTrackedProps().completion_rate).toBe(38);

        Analytics.quizPlayAbandoned({
          quizId: 'quiz-1',
          answeredCount: 0,
          total: 0,
          activeNumber: 0,
          durationMs: 900,
          exit: 'unmount',
        });
        expect(lastTrackedProps().completion_rate).toBe(0);
      });

      it('tracks a stalled answer without a status code', () => {
        Analytics.quizPlayFailed({ quizId: 'quiz-1', stage: 'stalled' });

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'quiz_play_failed', {
          quiz_id: 'quiz-1',
          stage: 'stalled',
          status_code: null,
          active_number: null,
        });
      });

      it('tracks a share failure by its code, never its message', () => {
        Analytics.quizShareFailed({
          quizId: 'quiz-1',
          source: 'results',
          stage: 'mint',
          errorCode: 'QUIZ_OWNER_ANSWERS_INCOMPLETE',
        });

        const props = lastTrackedProps();
        expect(props.error_code).toBe('QUIZ_OWNER_ANSWERS_INCOMPLETE');
        expect(Object.keys(props)).not.toContain('message');
      });

      it('derives is_empty on the leaderboard view', () => {
        Analytics.viewQuizLeaderboard({
          quizId: 'quiz-1',
          entryCount: 0,
          hiddenCount: 0,
          scoreCorrect: null,
          scoreTotal: null,
        });
        expect(lastTrackedProps().is_empty).toBe(true);
      });

      it('reports arriving players without naming them', () => {
        Analytics.quizLeaderboardPlayersArrived({
          quizId: 'quiz-1',
          freshCount: 2,
          entryCount: 5,
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
          '[Analytics] Track:',
          'quiz_leaderboard_players_arrived',
          { quiz_id: 'quiz-1', fresh_count: 2, entry_count: 5 }
        );
      });

      it('flags an unreadable import watermark on the passport card', () => {
        Analytics.passportEntryCardShown({
          card: 'guess_where',
          hasQuizzes: true,
          quizCount: 3,
          hasInitialImport: true,
          watermarkUnreadable: true,
        });

        expect(consoleLogSpy).toHaveBeenCalledWith(
          '[Analytics] Track:',
          'passport_entry_card_shown',
          {
            card: 'guess_where',
            has_quizzes: true,
            quiz_count: 3,
            has_initial_import: true,
            watermark_unreadable: true,
          }
        );
      });

      it('tracks the enriched share funnel props', () => {
        Analytics.quizShareInitiated({
          quizId: 'quiz-1',
          source: 'leaderboard_empty',
          isReshare: true,
          scoreCorrect: null,
          scoreTotal: null,
          photoCount: 6,
        });

        expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'quiz_share_initiated', {
          quiz_id: 'quiz-1',
          source: 'leaderboard_empty',
          is_reshare: true,
          score_correct: null,
          score_total: null,
          photo_count: 6,
        });
      });
    });
  });
});
