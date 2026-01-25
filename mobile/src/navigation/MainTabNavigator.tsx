import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { CommonActions, getFocusedRouteNameFromRoute, RouteProp } from '@react-navigation/native';

import LiquidGlassTabBar from '@components/navigation/LiquidGlassTabBar';

import { DreamsNavigator } from './DreamsNavigator';
import { PassportNavigator } from './PassportNavigator';
import { TripsNavigator } from './TripsNavigator';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

// Screens where tab bar should be hidden (creation/editing modes)
const HIDDEN_TAB_BAR_SCREENS = ['TripForm', 'ListCreate', 'ListEdit', 'EntryForm', 'ShareCapture'];

/**
 * Determines tab bar visibility based on the currently focused screen.
 * Hides tab bar during creation/editing flows for better focus (Apple HIG pattern).
 */
function getTabBarStyle(route: RouteProp<MainTabParamList, keyof MainTabParamList>) {
  const routeName = getFocusedRouteNameFromRoute(route);

  if (routeName && HIDDEN_TAB_BAR_SCREENS.includes(routeName)) {
    return { display: 'none' as const };
  }

  return undefined;
}

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
        options={({ route }) => ({
          title: 'Passport',
          tabBarAccessibilityLabel: 'passport-tab',
          tabBarStyle: getTabBarStyle(route),
        })}
        listeners={({ navigation, route }) => ({
          tabPress: () => {
            // Only reset stack if already on this tab (double-tap to go home pattern)
            // This preserves stack state when switching between tabs
            const state = navigation.getState();
            const currentTabIndex = state?.index ?? 0;
            const targetTabIndex = state?.routes.findIndex((r) => r.key === route.key);

            // Guard against findIndex returning -1 (route not found)
            if (targetTabIndex === -1) return;

            if (currentTabIndex === targetTabIndex) {
              // Already on this tab - reset to first screen
              navigation.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [{ name: 'Passport' }],
                })
              );
            }
            // Otherwise, let default tab navigation handle it (preserves stack)
          },
        })}
      />
      <Tab.Screen
        name="Dreams"
        component={DreamsNavigator}
        options={{ title: 'Dreams', tabBarAccessibilityLabel: 'dreams-tab' }}
        listeners={({ navigation, route }) => ({
          tabPress: () => {
            const state = navigation.getState();
            const currentTabIndex = state?.index ?? 0;
            const targetTabIndex = state?.routes.findIndex((r) => r.key === route.key);

            // Guard against findIndex returning -1 (route not found)
            if (targetTabIndex === -1) return;

            if (currentTabIndex === targetTabIndex) {
              navigation.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [{ name: 'Dreams' }],
                })
              );
            }
          },
        })}
      />
      <Tab.Screen
        name="Trips"
        component={TripsNavigator}
        options={({ route }) => ({
          title: 'Trips',
          tabBarAccessibilityLabel: 'trips-tab',
          tabBarStyle: getTabBarStyle(route),
        })}
        listeners={({ navigation, route }) => ({
          tabPress: () => {
            const state = navigation.getState();
            const currentTabIndex = state?.index ?? 0;
            const targetTabIndex = state?.routes.findIndex((r) => r.key === route.key);

            // Guard against findIndex returning -1 (route not found)
            if (targetTabIndex === -1) return;

            if (currentTabIndex === targetTabIndex) {
              navigation.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [{ name: 'Trips' }],
                })
              );
            }
          },
        })}
      />
      {/* LAUNCH_SIMPLIFICATION: Friends tab hidden for initial launch
      <Tab.Screen
        name="Friends"
        component={ProfileScreen}
        options={{ title: 'Friends', headerShown: true, tabBarAccessibilityLabel: 'friends-tab' }}
      />
      */}
    </Tab.Navigator>
  );
}
