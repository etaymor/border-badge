import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';

import { ProfileScreen } from '@screens/ProfileScreen';

import { DreamsNavigator } from './DreamsNavigator';
import { PassportNavigator } from './PassportNavigator';
import { TripsNavigator } from './TripsNavigator';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

// Placeholder icons until we add an icon library
function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Passport: '🛂',
    Dreams: '❤️',
    Trips: '✈️',
    Profile: '👤',
  };
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{icons[name] || '●'}</Text>;
}

export function MainTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused} />,
        tabBarActiveTintColor: '#1a1a1a',
        tabBarInactiveTintColor: '#999',
        headerShown: false, // Stacks have their own headers
      })}
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
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'Profile', headerShown: true, tabBarAccessibilityLabel: 'profile-tab' }}
      />
    </Tab.Navigator>
  );
}
