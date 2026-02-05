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
    backgroundColor: colors.warmCream,
    title: 'What country do you live in?',
    celebrationType: 'home',
    showBackButton: true,
    onNavigateBack: () => navigation.goBack(),
    stampSuggestions: ['US', 'DE', 'BR', 'GB', 'AE'],
    onCountrySelect: handleCountrySelect,
    getCurrentSelection: () => homeCountry,
    // LAUNCH_SIMPLIFICATION: Skip TrackingPreference, go directly to DreamDestination
    // TODO: Restore to 'TrackingPreference' when re-enabling tracking preference selection
    onNavigateNext: () => navigation.navigate('DreamDestination'),
    onNavigateLogin: () => {
      Analytics.skipToLogin('HomeCountry');
      navigation.navigate('Auth', { screen: 'Login' });
    },
    testIdPrefix: 'home-country',
  };

  return <CountrySelectionScreen config={config} />;
}
