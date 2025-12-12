import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import LiquidGlassTabBar from '@components/navigation/LiquidGlassTabBar';
import { ProfileScreen } from '@screens/ProfileScreen';

import { DreamsNavigator } from './DreamsNavigator';
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
      />
      <Tab.Screen
        name="Dreams"
        component={DreamsNavigator}
        options={{ title: 'Dreams', tabBarAccessibilityLabel: 'dreams-tab' }}
      />
      <Tab.Screen
        name="Trips"
        component={TripsNavigator}
        options={{ title: 'Trips', tabBarAccessibilityLabel: 'trips-tab' }}
      />
      <Tab.Screen
        name="Friends"
        component={ProfileScreen}
        options={{ title: 'Friends', headerShown: true, tabBarAccessibilityLabel: 'friends-tab' }}
      />
    </Tab.Navigator>
  );
}
