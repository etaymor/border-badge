/* eslint-disable @typescript-eslint/no-require-imports -- Metro static asset sources */

import type { ImageSourcePropType } from 'react-native';

import { demoPhoto } from '@screens/quiz/sampleAssets';

/**
 * Stills for the intro beats. The photos are the ones already bundled for the
 * photo-permission carousel and Guess Where; the only new files are three small
 * logos in `assets/onboarding-intro/` (the Atlasi app icon, Instagram, TikTok).
 */

const photo = {
  torii: require('../../../../assets/photo-permission-photos/JP-01.webp'),
  yokocho: require('../../../../assets/photo-permission-photos/JP-02.webp'),
  food: require('../../../../assets/photo-permission-photos/travel-07.webp'),
  lake: require('../../../../assets/photo-permission-photos/travel-06.webp'),
  matcha: require('../../../../assets/photo-permission-photos/travel-08.webp'),
  sea: require('../../../../assets/photo-permission-photos/HR-02.webp'),
  canal: require('../../../../assets/photo-permission-photos/IT-01.webp'),
  cat: require('../../../../assets/photo-permission-photos/other-03.webp'),
  spices: require('../../../../assets/photo-permission-photos/travel-05.webp'),
  aerial: require('../../../../assets/photo-permission-photos/other-04.webp'),
  bougainvillea: require('../../../../assets/photo-permission-photos/MX-01.webp'),
  baroque: require('../../../../assets/photo-permission-photos/travel-01.webp'),
} satisfies Record<string, ImageSourcePropType>;

export interface CameraRollTile {
  source: ImageSourcePropType;
  /** From the Japan trip: gets a check as the scan finds it. */
  trip: boolean;
  /** The one photo whose forgotten place gets named. */
  focus?: boolean;
}

/** Beat 1 camera roll, in reading order (3 columns). A Japan trip among everyday photos. */
export const CAMERA_ROLL_TILES: readonly CameraRollTile[] = [
  { source: photo.torii, trip: true },
  { source: photo.sea, trip: false },
  { source: photo.food, trip: true },
  { source: photo.cat, trip: false },
  { source: photo.yokocho, trip: true, focus: true },
  { source: photo.canal, trip: false },
  { source: photo.lake, trip: true },
  { source: photo.spices, trip: false },
  { source: photo.aerial, trip: false },
  { source: photo.bougainvillea, trip: false },
  { source: photo.matcha, trip: true },
  { source: photo.baroque, trip: false },
];

export const FOCUS_PLACE = { name: 'Shibuya Yokocho', category: 'Food' } as const;

export type IntroPlaceCategory = 'Food' | 'Place' | 'Experience' | 'Stay';

export interface TripPlace {
  name: string;
  category: IntroPlaceCategory;
  thumb: ImageSourcePropType;
}

/** The rebuilt trip, as it appears on the card. */
export const TRIP_CARD = {
  country: 'Japan',
  meta: 'Apr 3 – 12 · 186 photos',
  cover: [photo.torii, photo.lake, photo.food] as const,
  places: [
    { name: FOCUS_PLACE.name, category: FOCUS_PLACE.category, thumb: photo.yokocho },
    { name: 'Meiji Jingu', category: 'Place', thumb: photo.torii },
    { name: 'Lake Ashi', category: 'Experience', thumb: photo.lake },
  ] as readonly TripPlace[],
  shareLabel: 'Share my Japan favorites',
};

/** Beat 2 post (Bøur, Faroe Islands) and the real logos in the share flow. */
export const SOCIAL_POST_PHOTO: ImageSourcePropType = require('../../../../assets/photo-permission-photos/hero.webp');
export const SOCIAL_BACK_POST_PHOTO: ImageSourcePropType = photo.sea;
export const SOCIAL_POST_PLACE = 'Bøur';
export const SOCIAL_POST_REGION = 'Faroe Islands';
export const SOCIAL_SAVED_TRIP = 'Faroe Islands trip';
export const ATLASI_APP_ICON: ImageSourcePropType = require('../../../../assets/onboarding-intro/atlasi-app-icon.webp');
export const INSTAGRAM_LOGO: ImageSourcePropType = require('../../../../assets/onboarding-intro/instagram-logo.webp');
export const TIKTOK_LOGO: ImageSourcePropType = require('../../../../assets/onboarding-intro/tiktok-logo.webp');

/** Beat 3 passport page, in pop order. */
export const PASSPORT_CODES = ['JP', 'IT', 'MX', 'HR', 'PT', 'MA', 'PE', 'FR', 'TH'] as const;

/** Beat 4 quiz card. Fixed option order so the reveal is deterministic. */
export const GUESS_PHOTO: ImageSourcePropType = demoPhoto;
export const GUESS_OPTIONS = ['Greece', 'Jordan', 'Morocco', 'Türkiye'] as const;
export const GUESS_DECOY_INDEX = 2;
export const GUESS_CORRECT_INDEX = 3;
