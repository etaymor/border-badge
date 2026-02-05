import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CountryDetailScreen } from '@screens/country/CountryDetailScreen';
import { DreamsScreen } from '@screens/DreamsScreen';
import { TripFormScreen } from '@screens/trips/TripFormScreen';

import type { DreamsStackParamList } from './types';

const Stack = createNativeStackNavigator<DreamsStackParamList>();

export function DreamsNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="DreamsHome" component={DreamsScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="CountryDetail"
        component={CountryDetailScreen}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen name="TripForm" component={TripFormScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
