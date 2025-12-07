import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { PhoneAuthScreen } from '@screens/auth/PhoneAuthScreen';
import { WelcomeScreen } from '@screens/auth/WelcomeScreen';

import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="PhoneAuth" component={PhoneAuthScreen} />
    </Stack.Navigator>
  );
}
