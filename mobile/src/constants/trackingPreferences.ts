/**
 * Country tracking preference presets.
 * Defines which country recognition types are included in each tracking tier.
 */

export const TRACKING_PRESETS = {
  classic: {
    id: 'classic' as const,
    name: 'Classic Traveler',
    count: 194,
    recognitionTypes: ['un_member', 'territory'] as const, // territory = Antarctica
    description: 'The standard for most travelers.',
    shortDescription: '193 UN Member States + Antarctica',
    examples: 'United States, France, Japan, Brazil, Kenya',
    bestFor: 'Traditional passport collectors who want the globally recognized count.',
  },
  un_complete: {
    id: 'un_complete' as const,
    name: 'UN Complete',
    count: 196,
    recognitionTypes: ['un_member', 'territory', 'observer'] as const,
    description: 'Adds the two UN Observer States.',
    shortDescription: '+ Vatican City, Palestine',
    examples: 'Vatican City, Palestine',
    bestFor: 'Travelers who want to include all UN-recognized entities.',
  },
  explorer_plus: {
    id: 'explorer_plus' as const,
    name: 'Explorer Plus',
    count: 199,
    recognitionTypes: ['un_member', 'territory', 'observer', 'disputed'] as const,
    description: 'Adds disputed territories.',
    shortDescription: '+ Taiwan, Kosovo, Northern Cyprus',
    examples: 'Taiwan, Kosovo, Northern Cyprus',
    bestFor: 'Travelers who recognize places with distinct cultures, governments, and experiences.',
  },
  full_atlas: {
    id: 'full_atlas' as const,
    name: 'The Full Atlas',
    count: 227,
    recognitionTypes: [
      'un_member',
      'territory',
      'observer',
      'disputed',
      'dependent_territory',
      'special_region',
      'constituent_country',
    ] as const,
    description: 'For those who want to track it all.',
    shortDescription: '+ All territories & dependencies',
    examples: 'Puerto Rico, Hong Kong, Scotland, Greenland',
    bestFor:
      'Completionists and travelers who appreciate that a trip to Scotland feels different from England.',
  },
} as const;

export type TrackingPreset = keyof typeof TRACKING_PRESETS;

export type RecognitionType =
  | 'un_member'
  | 'territory'
  | 'observer'
  | 'disputed'
  | 'dependent_territory'
  | 'special_region'
  | 'constituent_country';

/**
 * Ordered list of tracking presets for display in UI.
 */
export const TRACKING_PRESET_ORDER: TrackingPreset[] = [
  'classic',
  'un_complete',
  'explorer_plus',
  'full_atlas',
];

/**
 * Get the recognition types allowed for a given tracking preference.
 */
export function getAllowedRecognitionTypes(preset: TrackingPreset): readonly RecognitionType[] {
  return TRACKING_PRESETS[preset].recognitionTypes;
}

/**
 * Check if a country's recognition type is allowed by the given preference.
 */
export function isCountryAllowedByPreference(
  recognition: string | null | undefined,
  preset: TrackingPreset
): boolean {
  if (!recognition) {
    // Countries without recognition type are treated as UN members (legacy data)
    return TRACKING_PRESETS[preset].recognitionTypes.includes('un_member');
  }
  return (TRACKING_PRESETS[preset].recognitionTypes as readonly string[]).includes(recognition);
}

/**
 * Get the total country count for a given tracking preference.
 */
export function getCountryCountForPreference(preset: TrackingPreset): number {
  return TRACKING_PRESETS[preset].count;
}

/**
 * Get recognition groups that are valid for a given tracking preference.
 * This maps from the detailed recognition types to the simplified UI groups.
 */
export function getAllowedRecognitionGroupsForPreference(
  preset: TrackingPreset
): Set<'UN Member' | 'Special Status' | 'Territory'> {
  const allowedTypes = new Set(TRACKING_PRESETS[preset].recognitionTypes);
  const allowedGroups = new Set<'UN Member' | 'Special Status' | 'Territory'>();

  // UN Member group contains: un_member
  if (allowedTypes.has('un_member')) {
    allowedGroups.add('UN Member');
  }

  // Special Status group contains: observer, disputed
  if (allowedTypes.has('observer') || allowedTypes.has('disputed')) {
    allowedGroups.add('Special Status');
  }

  // Territory group contains: territory, dependent_territory, special_region, constituent_country
  if (
    allowedTypes.has('territory') ||
    allowedTypes.has('dependent_territory') ||
    allowedTypes.has('special_region') ||
    allowedTypes.has('constituent_country')
  ) {
    allowedGroups.add('Territory');
  }

  return allowedGroups;
}
