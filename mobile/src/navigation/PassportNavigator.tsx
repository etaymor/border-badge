import { createBlankStackNavigator } from 'react-native-screen-transitions/blank-stack';
import Transition from 'react-native-screen-transitions';
import { View, StyleSheet } from 'react-native';

import { ClipboardBannerOverlay } from '@components/share';
import { CountryDetailScreen } from '@screens/country/CountryDetailScreen';
import { PassportScreen } from '@screens/passport/PassportScreen';
import { ProfileSettingsScreen } from '@screens/profile/ProfileSettingsScreen';
import { ShareCaptureScreen } from '@screens/share/ShareCaptureScreen';
// LAUNCH_SIMPLIFICATION: Trips flow is nested here while tab bar is hidden.
import { TripsNavigator } from './TripsNavigator';
import { SlideWithScalePreset, SharedCountryPreset } from './interpolators';

import type { PassportStackParamList } from './types';

const Stack = createBlankStackNavigator<PassportStackParamList>();

/**
 * Inner navigator component that has access to the navigation context.
 * The ClipboardBannerOverlay is rendered here so it can use useNavigation.
 */
function PassportNavigatorContent() {
  return (
    <View style={styles.container}>
      <Stack.Navigator
        screenOptions={{
          ...SlideWithScalePreset,
        }}
      >
        <Stack.Screen name="PassportHome" component={PassportScreen} />
        <Stack.Screen
          name="CountryDetail"
          component={CountryDetailScreen}
          options={{
            ...SharedCountryPreset,
          }}
        />
        <Stack.Screen name="ProfileSettings" component={ProfileSettingsScreen} />
        <Stack.Screen name="Trips" component={TripsNavigator} />
        <Stack.Screen
          name="ShareCapture"
          component={ShareCaptureScreen}
          options={{
            ...Transition.Presets.SlideFromBottom(),
            gestureEnabled: true,
            gestureDirection: 'vertical',
          }}
        />
      </Stack.Navigator>
      <ClipboardBannerOverlay />
    </View>
  );
}

export function PassportNavigator() {
  return <PassportNavigatorContent />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
