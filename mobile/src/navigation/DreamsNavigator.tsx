import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CountryDetailScreen } from '@screens/country/CountryDetailScreen';
import { DreamsScreen } from '@screens/DreamsScreen';

import type { DreamsStackParamList } from './types';

const Stack = createNativeStackNavigator<DreamsStackParamList>();

export function DreamsNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="DreamsHome"
        component={DreamsScreen}
        options={{ title: 'Where do you want to go' }}
      />
      <Stack.Screen
        name="CountryDetail"
        component={CountryDetailScreen}
        options={({ route }) => ({
          title: route.params?.countryName ?? '',
          headerBackButtonDisplayMode: 'minimal',
          headerTransparent: true,
          headerTintColor: '#fff',
        })}
      />
    </Stack.Navigator>
  );
}
