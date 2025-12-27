import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { CommonActions } from '@react-navigation/native';

import LiquidGlassTabBar from '@components/navigation/LiquidGlassTabBar';

import { DreamsNavigator } from './DreamsNavigator';
import { FriendsNavigator } from './FriendsNavigator';
import { PassportNavigator } from './PassportNavigator';
import { TripsNavigator } from './TripsNavigator';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <LiquidGlassTabBar {...props} />}
      screenOptions={{
        headerShown: false, // Stacks have their own headers
      }}
    >
      <Tab.Screen
        name="Passport"
        component={PassportNavigator}
        options={{ title: 'Passport', tabBarAccessibilityLabel: 'passport-tab' }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            // Reset to the first screen of the stack when tab is pressed
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'Passport' }],
              })
            );
          },
        })}
      />
      <Tab.Screen
        name="Dreams"
        component={DreamsNavigator}
        options={{ title: 'Dreams', tabBarAccessibilityLabel: 'dreams-tab' }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'Dreams' }],
              })
            );
          },
        })}
      />
      <Tab.Screen
        name="Trips"
        component={TripsNavigator}
        options={{ title: 'Trips', tabBarAccessibilityLabel: 'trips-tab' }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            // Reset to TripsList when Trips tab is pressed
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'Trips' }],
              })
            );
          },
        })}
      />
      <Tab.Screen
        name="Friends"
        component={FriendsNavigator}
        options={{ title: 'Friends', tabBarAccessibilityLabel: 'friends-tab' }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            navigation.dispatch(
              CommonActions.reset({
                index: 0,
                routes: [{ name: 'Friends' }],
              })
            );
          },
        })}
      />
    </Tab.Navigator>
  );
}
