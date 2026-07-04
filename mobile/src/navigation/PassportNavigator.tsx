import { createBlankStackNavigator } from 'react-native-screen-transitions/blank-stack';
import Transition from 'react-native-screen-transitions';
import { View, StyleSheet } from 'react-native';

import { ClipboardBannerOverlay } from '@components/share';
import { CountryDetailScreen } from '@screens/country/CountryDetailScreen';
import { PassportScreen } from '@screens/passport/PassportScreen';
import { PhotoImportScreen } from '@screens/photos/PhotoImportScreen';
import { PhotoTripsScreen } from '@screens/photos/PhotoTripsScreen';
import { ProfileSettingsScreen } from '@screens/profile/ProfileSettingsScreen';
import { ShareCaptureScreen } from '@screens/share/ShareCaptureScreen';
import { ShareCaptureErrorBoundary } from '@screens/share/ShareCaptureErrorBoundary';
import { TripFormScreen } from '@screens/trips/TripFormScreen';
// LAUNCH_SIMPLIFICATION: Trips flow is nested here while tab bar is hidden.
import { TripsNavigator } from './TripsNavigator';
import { SlideWithScalePreset, SharedCountryPreset } from './interpolators';

import type { PassportStackParamList, PassportStackScreenProps } from './types';

const Stack = createBlankStackNavigator<PassportStackParamList>();

function ShareCaptureWithBoundary(props: PassportStackScreenProps<'ShareCapture'>) {
  const { url, source } = props.route.params;
  return (
    <ShareCaptureErrorBoundary url={url} source={source} onError={() => props.navigation.goBack()}>
      <ShareCaptureScreen {...props} />
    </ShareCaptureErrorBoundary>
  );
}

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
          // PassportHome renders the heavy passport grid (~200 image cards).
          // Freeze + detach it when CountryDetail / ShareCapture / PhotoImport /
          // PhotoTrips / Trips is pushed on top: detachPreviousScreen caps the
          // active-screens window so the buried grid reaches activityState 0 and
          // react-freeze suspends its re-renders. It stays mounted (not unmounted),
          // so back-navigation restores it. Same mechanism proven for the
          // OnboardingNavigator (U2). Requires enableFreeze() at app root (App.tsx).
          freezeOnBlur: true,
          detachPreviousScreen: true,
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
        <Stack.Screen name="TripForm" component={TripFormScreen} />
        <Stack.Screen name="Trips" component={TripsNavigator} />
        <Stack.Screen
          name="ShareCapture"
          component={ShareCaptureWithBoundary}
          options={{
            ...Transition.Presets.SlideFromBottom(),
            gestureEnabled: true,
            gestureDirection: 'vertical',
          }}
        />
        <Stack.Screen
          name="PhotoTrips"
          component={PhotoTripsScreen}
          options={{
            ...Transition.Presets.SlideFromBottom(),
            gestureEnabled: true,
            gestureDirection: 'vertical',
          }}
        />
        <Stack.Screen
          name="PhotoImport"
          component={PhotoImportScreen}
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
