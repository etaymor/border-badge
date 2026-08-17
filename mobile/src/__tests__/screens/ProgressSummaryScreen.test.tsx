import { act, render, screen } from '../utils/testUtils';
import { createMockNavigation } from '../utils/mockFactories';

import { ProgressSummaryScreen } from '@screens/onboarding/ProgressSummaryScreen';
import { useOnboardingStore } from '@stores/onboardingStore';

import type { OnboardingStackScreenProps } from '@navigation/types';

const EXPO_IMAGE_HOST = 'ViewManagerAdapter_ExpoImage';

// Countries are not required for the stamp render; stub the hook so no network runs.
jest.mock('@hooks/useCountries', () => ({
  useCountries: () => ({ data: [], isLoading: false, error: null, refetch: jest.fn() }),
}));

const mockNavigation =
  createMockNavigation() as unknown as OnboardingStackScreenProps<'ProgressSummary'>['navigation'];
const mockRoute = {
  key: 'test',
  name: 'ProgressSummary',
} as OnboardingStackScreenProps<'ProgressSummary'>['route'];

// 60 valid ISO codes that all have stamp images (subset of assets/stampImages.ts).
const SIXTY_COUNTRY_CODES = [
  'AD',
  'AE',
  'AF',
  'AG',
  'AL',
  'AM',
  'AO',
  'AR',
  'AT',
  'AU',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BN',
  'BO',
  'BR',
  'BS',
  'BT',
  'BW',
  'BY',
  'BZ',
  'CA',
  'CH',
  'CI',
  'CL',
  'CM',
  'CN',
  'CO',
  'CR',
  'CU',
  'CV',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FR',
  'GA',
  'GB',
  'GD',
  'GE',
  'GH',
];

/**
 * Render the screen and flush its entrance/stamp animation timers inside act()
 * so the async spring-completion state updates don't leak past the test.
 */
function renderScreen() {
  const result = render(<ProgressSummaryScreen navigation={mockNavigation} route={mockRoute} />);
  act(() => {
    jest.runOnlyPendingTimers();
  });
  return result;
}

describe('ProgressSummaryScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    useOnboardingStore.setState({
      selectedCountries: [],
      homeCountry: null,
      motivationTags: [],
      personaTags: [],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders every stamp for 60 visited countries with no visual cap', () => {
    expect(SIXTY_COUNTRY_CODES).toHaveLength(60);
    useOnboardingStore.setState({ selectedCountries: SIXTY_COUNTRY_CODES });

    renderScreen();

    // All 60 stamps must render (decode-at-display-size is handled by expo-image
    // downscaling, not by capping the count).
    const stamps = screen.getAllByTestId(/^progress-stamp-/);
    expect(stamps).toHaveLength(60);
  });

  it('renders stamps as expo-image with downscaling props (contentFit + cachePolicy)', () => {
    useOnboardingStore.setState({ selectedCountries: SIXTY_COUNTRY_CODES.slice(0, 3) });

    renderScreen();

    const stamp = screen.getByTestId('progress-stamp-AD');
    expect(stamp.type).toBe(EXPO_IMAGE_HOST);
    expect(stamp.props.contentFit).toBe('contain');
    expect(stamp.props.recyclingKey).toBe('AD');
    expect(stamp.props.cachePolicy).toBe('memory-disk');
    // The stamp fills its measurable (positioned/sized) wrapper.
    expect(stamp.props.style).toEqual(expect.objectContaining({ width: '100%', height: '100%' }));
  });

  it('includes the home country as a visited stamp', () => {
    useOnboardingStore.setState({ selectedCountries: ['FR', 'DE'], homeCountry: 'GB' });

    renderScreen();

    expect(screen.getByTestId('progress-stamp-FR')).toBeTruthy();
    expect(screen.getByTestId('progress-stamp-DE')).toBeTruthy();
    expect(screen.getByTestId('progress-stamp-GB')).toBeTruthy();
  });
});
