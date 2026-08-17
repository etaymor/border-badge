/**
 * Feed card registry: maps an activity type to how its card is presented.
 *
 * New activity types are additive here — add a registry entry and FeedCard
 * renders it with no internal changes. Unknown types are default-skipped
 * (FeedCard renders nothing): this is the standing wire-compat rule, since
 * the server may ship activity types older app builds do not know about.
 */

import type { Ionicons } from '@expo/vector-icons';

import { colors } from '@constants/colors';
import type { FeedItem } from '@hooks/useSocialHome';
import { getFlagEmoji } from '@utils/flags';

type IoniconName = keyof typeof Ionicons.glyphMap;

export interface FeedItemTypeConfig {
  /** Badge/placeholder icon. */
  getIcon: (item: FeedItem) => IoniconName;
  /** Accent color for the badge and placeholder. */
  getColor: (item: FeedItem) => string;
  /** Short label shown in the badge overlay. */
  getBadgeLabel: (item: FeedItem) => string;
  /** Verb phrase between the username and the highlight. */
  getVerb: (item: FeedItem) => string;
  /** Bolded subject of the caption; null renders no highlight. */
  getHighlight: (item: FeedItem) => string | null;
  /** Optional trailing caption text (e.g. a country flag). */
  getSuffix?: (item: FeedItem) => string | null;
  /**
   * True when the card's main media is a bundled country illustration
   * (bottom-aligned crop) rather than an entry photo.
   */
  isIllustration?: boolean;
}

const ENTRY_ICONS: Record<string, IoniconName> = {
  food: 'restaurant',
  place: 'location',
  stay: 'bed',
  experience: 'star',
};

const ENTRY_COLORS: Record<string, string> = {
  food: colors.sunsetGold,
  place: colors.primary,
  stay: '#5856D6',
  experience: colors.mossGreen,
};

const ENTRY_VERBS: Record<string, string> = {
  food: 'discovered',
  place: 'explored',
  stay: 'stayed at',
  experience: 'experienced',
};

export const feedItemConfig: Record<string, FeedItemTypeConfig> = {
  country_visited: {
    getIcon: () => 'flag',
    getColor: () => colors.adobeBrick,
    getBadgeLabel: () => 'Travel',
    getVerb: () => 'planted a flag in',
    getHighlight: (item) => item.country?.country_name ?? null,
    getSuffix: (item) => (item.country ? getFlagEmoji(item.country.country_code) : null),
    isIllustration: true,
  },
  entry_added: {
    getIcon: (item) => ENTRY_ICONS[item.entry?.entry_type ?? ''] ?? 'bookmark',
    getColor: (item) => ENTRY_COLORS[item.entry?.entry_type ?? ''] ?? colors.stormGray,
    getBadgeLabel: (item) => item.entry?.entry_type ?? 'Update',
    getVerb: (item) => ENTRY_VERBS[item.entry?.entry_type ?? ''] ?? 'added',
    getHighlight: (item) => item.entry?.entry_name ?? null,
  },
  trip_updated: {
    getIcon: () => 'map',
    getColor: () => colors.lakeBlue,
    getBadgeLabel: () => 'Trip',
    getVerb: (item) => (item.country ? 'updated their trip in' : 'updated their trip'),
    getHighlight: (item) => item.country?.country_name ?? null,
  },
};

/**
 * Resolve the presentation config for a feed item. Returns undefined for
 * unknown activity types — callers must skip rendering in that case.
 */
export function getFeedItemConfig(item: FeedItem): FeedItemTypeConfig | undefined {
  return feedItemConfig[item.activity_type];
}

/**
 * Stable key for feed lists: the server-issued activity id, independent of
 * list index, so prepending fresh items on refresh never remounts existing
 * cards. Falls back to type+timestamp for cached pages persisted before
 * activity_id existed.
 */
export function feedKeyExtractor(item: FeedItem): string {
  return item.activity_id ?? `${item.activity_type}-${item.created_at}`;
}
