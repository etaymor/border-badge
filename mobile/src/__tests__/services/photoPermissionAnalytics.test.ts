import { Analytics } from '@services/analytics';

jest.mock('@config/env', () => ({
  isProduction: false,
}));

describe('photo permission funnel analytics', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('sends door on photo_permission_soft_ask_shown', () => {
    Analytics.photoPermissionSoftAskShown({ door: 'quiz' });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[Analytics] Track:',
      'photo_permission_soft_ask_shown',
      { door: 'quiz' }
    );
  });

  it('sends door and status on photo_permission_os_result', () => {
    Analytics.photoPermissionOsResult({ door: 'trips', status: 'limited' });

    expect(consoleLogSpy).toHaveBeenCalledWith('[Analytics] Track:', 'photo_permission_os_result', {
      door: 'trips',
      status: 'limited',
    });
  });

  it('sends scalar carousel step properties with event-shaped names', () => {
    Analytics.photoPermissionCarouselStep({ door: 'quiz', step: 2, via: 'swipe' });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[Analytics] Track:',
      'photo_permission_carousel_step',
      { door: 'quiz', step: 2, via: 'swipe' }
    );
  });

  it('sends the last step when the carousel is left', () => {
    Analytics.photoPermissionCarouselLeft({ door: 'trips', step: 3 });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[Analytics] Track:',
      'photo_permission_carousel_left',
      { door: 'trips', step: 3 }
    );
  });

  it('accepts every door and status value', () => {
    const doors = ['quiz', 'trips', 'profile', 'other'] as const;
    const statuses = ['granted', 'limited', 'denied', 'undetermined'] as const;

    for (const door of doors) {
      Analytics.photoPermissionSoftAskShown({ door });
      for (const status of statuses) {
        Analytics.photoPermissionOsResult({ door, status });
      }
    }

    expect(
      consoleLogSpy.mock.calls.filter((call) => call[1] === 'photo_permission_soft_ask_shown')
    ).toHaveLength(4);
    expect(
      consoleLogSpy.mock.calls.filter((call) => call[1] === 'photo_permission_os_result')
    ).toHaveLength(16);
  });
});
