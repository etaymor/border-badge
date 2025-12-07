import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { TripDetailScreen } from '@screens/trips/TripDetailScreen';
import { TripFormScreen } from '@screens/trips/TripFormScreen';
import { TripsListScreen } from '@screens/trips/TripsListScreen';
import { EntryListScreen, EntryFormScreen } from '@screens/entries';
import { ListCreateScreen, ListEditScreen, TripListsScreen } from '@screens/lists';

import type { TripsStackParamList } from './types';

const Stack = createNativeStackNavigator<TripsStackParamList>();

// Placeholder for EntryDetail screen (deferred to later phase)
function EntryDetailPlaceholder() {
  return null;
}

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
          presentation: 'card',
          headerBackVisible: true,
        })}
      />
      <Stack.Screen
        name="EntryList"
        component={EntryListScreen}
        options={({ route }) => ({
          title: route.params?.tripName ? `${route.params.tripName} - Entries` : 'Entries',
        })}
      />
      <Stack.Screen
        name="EntryDetail"
        component={EntryDetailPlaceholder}
        options={{ title: 'Entry Details' }}
      />
      <Stack.Screen
        name="EntryForm"
        component={EntryFormScreen}
        options={({ route }) => ({
          title: route.params?.entryId ? 'Edit Entry' : 'New Entry',
        })}
      />
      <Stack.Screen
        name="TripLists"
        component={TripListsScreen}
        options={{ title: 'Shareable Lists' }}
      />
      <Stack.Screen
        name="ListCreate"
        component={ListCreateScreen}
        options={{ title: 'Create List' }}
      />
      <Stack.Screen name="ListEdit" component={ListEditScreen} options={{ title: 'Edit List' }} />
    </Stack.Navigator>
  );
}
