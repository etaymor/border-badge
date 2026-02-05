export {
  useTrips,
  useTrip,
  useTripsByCountry,
  useCreateTrip,
  useUpdateTrip,
  useDeleteTrip,
  useRestoreTrip,
} from './useTrips';
export type { Trip, TripWithTags, CreateTripInput, UpdateTripInput } from './useTrips';

export { useEntries, useEntry, useCreateEntry, useUpdateEntry, useDeleteEntry } from './useEntries';
export type {
  Entry,
  EntryWithPlace,
  Place,
  PlaceInput,
  CreateEntryInput,
  UpdateEntryInput,
  EntryType,
} from './useEntries';

export {
  useEntryMedia,
  useTripMedia,
  useMedia,
  useUploadMedia,
  useRetryUpload,
  useDeleteMedia,
  validateFile,
  getMediaUrl,
  getThumbnailUrl,
  MAX_FILE_SIZE,
  MAX_PHOTOS_PER_ENTRY,
  ALLOWED_TYPES,
} from './useMedia';
export type { MediaFile, MediaStatus, LocalFile, UploadProgress } from './useMedia';

export { useProfile, useUpdateProfile } from './useProfile';
export type { Profile, UpdateProfileInput } from './useProfile';

export {
  useCountries,
  useCountriesByRegion,
  useSearchCountries,
  useCountryByCode,
  getCountriesByCodes,
  searchCountriesAsync,
} from './useCountries';
export type { Country } from './useCountries';

export { useCountriesSync, forceCountriesSync } from './useCountriesSync';

export {
  useTripLists,
  useList,
  useCreateList,
  useUpdateList,
  useUpdateListEntries,
  useDeleteList,
  getPublicListUrl,
} from './useLists';
export type {
  ListSummary,
  ListDetail,
  ListEntry,
  CreateListInput,
  UpdateListInput,
} from './useLists';

export { useCountrySelectionAnimations } from './useCountrySelectionAnimations';
export type {
  CelebrationAnimationRefs,
  CountrySelectionAnimationRefs,
  UseCountrySelectionAnimationsOptions,
  UseCountrySelectionAnimationsReturn,
} from './useCountrySelectionAnimations';

export { useResponsive } from './useResponsive';
export type { ScreenSize, ResponsiveValues } from './useResponsive';

export { useAnimatedPress, AnimatedPressPresets } from './useAnimatedPress';
export type { UseAnimatedPressOptions, UseAnimatedPressResult } from './useAnimatedPress';

export { useBreathingAnimation, BreathingPresets } from './useBreathingAnimation';
export type {
  UseBreathingAnimationOptions,
  UseBreathingAnimationResult,
} from './useBreathingAnimation';

export { useStaggeredEntrance, StaggeredEntrancePresets } from './useStaggeredEntrance';
export type {
  UseStaggeredEntranceOptions,
  UseStaggeredEntranceResult,
} from './useStaggeredEntrance';

export { useReducedMotion } from './useReducedMotion';

export { useScreenEntrance } from './useScreenEntrance';
export type { UseScreenEntranceOptions, UseScreenEntranceResult } from './useScreenEntrance';

export { useSuggestPlaces } from './usePhotoImport';

export { useClusterPhotoUpload } from './useClusterPhotoUpload';
export type { ClusterUploadState, UploadPhotosResult } from './useClusterPhotoUpload';

export { useCountryPhotoInfo } from './useCountryPhotoInfo';
export type { CountryPhotoInfo } from './useCountryPhotoInfo';

export { useAuthSession } from './useAuthSession';
export { useShareExtensionHandler } from './useShareExtensionHandler';
export { useNavigationPersistence } from './useNavigationPersistence';
export { useAppStateTracking } from './useAppStateTracking';
