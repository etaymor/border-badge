import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CountryDetailScreen } from '@screens/country/CountryDetailScreen';
import { PassportScreen } from '@screens/PassportScreen';
import { ProfileSettingsScreen } from '@screens/profile/ProfileSettingsScreen';
import { ShareCaptureScreen } from '@screens/share/ShareCaptureScreen';
// LAUNCH_SIMPLIFICATION: Trips flow is nested here while tab bar is hidden.
import { TripsNavigator } from './TripsNavigator';

import type { PassportStackParamList } from './types';

const Stack = createNativeStackNavigator<PassportStackParamList>();

export function PassportNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="PassportHome"
        component={PassportScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CountryDetail"
        component={CountryDetailScreen}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="ProfileSettings"
        component={ProfileSettingsScreen}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="Trips"
        component={TripsNavigator}
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="ShareCapture"
        component={ShareCaptureScreen}
        options={{
          headerShown: false,
          presentation: 'modal',
          animation: 'slide_from_bottom',
        }}
      />
    </Stack.Navigator>
  );
}
