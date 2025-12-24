import { useEffect } from 'react';

import { CountrySelectionScreen, type CountrySelectionConfig } from '@components/onboarding';
import { colors } from '@constants/colors';
import type { Country } from '@hooks/useCountries';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';
import { useOnboardingStore } from '@stores/onboardingStore';

type Props = OnboardingStackScreenProps<'HomeCountry'>;

export function HomeCountryScreen({ navigation }: Props) {
  const { homeCountry, setHomeCountry, toggleCountry, selectedCountries } = useOnboardingStore();

  // Track screen view
  useEffect(() => {
    Analytics.viewOnboardingHomeCountry();
  }, []);

  const handleCountrySelect = (country: Country) => {
    // If changing home country, remove the old one from visited
    // (assume selecting it as home was a mistake)
    if (homeCountry && homeCountry !== country.code && selectedCountries.includes(homeCountry)) {
      toggleCountry(homeCountry);
    }

    setHomeCountry(country.code);

    // Add new home country to visited if not already there
    if (!selectedCountries.includes(country.code)) {
      toggleCountry(country.code);
    }
  };

  const config: CountrySelectionConfig = {
    backgroundColor: colors.dustyCoral,
    title: "Where's home?",
    dropdownBorderColor: colors.dustyCoral,
    celebrationType: 'home',
    heroElement: 'locationPin',
    showBackButton: false,
    onCountrySelect: handleCountrySelect,
    getCurrentSelection: () => homeCountry,
    onNavigateNext: () => navigation.navigate('TrackingPreference'),
    onNavigateLogin: () => {
      Analytics.skipToLogin('HomeCountry');
      navigation.navigate('Auth', { screen: 'Login' });
    },
    testIdPrefix: 'home-country',
  };

  return <CountrySelectionScreen config={config} />;
}
