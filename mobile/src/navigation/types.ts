import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

// Root stack contains auth, onboarding, and main tab navigator
export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
};

// Auth stack screens
export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
};

// Onboarding stack screens
export type OnboardingStackParamList = {
  WelcomeCarousel: undefined;
  Motivation: undefined;
  HomeCountry: undefined;
  DreamDestination: undefined;
  ContinentIntro: { region: string; regionIndex: number };
  ContinentCountryGrid: { region: string };
  ProgressSummary: undefined;
  Paywall: undefined;
  AccountCreation: undefined;
  // Auth screens accessible from onboarding
  Login: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
};

// Main bottom tab navigator
export type MainTabParamList = {
  Passport: NavigatorScreenParams<PassportStackParamList>;
  Dreams: NavigatorScreenParams<DreamsStackParamList>;
  Trips: NavigatorScreenParams<TripsStackParamList>;
  Profile: undefined;
};

// Dreams stack (nested in tab)
export type DreamsStackParamList = {
  DreamsHome: undefined;
  CountryDetail: { countryId: string; countryName?: string; countryCode?: string };
};

// Passport stack (nested in tab)
export type PassportStackParamList = {
  PassportHome: undefined;
  CountryDetail: { countryId: string; countryName?: string; countryCode?: string };
};

// Entry type for navigation
export type EntryType = 'place' | 'food' | 'stay' | 'experience';

// Trips stack (nested in tab)
export type TripsStackParamList = {
  TripsList: undefined;
  TripDetail: { tripId: string };
  TripForm: { tripId?: string; countryId?: string; countryName?: string }; // undefined tripId = create, string = edit
  EntryList: { tripId: string; tripName?: string };
  EntryDetail: { entryId: string };
  EntryForm: { tripId: string; entryId?: string; entryType?: EntryType };
  ListCreate: { tripId: string; tripName?: string };
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

export type OnboardingStackScreenProps<T extends keyof OnboardingStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<OnboardingStackParamList, T>,
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

export type PassportStackScreenProps<T extends keyof PassportStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<PassportStackParamList, T>,
  MainTabScreenProps<keyof MainTabParamList>
>;

export type DreamsStackScreenProps<T extends keyof DreamsStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<DreamsStackParamList, T>,
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
