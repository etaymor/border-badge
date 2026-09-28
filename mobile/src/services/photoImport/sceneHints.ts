/**
 * On-device scene hints for place matching (venue-rollup plan U9, KTD6, R9).
 *
 * The photo tagger already stores Apple Vision's scene-classification labels
 * in `photo_ml_tags.labels_json`. This module reads them per cluster and sends
 * the matcher a few normalized hints, for free (no network, no pixels):
 *
 * - `museum_interior` / `artwork` trigger the backend's venue probe, so a
 *   Louvre-interior cluster finds the museum even when every local candidate
 *   is a cafe or a shop;
 * - `food` is the evidence that lets a cafe or restaurant keep first place
 *   instead of being rolled up into the landmark it sits beside;
 * - `outdoor_landmark` is informational today.
 *
 * It also sends `sign_text` (U10): up to 5 short strings the tagger's
 * on-device text recognition read from the cluster's photos, which the matcher
 * treats like a vision-detected business name. Rows from a binary without text
 * recognition carry no text, so older builds simply send no `sign_text`.
 *
 * Same rule as `services/quiz/tagSignals.ts`: Swift returns raw signals, and
 * every mapping and threshold lives here so it retunes over the air.
 *
 * Every identifier below was checked against the real classifier taxonomy
 * (`VNClassifyImageRequest.supportedIdentifiers()`, 1,303 labels). Several
 * plausible names are NOT in it -- "sculpture", "gallery", "church",
 * "cathedral", "palace", "meal" -- so they cannot appear here.
 */

import { getTagsForIds, type PhotoMlTag } from './photoTagDb';
import type { LocationCluster } from './types';

/** The hint vocabulary the backend accepts (`SCENE_HINT_LABELS`). */
export type SceneHintLabel = 'museum_interior' | 'artwork' | 'food' | 'outdoor_landmark';

/** One per-cluster hint. `weight` is the share of tagged photos carrying it. */
export interface SceneHint {
  label: SceneHintLabel;
  weight: number;
}

/**
 * Apple Vision identifiers per hint. Each identifier maps to one hint only.
 *
 * Deliberately left out: `interior_room` and `chandelier` (hotels and
 * restaurants have them too), `graffiti` (street art is not a museum), `frame`
 * and `vase` (too generic), `fruit` / `vegetable` (market stalls, not a meal),
 * `structure` and `building` (every street).
 */
export const SCENE_HINT_IDENTIFIERS: Readonly<Record<SceneHintLabel, readonly string[]>> = {
  museum_interior: ['museum', 'dinosaur'],
  artwork: ['painting', 'art', 'statue', 'stained_glass', 'illustrations'],
  food: [
    'food',
    'restaurant',
    'dessert',
    'baked_goods',
    'bread',
    'pastry',
    'croissant',
    'cake',
    'cupcake',
    'cookie',
    'pie',
    'donut',
    'muffin',
    'bagel',
    'crepe',
    'pancake',
    'waffle',
    'ice_cream',
    'chocolate',
    'pizza',
    'pasta',
    'salad',
    'sandwich',
    'hamburger',
    'hotdog',
    'fries',
    'seafood',
    'shellfish',
    'oyster',
    'lobster',
    'crab',
    'sushi',
    'ramen',
    'dumpling',
    'curry',
    'rice',
    'soup',
    'steak',
    'meat',
    'cheese',
    'fondue',
    'antipasti',
    'tapas',
    'taco',
    'burrito',
    'nachos',
    'kebab',
    'plate',
    'drink',
    'coffee',
    'tea_drink',
    'cocktail',
    'wine',
    'beer',
    'liquor',
    'juice',
    'smoothie',
    'milkshake',
  ],
  outdoor_landmark: [
    'monument',
    'tower',
    'belltower',
    'clock_tower',
    'castle',
    'ruins',
    'obelisk',
    'pyramid',
    'arch',
    'dome',
    'fountain',
    'lighthouse',
    'windmill',
    'bridge',
  ],
};

/**
 * A label counts for a photo at or above this confidence. The tagger stores
 * the top 10 labels down to 0.05; Vision's hierarchical taxonomy gives broad
 * parents ("art", "food") high scores on real subjects, so 0.3 keeps the
 * incidental background labels out.
 */
export const SCENE_HINT_LABEL_FLOOR = 0.3;

/**
 * Minimum share of the cluster's tagged photos that must carry a hint. `food`
 * is stricter because it is a veto (it keeps a cafe first over a major
 * landmark); the museum hints only trigger a cheap, shared lookup whose result
 * still has to pass every roll-up test on the server.
 */
export const SCENE_HINT_MIN_SHARE: Readonly<Record<SceneHintLabel, number>> = {
  museum_interior: 0.3,
  artwork: 0.3,
  food: 0.4,
  outdoor_landmark: 0.3,
};

const HINT_BY_IDENTIFIER: ReadonlyMap<string, SceneHintLabel> = new Map(
  (Object.entries(SCENE_HINT_IDENTIFIERS) as Array<[SceneHintLabel, readonly string[]]>).flatMap(
    ([hint, identifiers]) => identifiers.map((identifier) => [identifier, hint] as const)
  )
);

/** Most sign strings sent per cluster (backend `MAX_SIGN_TEXT_PER_CLUSTER`). */
export const SIGN_TEXT_MAX_STRINGS = 5;

/** Per-string character cap; the backend rejects above 64. */
export const SIGN_TEXT_MAX_CHARS = 40;

/**
 * Minimum recognition confidence for a line. Fast-level recognition reports
 * coarse confidences (typically 0.3 / 0.5 / 1.0); 0.5 drops the guesses.
 */
export const SIGN_TEXT_MIN_CONFIDENCE = 0.5;

/** A line needs this many letters: drops prices, times, and lone initials. */
const SIGN_TEXT_MIN_LETTERS = 3;

/** Per-cluster on-device signals sent with a suggestion request. */
export interface ClusterSceneSignals {
  hints: SceneHint[];
  signText: string[];
}

/** Letters in cased scripts: fast recognition reads Latin-script languages only. */
function letterCount(text: string): number {
  let count = 0;
  for (const ch of text) if (ch.toLowerCase() !== ch.toUpperCase()) count += 1;
  return count;
}

function normalizeSignLine(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const capped = collapsed.slice(0, SIGN_TEXT_MAX_CHARS).trim();
  return letterCount(capped) >= SIGN_TEXT_MIN_LETTERS ? capped : null;
}

/**
 * Derive a cluster's sign strings from its photos' tag rows (U10): trimmed,
 * whitespace-collapsed, length-capped, and deduped case-insensitively. Ranked
 * by how many photos show the string, then by its largest on-frame area (signs
 * are big text), keeping the casing of that largest sighting. At most
 * `SIGN_TEXT_MAX_STRINGS`. A row without measured text contributes nothing.
 */
export function deriveSignText(tags: Iterable<PhotoMlTag | undefined>): string[] {
  const byKey = new Map<string, { text: string; photos: number; area: number; order: number }>();
  for (const tag of tags) {
    if (!tag || tag.status !== 'ok' || !tag.signText) continue;
    const seenInPhoto = new Set<string>();
    for (const line of tag.signText) {
      if (line.confidence < SIGN_TEXT_MIN_CONFIDENCE) continue;
      const text = normalizeSignLine(line.text);
      if (!text) continue;
      const key = text.toLowerCase();
      const entry = byKey.get(key);
      if (!entry) {
        byKey.set(key, { text, photos: 1, area: line.area, order: byKey.size });
      } else {
        if (!seenInPhoto.has(key)) entry.photos += 1;
        if (line.area > entry.area) {
          entry.area = line.area;
          entry.text = text;
        }
      }
      seenInPhoto.add(key);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.photos - a.photos || b.area - a.area || a.order - b.order)
    .slice(0, SIGN_TEXT_MAX_STRINGS)
    .map((entry) => entry.text);
}

/**
 * Derive a cluster's hints from its photos' tag rows (`undefined` = untagged).
 *
 * The denominator is the TAGGED photos only: a photo with no row, or a row
 * without measured labels (`no-local-image`, `error`), is no evidence either
 * way and must not dilute the share. An offloaded photo whose row was measured
 * while it was still local counts like any other. Sorted by weight, highest
 * first; weights rounded to 2 decimals.
 */
export function deriveSceneHints(tags: Iterable<PhotoMlTag | undefined>): SceneHint[] {
  let tagged = 0;
  const counts = new Map<SceneHintLabel, number>();
  for (const tag of tags) {
    if (!tag || tag.status !== 'ok' || tag.labels.length === 0) continue;
    tagged += 1;
    const carried = new Set<SceneHintLabel>();
    for (const label of tag.labels) {
      if (label.confidence < SCENE_HINT_LABEL_FLOOR) continue;
      const hint = HINT_BY_IDENTIFIER.get(label.identifier);
      if (hint) carried.add(hint);
    }
    for (const hint of carried) counts.set(hint, (counts.get(hint) ?? 0) + 1);
  }
  if (tagged === 0) return [];

  const hints: SceneHint[] = [];
  for (const [label, count] of counts) {
    const share = count / tagged;
    if (share >= SCENE_HINT_MIN_SHARE[label]) {
      hints.push({ label, weight: Math.round(share * 100) / 100 });
    }
  }
  return hints.sort((a, b) => b.weight - a.weight);
}

/**
 * Hints and sign text for a batch of clusters, keyed by cluster id; clusters
 * with neither are absent. One tag read covers the whole batch. Best-effort: a
 * read error means no signals (today's behavior), never a failed dispatch.
 */
export async function loadSceneSignalsForClusters(
  clusters: readonly LocationCluster[]
): Promise<Map<string, ClusterSceneSignals>> {
  const result = new Map<string, ClusterSceneSignals>();
  if (clusters.length === 0) return result;
  let tags: Map<string, PhotoMlTag>;
  try {
    tags = await getTagsForIds(clusters.flatMap((c) => c.photos.map((p) => p.id)));
  } catch (error) {
    if (__DEV__) {
      console.warn(
        '[SceneHints] Tag row load failed:',
        error instanceof Error ? error.message : error
      );
    }
    return result;
  }
  for (const cluster of clusters) {
    const clusterTags = cluster.photos.map((p) => tags.get(p.id));
    const hints = deriveSceneHints(clusterTags);
    const signText = deriveSignText(clusterTags);
    if (hints.length > 0 || signText.length > 0) result.set(cluster.id, { hints, signText });
  }
  return result;
}

/**
 * Attach hints and sign text to a request payload. Each key is omitted
 * entirely when empty, so older-shape requests are unchanged.
 */
export function withSceneHints<T extends object>(
  payload: T,
  hints: readonly SceneHint[] | undefined,
  signText?: readonly string[]
): T & { scene_hints?: SceneHint[]; sign_text?: string[] } {
  let result: T & { scene_hints?: SceneHint[]; sign_text?: string[] } = payload;
  if (hints && hints.length > 0) result = { ...result, scene_hints: [...hints] };
  if (signText && signText.length > 0) result = { ...result, sign_text: [...signText] };
  return result;
}
