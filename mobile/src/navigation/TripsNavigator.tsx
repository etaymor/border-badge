import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { TripDetailScreen } from '@screens/trips/TripDetailScreen';
import { TripFormScreen } from '@screens/trips/TripFormScreen';
import { TripsListScreen } from '@screens/trips/TripsListScreen';

import type { TripsStackParamList } from './types';

const Stack = createNativeStackNavigator<TripsStackParamList>();

export function TripsNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: true,
      }}
    >
      <Stack.Screen name="TripsList" component={TripsListScreen} options={{ title: 'My Trips' }} />
      <Stack.Screen
        name="TripDetail"
        component={TripDetailScreen}
        options={{ title: 'Trip Details' }}
      />
      <Stack.Screen
        name="TripForm"
        component={TripFormScreen}
        options={({ route }) => ({
          title: route.params?.tripId ? 'Edit Trip' : 'New Trip',
        })}
      />
    </Stack.Navigator>
  );
}
