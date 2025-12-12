import { StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { GlassBackButton } from '@components/ui';
import { TripDetailScreen } from '@screens/trips/TripDetailScreen';
import { TripFormScreen } from '@screens/trips/TripFormScreen';
import { TripsListScreen } from '@screens/trips/TripsListScreen';
import { EntryListScreen, EntryFormScreen } from '@screens/entries';
import { ListCreateScreen, ListEditScreen, TripListsScreen } from '@screens/lists';
import { colors } from '@constants/colors';

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
      <Stack.Screen
        name="TripForm"
        component={TripFormScreen}
        options={{ headerShown: false }}
      />
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
      <Stack.Screen
        name="EntryForm"
        component={EntryFormScreen}
        options={({ navigation }) => ({
          title: '',
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
        name="TripLists"
        component={TripListsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ListCreate"
        component={ListCreateScreen}
        options={({ navigation }) => ({
          title: '',
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
        name="ListEdit"
        component={ListEditScreen}
        options={({ navigation }) => ({
          title: '',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.warmCream },
          headerLeft: () => (
            <View style={styles.headerLeftContainer}>
              <GlassBackButton onPress={() => navigation.goBack()} />
            </View>
          ),
        })}
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
