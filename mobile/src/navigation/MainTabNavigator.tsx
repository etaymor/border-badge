import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';

import { MapScreen } from '@screens/MapScreen';
import { ProfileScreen } from '@screens/ProfileScreen';

import { TripsNavigator } from './TripsNavigator';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

// Placeholder icons until we add an icon library
function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Map: '🗺️',
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
        headerShown: route.name !== 'Trips', // Trips has its own header from stack
      })}
    >
      <Tab.Screen name="Map" component={MapScreen} options={{ title: 'Map' }} />
      <Tab.Screen name="Trips" component={TripsNavigator} options={{ headerShown: false }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}
