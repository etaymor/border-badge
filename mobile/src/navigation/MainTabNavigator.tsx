import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { CommonActions, getFocusedRouteNameFromRoute, RouteProp } from '@react-navigation/native';

import LiquidGlassTabBar from '@components/navigation/LiquidGlassTabBar';

import { DreamsNavigator } from './DreamsNavigator';
import { PassportNavigator } from './PassportNavigator';
import { TripsNavigator } from './TripsNavigator';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

// Screens where tab bar should be hidden (creation/editing modes)
const HIDDEN_TAB_BAR_SCREENS = [
  'TripForm',
  'ListCreate',
  'ListEdit',
  'EntryForm',
  'PhotoTrips',
  'PhotoImport',
];

/**
 * Determines tab bar visibility based on the currently focused screen.
 * Hides tab bar during creation/editing flows for better focus (Apple HIG pattern).
 * Recursively checks nested navigators (e.g. TripForm inside TripsNavigator inside PassportNavigator).
 */
function getTabBarStyle(route: RouteProp<MainTabParamList, keyof MainTabParamList>) {
  // Start with the immediate child of the Tab
  const routeName = getFocusedRouteNameFromRoute(route);

  // If we can't determine the child, we assume we are at the root or initial screen
  if (!routeName) return undefined;

  // Check if the immediate child is hidden
  if (HIDDEN_TAB_BAR_SCREENS.includes(routeName)) {
    return { display: 'none' as const };
  }

  // Traverse nested navigators
  // We need to look into the state of the current route to find the child route object matches routeName
  // Cast route to include state (RouteProp doesn't expose it but it exists at runtime)
  const routeWithState = route as typeof route & {
    state?: { routes: Array<{ name: string; state?: { routes: Array<{ name: string }> } }> };
  };
  let currentRoute = routeWithState.state?.routes.find(
    (r: { name: string }) => r.name === routeName
  );

  while (currentRoute) {
    // Get the focused child of the current route
    const nextRouteName = getFocusedRouteNameFromRoute(currentRoute);

    if (!nextRouteName) break; // Reached a leaf screen

    if (HIDDEN_TAB_BAR_SCREENS.includes(nextRouteName)) {
      return { display: 'none' as const };
    }

    // Proceed deeper
    // Use explicit type casting for nested state access
    const nestedState = currentRoute.state;
    if (nestedState && nestedState.routes) {
      currentRoute = nestedState.routes.find((r: { name: string }) => r.name === nextRouteName);
    } else {
      currentRoute = undefined;
    }
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
            if (!state?.routes) return;

            const currentTabIndex = state.index ?? 0;
            const targetTabIndex = state.routes.findIndex((r) => r.key === route.key);

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
        options={({ route }) => ({
          title: 'Dreams',
          tabBarAccessibilityLabel: 'dreams-tab',
          tabBarStyle: getTabBarStyle(route),
        })}
        listeners={({ navigation, route }) => ({
          tabPress: () => {
            const state = navigation.getState();
            if (!state?.routes) return;

            const currentTabIndex = state.index ?? 0;
            const targetTabIndex = state.routes.findIndex((r) => r.key === route.key);

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
            if (!state?.routes) return;

            const currentTabIndex = state.index ?? 0;
            const targetTabIndex = state.routes.findIndex((r) => r.key === route.key);

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
