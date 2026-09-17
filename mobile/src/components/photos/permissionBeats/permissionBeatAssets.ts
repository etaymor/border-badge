import type { ImageSourcePropType } from 'react-native';

export const PERMISSION_BEAT_DEMO_COUNTRIES = [
  { code: 'PT', name: 'Portugal' },
  { code: 'JP', name: 'Japan' },
  { code: 'MX', name: 'Mexico' },
  { code: 'IT', name: 'Italy' },
] as const;

export interface PermissionBeatAssets {
  beat1?: readonly (ImageSourcePropType | undefined)[];
  beat2?: ImageSourcePropType;
  beat3?: Readonly<Record<string, readonly (ImageSourcePropType | undefined)[] | undefined>>;
}

export const DEFAULT_PERMISSION_BEAT_ASSETS: PermissionBeatAssets = {};
