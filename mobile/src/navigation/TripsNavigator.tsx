import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { TripDetailScreen } from '@screens/trips/TripDetailScreen';
import { TripFormScreen } from '@screens/trips/TripFormScreen';
import { TripsListScreen } from '@screens/trips/TripsListScreen';
import { EntryListScreen, EntryFormScreen } from '@screens/entries';
import { ListCreateScreen, ListEditScreen, TripListsScreen } from '@screens/lists';

import type { TripsStackParamList } from './types';

const Stack = createNativeStackNavigator<TripsStackParamList>();

// Custom back button component for consistent behavior
function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ marginLeft: -8 }}>
      <Ionicons name="chevron-back" size={28} color="#007AFF" />
    </Pressable>
  );
}

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
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="TripForm"
        component={TripFormScreen}
        options={({ navigation }) => ({
          title: '',
          headerShadowVisible: false,
          headerLeft: () => <BackButton onPress={() => navigation.goBack()} />,
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
        options={({ navigation }) => ({
          title: '',
          headerShadowVisible: false,
          headerLeft: () => <BackButton onPress={() => navigation.goBack()} />,
        })}
      />
      <Stack.Screen
        name="TripLists"
        component={TripListsScreen}
        options={({ navigation }) => ({
          title: '',
          headerShadowVisible: false,
          headerLeft: () => <BackButton onPress={() => navigation.goBack()} />,
        })}
      />
      <Stack.Screen
        name="ListCreate"
        component={ListCreateScreen}
        options={({ navigation }) => ({
          title: '',
          headerShadowVisible: false,
          headerLeft: () => <BackButton onPress={() => navigation.goBack()} />,
        })}
      />
      <Stack.Screen
        name="ListEdit"
        component={ListEditScreen}
        options={({ navigation }) => ({
          title: '',
          headerShadowVisible: false,
          headerLeft: () => <BackButton onPress={() => navigation.goBack()} />,
        })}
      />
    </Stack.Navigator>
  );
}
