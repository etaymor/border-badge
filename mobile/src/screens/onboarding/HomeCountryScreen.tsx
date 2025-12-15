import { CountrySelectionScreen, type CountrySelectionConfig } from '@components/onboarding';
import { colors } from '@constants/colors';
import type { Country } from '@hooks/useCountries';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { useOnboardingStore } from '@stores/onboardingStore';

type Props = OnboardingStackScreenProps<'HomeCountry'>;

export function HomeCountryScreen({ navigation }: Props) {
  const { homeCountry, setHomeCountry, toggleCountry, selectedCountries } = useOnboardingStore();

  const handleCountrySelect = (country: Country) => {
    setHomeCountry(country.code);
    // Also add to visited countries if not already there
    if (!selectedCountries.includes(country.code)) {
      toggleCountry(country.code);
    }
  };

  const config: CountrySelectionConfig = {
    backgroundColor: colors.dustyCoral,
    title: "Where's home?",
    dropdownBorderColor: colors.dustyCoral,
    celebration: {
      icon: 'checkmark-circle',
      iconColor: colors.mossGreen,
      text: 'Home Set!',
      textColor: colors.mossGreen,
    },
    heroElement: 'locationPin',
    showBackButton: false,
    onCountrySelect: handleCountrySelect,
    getCurrentSelection: () => homeCountry,
    onNavigateNext: () => navigation.navigate('TrackingPreference'),
    onNavigateLogin: () => navigation.navigate('Auth', { screen: 'Auth' }),
    testIdPrefix: 'home-country',
  };

  return <CountrySelectionScreen config={config} />;
}
