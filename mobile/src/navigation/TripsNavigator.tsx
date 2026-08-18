import { StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { GlassBackButton } from '@components/ui';
import { EntryListScreen, EntryFormScreen } from '@screens/entries';
import { ListCreateScreen, ListEditScreen, TripListsScreen } from '@screens/lists';
import { PhotoImportScreen } from '@screens/photos/PhotoImportScreen';
import { PhotoTripsScreen } from '@screens/photos/PhotoTripsScreen';
import { TripDetailScreen } from '@screens/trips/TripDetailScreen';
import { TripFormScreen } from '@screens/trips/TripFormScreen';
import { TripsListScreen } from '@screens/trips/TripsListScreen';
import { PendingTripTagsScreen } from '@screens/notifications/PendingTripTagsScreen';
import SavedPlacesScreen from '@screens/trips/SavedPlacesScreen';
import { colors } from '@constants/colors';

import type { TripsStackParamList } from './types';

// Note: TripsNavigator uses native stack for native header support
// Shared element transitions for trips will be handled differently in Phase 3
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
      <Stack.Screen
        name="TripsList"
        component={TripsListScreen}
        options={{ headerShown: false, title: 'My Trips' }}
      />
      <Stack.Screen
        name="TripDetail"
        component={TripDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="TripForm" component={TripFormScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="EntryList"
        component={EntryListScreen}
        options={({ route, navigation }) => ({
          title: route.params?.tripName ? `${route.params.tripName} - Entries` : 'Entries',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.warmCream },
          headerLeft: () => (
            <View style={styles.headerLeftContainer}>
              <GlassBackButton onPress={() => navigation.goBack()} />
            </View>
          ),
        })}
      />
      <Stack.Screen
        name="EntryDetail"
        component={EntryDetailPlaceholder}
        options={({ navigation }) => ({
          title: 'Entry Details',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.warmCream },
          headerLeft: () => (
            <View style={styles.headerLeftContainer}>
              <GlassBackButton onPress={() => navigation.goBack()} />
            </View>
          ),
        })}
      />
      <Stack.Screen name="EntryForm" component={EntryFormScreen} options={{ headerShown: false }} />
      <Stack.Screen name="TripLists" component={TripListsScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="ListCreate"
        component={ListCreateScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="ListEdit" component={ListEditScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="PendingTripTags"
        component={PendingTripTagsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SavedPlaces"
        component={SavedPlacesScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PhotoTrips"
        component={PhotoTripsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PhotoImport"
        component={PhotoImportScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  headerLeftContainer: {
    marginLeft: 8,
    justifyContent: 'center',
  },
});
