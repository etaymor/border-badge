/**
 * Screens where both the bottom tab bar and the persistent scan banner hide.
 * MainTabNavigator owns tab-bar visibility; PersistentScanBanner mirrors it.
 * Single source of truth lives here.
 */
export const HIDDEN_TAB_BAR_SCREENS = [
  'TripForm',
  'ListCreate',
  'ListEdit',
  'EntryForm',
  'PhotoTrips',
  'PhotoImport',
  'ShareCapture',
] as const;

export type HiddenTabBarScreen = (typeof HIDDEN_TAB_BAR_SCREENS)[number];
