import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthScreen } from '@screens/auth';
// LAUNCH_SIMPLIFICATION: WelcomeScreen skipped - users go directly to Auth
// import { WelcomeScreen } from '@screens/auth';

import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
      initialRouteName="Auth"
    >
      {/* LAUNCH_SIMPLIFICATION: WelcomeScreen skipped for cleaner sign-out flow */}
      {/* <Stack.Screen name="Welcome" component={WelcomeScreen} /> */}
      <Stack.Screen name="Auth" component={AuthScreen} />
    </Stack.Navigator>
  );
}
