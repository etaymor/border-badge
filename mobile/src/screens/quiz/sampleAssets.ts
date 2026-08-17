/**
 * Bundled sample assets for the Guess Where surfaces (intro screen, demo, empty states).
 *
 * Everything exported here ships inside the app bundle and is visible to every user —
 * treat all of it as public content. Per the design constraints, the trophy illustration
 * (`resultsAccent`) is sanctioned for SMALL ACCENT use only: never a trophy hero on game
 * surfaces.
 *
 * Later units import from this module instead of scattering `require()` calls.
 */
/* eslint-disable @typescript-eslint/no-require-imports */

import { ImageSourcePropType } from 'react-native';

/** Full-bleed looping background video for the intro screen (1080x1920, ~14.5s montage). */
export const introVideo: number = require('../../../assets/GeoGuesser-Onboarding-Background.mp4');

/** Static still (turquoise mountain lake) used as the Reduce Motion / video-poster fallback. */
export const introPoster: ImageSourcePropType = require('../../../assets/guess-where-samples/intro-poster.jpg');

/** Real travel photo for the intro's one-tap demo: hot-air balloons over Cappadocia at sunrise. */
export const demoPhoto: ImageSourcePropType = require('../../../assets/guess-where-samples/demo-cappadocia.jpg');

/** The country the demo photo was taken in. */
export const demoCountry = 'Türkiye';

/**
 * The demo's four country options (correct answer included, order not meaningful —
 * the demo screen owns placement/shuffling).
 */
export const demoOptions: readonly string[] = ['Greece', 'Jordan', 'Morocco', 'Türkiye'];

/** The Guess Where mark (compass with a question mark), e.g. for the My Challenges empty state. */
export const guessWhereMark: ImageSourcePropType = require('../../../assets/illustations/geoguesser-mark-compass.png');

/** Trophy illustration — small-accent use only; never a hero on game surfaces. */
export const resultsAccent: ImageSourcePropType = require('../../../assets/illustations/geoguesser-results.png');
