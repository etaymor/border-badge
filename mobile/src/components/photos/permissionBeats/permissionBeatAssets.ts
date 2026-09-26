/* eslint-disable @typescript-eslint/no-require-imports -- Metro static asset sources */

import type { ImageSourcePropType } from 'react-native';

export const PERMISSION_BEAT_DEMO_COUNTRIES = [
  { code: 'HR', name: 'Croatia' },
  { code: 'JP', name: 'Japan' },
  { code: 'MX', name: 'Mexico' },
  { code: 'IT', name: 'Italy' },
] as const;

export interface PermissionBeatAssets {
  beat1?: readonly (ImageSourcePropType | undefined)[];
  beat2?: ImageSourcePropType;
  beat3?: Readonly<Record<string, readonly (ImageSourcePropType | undefined)[] | undefined>>;
}

/**
 * Operator stills under `mobile/assets/photo-permission-photos/`.
 * Beat 1 interleaves travel (checked) and other (unchecked) to match
 * `TRAVEL_TILE_INDEXES` in `TripsFoundBeat`.
 */
export const DEFAULT_PERMISSION_BEAT_ASSETS: PermissionBeatAssets = {
  beat1: [
    require('../../../../assets/photo-permission-photos/travel-01.webp'),
    require('../../../../assets/photo-permission-photos/travel-02.webp'),
    require('../../../../assets/photo-permission-photos/other-01.webp'),
    require('../../../../assets/photo-permission-photos/travel-03.webp'),
    require('../../../../assets/photo-permission-photos/travel-04.webp'),
    require('../../../../assets/photo-permission-photos/other-02.webp'),
    require('../../../../assets/photo-permission-photos/travel-05.webp'),
    require('../../../../assets/photo-permission-photos/travel-06.webp'),
    require('../../../../assets/photo-permission-photos/other-03.webp'),
    require('../../../../assets/photo-permission-photos/travel-07.webp'),
    require('../../../../assets/photo-permission-photos/travel-08.webp'),
    require('../../../../assets/photo-permission-photos/other-04.webp'),
  ],
  beat2: require('../../../../assets/photo-permission-photos/hero.webp'),
  beat3: {
    HR: [
      require('../../../../assets/photo-permission-photos/HR-01.webp'),
      require('../../../../assets/photo-permission-photos/HR-02.webp'),
    ],
    JP: [
      require('../../../../assets/photo-permission-photos/JP-01.webp'),
      require('../../../../assets/photo-permission-photos/JP-02.webp'),
    ],
    MX: [
      require('../../../../assets/photo-permission-photos/MX-01.webp'),
      require('../../../../assets/photo-permission-photos/MX-02.webp'),
    ],
    IT: [
      require('../../../../assets/photo-permission-photos/IT-01.webp'),
      require('../../../../assets/photo-permission-photos/IT-02.webp'),
    ],
  },
};
