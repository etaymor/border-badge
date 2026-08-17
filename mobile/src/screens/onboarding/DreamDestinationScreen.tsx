import { useEffect } from 'react';

import { CountrySelectionScreen, type CountrySelectionConfig } from '@components/onboarding';
import { colors } from '@constants/colors';
import { REGIONS } from '@constants/regions';
import type { Country } from '@hooks/useCountries';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';
import {
  useOnboardingStore,
  selectDreamDestination,
  selectBucketListCountries,
} from '@stores/onboardingStore';

type Props = OnboardingStackScreenProps<'DreamDestination'>;

export function DreamDestinationScreen({ navigation }: Props) {
  const dreamDestination = useOnboardingStore(selectDreamDestination);
  const bucketListCountries = useOnboardingStore(selectBucketListCountries);
  const setDreamDestination = useOnboardingStore((s) => s.setDreamDestination);
  const toggleBucketListCountry = useOnboardingStore((s) => s.toggleBucketListCountry);

  // Track screen view
  useEffect(() => {
    Analytics.viewOnboardingDream();
  }, []);

  const handleCountrySelect = (country: Country) => {
    setDreamDestination(country.code);
    // Also add to bucket list if not already there
    if (!bucketListCountries.includes(country.code)) {
      toggleBucketListCountry(country.code);
    }
  };

  const config: CountrySelectionConfig = {
    backgroundColor: colors.warmCream, // Use warm cream for "Paper" signature look
    title: 'Where do you want to go?',
    subtitle: "What's one country on your bucket list?",
    celebrationType: 'dream',
    showBackButton: true,
    stampSuggestions: ['JP', 'ZA', 'AR', 'FR', 'IT'],
    onCountrySelect: handleCountrySelect,
    getCurrentSelection: () => dreamDestination,
    onNavigateNext: () =>
      navigation.navigate('ContinentIntro', { region: REGIONS[0], regionIndex: 0 }),
    onNavigateBack: () => navigation.goBack(),
    onNavigateLogin: () => {
      Analytics.skipToLogin('DreamDestination');
      navigation.navigate('Auth', { screen: 'Login' });
    },
    testIdPrefix: 'dream-destination',
  };

  return <CountrySelectionScreen config={config} />;
}
