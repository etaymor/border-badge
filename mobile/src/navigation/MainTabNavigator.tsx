import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { CommonActions, getFocusedRouteNameFromRoute, RouteProp } from '@react-navigation/native';

import LiquidGlassTabBar from '@components/navigation/LiquidGlassTabBar';
import { ProfileScreen } from '@screens/ProfileScreen';

import { DreamsNavigator } from './DreamsNavigator';
import { PassportNavigator } from './PassportNavigator';
import { TripsNavigator } from './TripsNavigator';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

// Screens where tab bar should be hidden (creation/editing modes)
const HIDDEN_TAB_BAR_SCREENS = ['TripForm', 'ListCreate', 'ListEdit', 'EntryForm'];

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
        options={({ route }) => ({
          title: 'Trips',
          tabBarAccessibilityLabel: 'trips-tab',
          tabBarStyle: getTabBarStyle(route),
        })}
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
        component={ProfileScreen}
        options={{ title: 'Friends', headerShown: true, tabBarAccessibilityLabel: 'friends-tab' }}
      />
    </Tab.Navigator>
  );
}
