/**
 * Shared regions constant for continent-based navigation.
 * Used in onboarding flow to iterate through continents.
 */
export const REGIONS = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'] as const;

/**
 * All regions including Antarctica.
 * Used for progress indicators that include the Antarctica prompt.
 */
export const ALL_REGIONS = [...REGIONS, 'Antarctica'] as const;

export type Region = (typeof REGIONS)[number];
export type AllRegion = (typeof ALL_REGIONS)[number];

/**
 * Subregion mappings by continent.
 * Used for granular filtering in the Explore filter sheet.
 */
export const SUBREGIONS: Record<Region, readonly string[]> = {
  Africa: ['North Africa', 'East Africa', 'Southern Africa', 'West & Central Africa'],
  Americas: ['North America', 'Central America', 'Caribbean', 'South America'],
  Asia: ['East & Southeast Asia', 'South Asia', 'Middle East', 'Central Asia'],
  Europe: [
    'Core Europe',
    'Nordics',
    'Southern Europe',
    'Balkans',
    'Eastern Europe',
    'British Isles',
  ],
  Oceania: ['Australia & New Zealand', 'Pacific Islands'],
} as const;

/**
 * Flat list of all subregions for iteration.
 */
export const ALL_SUBREGIONS = Object.values(SUBREGIONS).flat();

export type Subregion = (typeof ALL_SUBREGIONS)[number];

/**
 * Recognition type groupings for simplified filter UI.
 * Groups 7 backend enum values into 3 user-friendly categories.
 */
export const RECOGNITION_GROUPS = {
  'UN Member': ['un_member'] as const,
  'Special Status': ['observer', 'disputed'] as const,
  Territory: ['territory', 'dependent_territory', 'special_region', 'constituent_country'] as const,
} as const;

export type RecognitionGroup = keyof typeof RECOGNITION_GROUPS;

export const RECOGNITION_GROUP_LABELS: RecognitionGroup[] = [
  'UN Member',
  'Special Status',
  'Territory',
];
