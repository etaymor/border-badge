import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

// Root stack contains auth, onboarding, and main tab navigator
export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Onboarding: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
};

// Auth stack screens
export type AuthStackParamList = {
  Login: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
};

// Main bottom tab navigator
export type MainTabParamList = {
  Map: undefined;
  Trips: NavigatorScreenParams<TripsStackParamList>;
  Profile: undefined;
};

// Trips stack (nested in tab)
export type TripsStackParamList = {
  TripsList: undefined;
  TripDetail: { tripId: string };
  TripForm: { tripId?: string }; // undefined = create, string = edit
};

// Screen props helpers
export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

export type AuthStackScreenProps<T extends keyof AuthStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<AuthStackParamList, T>,
  RootStackScreenProps<keyof RootStackParamList>
>;

export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  RootStackScreenProps<keyof RootStackParamList>
>;

export type TripsStackScreenProps<T extends keyof TripsStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<TripsStackParamList, T>,
  MainTabScreenProps<keyof MainTabParamList>
>;

// Declare global type augmentation for useNavigation
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
