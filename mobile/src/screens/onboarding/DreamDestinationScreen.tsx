import { useEffect } from 'react';

import { CountrySelectionScreen, type CountrySelectionConfig } from '@components/onboarding';
import { colors } from '@constants/colors';
import { REGIONS } from '@constants/regions';
import type { Country } from '@hooks/useCountries';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';
import { useOnboardingStore } from '@stores/onboardingStore';

type Props = OnboardingStackScreenProps<'DreamDestination'>;

export function DreamDestinationScreen({ navigation }: Props) {
  const { dreamDestination, setDreamDestination, toggleBucketListCountry, bucketListCountries } =
    useOnboardingStore();

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
    backgroundColor: colors.lakeBlue,
    title: 'Pick your dream destination',
    dropdownBorderColor: colors.lakeBlue,
    celebration: {
      icon: 'sparkles',
      iconColor: colors.sunsetGold,
      iconSize: 24,
      text: 'Dream Added!',
      textColor: colors.midnightNavy,
      showStars: true,
      holdDuration: 700,
    },
    showBackButton: true,
    onCountrySelect: handleCountrySelect,
    getCurrentSelection: () => dreamDestination,
    onNavigateNext: () =>
      navigation.navigate('ContinentIntro', { region: REGIONS[0], regionIndex: 0 }),
    onNavigateBack: () => navigation.goBack(),
    onNavigateLogin: () => {
      Analytics.skipToLogin('DreamDestination');
      navigation.navigate('Auth', { screen: 'Auth' });
    },
    testIdPrefix: 'dream-destination',
  };

  return <CountrySelectionScreen config={config} />;
}
