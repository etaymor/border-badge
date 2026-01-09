import { createBlankStackNavigator } from 'react-native-screen-transitions/blank-stack';

import { AuthScreen } from '@screens/auth';
// LAUNCH_SIMPLIFICATION: WelcomeScreen skipped - users go directly to Auth
// import { WelcomeScreen } from '@screens/auth';
import { SlideWithScalePreset } from './interpolators';

import type { AuthStackParamList } from './types';

const Stack = createBlankStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        ...SlideWithScalePreset,
      }}
      initialRouteName="Login"
    >
      {/* LAUNCH_SIMPLIFICATION: WelcomeScreen skipped for cleaner sign-out flow */}
      {/* <Stack.Screen name="Welcome" component={WelcomeScreen} /> */}
      <Stack.Screen name="Login" component={AuthScreen} />
    </Stack.Navigator>
  );
}
