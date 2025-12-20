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
  });
});
