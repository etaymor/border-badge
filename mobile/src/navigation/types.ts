import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { EntryType } from '../types/shared';

export type { EntryType };

// Gated feature types for paywall modal
export type GatedFeature = 'shareExtension' | 'photoImport' | 'entries';

// Root stack contains auth, onboarding, and main tab navigator
export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
  PaywallModal: { feature?: GatedFeature };
  QuizCreation: undefined;
  QuizPlay: { quizId: string };
  QuizResults: {
    quizId: string;
    /** Owner completion payload (backend QuizCompleteResponse). The memory
     * score exists only here - it is never stored nor served publicly. */
    results: {
      correct: number;
      total: number;
      memory_correct: number;
      memory_total: number;
      score_to_beat: { correct: number; total: number };
      state: string;
    };
  };
};

// Auth stack screens
export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
};

// Onboarding stack screens
export type OnboardingStackParamList = {
  WelcomeCarousel: undefined;
  OnboardingSlider: undefined;
  Motivation: undefined;
  HomeCountry: undefined;
  TrackingPreference: undefined;
  DreamDestination: undefined;
  ContinentIntro: { region: string; regionIndex: number };
  ContinentCountryGrid: { region: string };
  AntarcticaPrompt: undefined;
  ProgressSummary: undefined;
  NameEntry: undefined;
  EmotionalHook: undefined;
  FunctionalHook: undefined;
  Paywall: undefined;
  AccountCreation: undefined;
};

// Main bottom tab navigator
export type MainTabParamList = {
  Passport: NavigatorScreenParams<PassportStackParamList>;
  Dreams: NavigatorScreenParams<DreamsStackParamList>;
  Trips: NavigatorScreenParams<TripsStackParamList>;
  Friends: undefined;
};

// Dreams stack (nested in tab)
export type DreamsStackParamList = {
  DreamsHome: undefined;
  CountryDetail: { countryId: string; countryName?: string; countryCode?: string };
  TripForm: {
    tripId?: string;
    countryId?: string;
    countryName?: string;
    prefillPlace?: PrefillPlace;
    prefillPhotos?: string[];
  };
};

// Share capture source types
export type ShareCaptureSource = 'clipboard' | 'share_extension' | 'deep_link';

// Passport stack (nested in tab)
export type PassportStackParamList = {
  PassportHome: undefined;
  CountryDetail: { countryId: string; countryName?: string; countryCode?: string };
  ProfileSettings: undefined;
  Trips: NavigatorScreenParams<TripsStackParamList>;
  TripForm: {
    tripId?: string;
    countryId?: string;
    countryName?: string;
    prefillPlace?: PrefillPlace;
    prefillPhotos?: string[];
  };
  ShareCapture: { url: string; caption?: string; source?: ShareCaptureSource };
  PhotoTrips: { countryCode?: string };
  PhotoImport: PhotoImportParams;
};

// Prefill place data for TripForm (from photo import)
export type PrefillPlace = {
  placeId: string;
  name: string;
  address: string;
  category: EntryType;
};

// Photo import params (shared between navigators)
export type PhotoImportParams = {
  countryCode?: string;
  tripId?: string; // Pre-associate with existing trip
  autoStart?: boolean; // Auto-start scan when cache exists
  skipToSuggestions?: boolean; // Skip scanning and go directly to candidates when cache exists
};

// Trips stack (nested in tab)
export type TripsStackParamList = {
  TripsList: undefined;
  TripDetail: {
    tripId: string;
    prefillPlace?: PrefillPlace; // Pre-filled place from photo import
    prefillPhotos?: string[]; // Photo URIs from photo import
  };
  PhotoTrips: { countryCode?: string };
  PhotoImport: PhotoImportParams;
  TripForm: {
    tripId?: string;
    countryId?: string;
    countryName?: string;
    prefillPlace?: PrefillPlace; // Pre-filled place from photo import
    prefillPhotos?: string[]; // Photo URIs from photo import
  }; // undefined tripId = create, string = edit
  EntryList: { tripId: string; tripName?: string };
  EntryDetail: { entryId: string };
  EntryForm: {
    tripId: string;
    entryId?: string;
    entryType?: EntryType;
    prefillPlace?: PrefillPlace; // Pre-filled place from photo import
    prefillPhotos?: string[]; // Photo URIs from photo import
  };
  TripLists: { tripId: string; tripName?: string };
  ListCreate: { tripId: string; tripName?: string };
  ListEdit: { listId: string; tripId: string; tripName?: string };
  SavedPlaces: undefined; // Uncategorized entries holding area
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
