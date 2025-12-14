import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { PhoneAuthScreen } from '@screens/auth/PhoneAuthScreen';
// LAUNCH_SIMPLIFICATION: WelcomeScreen skipped - users go directly to PhoneAuth
// import { WelcomeScreen } from '@screens/auth/WelcomeScreen';

import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
      initialRouteName="PhoneAuth"
    >
      {/* LAUNCH_SIMPLIFICATION: WelcomeScreen skipped for cleaner sign-out flow */}
      {/* <Stack.Screen name="Welcome" component={WelcomeScreen} /> */}
      <Stack.Screen name="PhoneAuth" component={PhoneAuthScreen} />
    </Stack.Navigator>
  );
}
