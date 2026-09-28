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
 * Hints for a batch of clusters, keyed by cluster id; clusters without hints
 * are absent. One tag read covers the whole batch. Best-effort: a read error
 * means no hints (today's behavior), never a failed dispatch.
 */
export async function loadSceneHintsForClusters(
  clusters: readonly LocationCluster[]
): Promise<Map<string, SceneHint[]>> {
  const result = new Map<string, SceneHint[]>();
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
    const hints = deriveSceneHints(cluster.photos.map((p) => tags.get(p.id)));
    if (hints.length > 0) result.set(cluster.id, hints);
  }
  return result;
}

/**
 * Attach hints to a request payload. With none, the payload comes back
 * without a `scene_hints` key at all, so older-shape requests are unchanged.
 */
export function withSceneHints<T extends object>(
  payload: T,
  hints: readonly SceneHint[] | undefined
): T & { scene_hints?: SceneHint[] } {
  return hints && hints.length > 0 ? { ...payload, scene_hints: [...hints] } : payload;
}
