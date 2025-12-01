import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CountryDetailScreen } from '@screens/country/CountryDetailScreen';
import { PassportScreen } from '@screens/PassportScreen';

import type { PassportStackParamList } from './types';

const Stack = createNativeStackNavigator<PassportStackParamList>();

export function PassportNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="PassportHome"
        component={PassportScreen}
        options={{ title: 'Passport' }}
      />
      <Stack.Screen
        name="CountryDetail"
        component={CountryDetailScreen}
        options={({ route }) => ({
          title: route.params.countryName || 'Country',
        })}
      />
    </Stack.Navigator>
  );
}
