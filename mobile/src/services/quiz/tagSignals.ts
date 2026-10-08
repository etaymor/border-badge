/**
 * Reading raw on-device Vision signals as Guess Where suitability.
 *
 * The native module (`@modules/photo-tagger`) deliberately returns uninterpreted
 * numbers; ALL interpretation lives here so it is pure, unit-testable, and
 * retunable over-the-air without re-tagging a single photo.
 *
 * What we are approximating is the SERVER's own eligibility gate
 * (`backend/app/services/photo_vision/quiz_constants.py`), which asks:
 *   1. Is a person a SUBJECT of this photo? (prominence, not presence)
 *   2. Outdoor or indoor? (covered-but-open counts as OUTDOOR)
 *   3. Category: scenery / landmark / building_exterior are eligible;
 *      "other" -- food, interiors, objects, vehicles, animals, documents,
 *      screenshots, art close-ups -- is not.
 *
 * That gate remains the FINAL verdict. Everything here is a pre-ranker, and the
 * asymmetry between the two kinds of mistake drives every threshold below:
 * a mis-RANKED photo still reaches the gate, just later, and costs nothing;
 * a mis-DROPPED photo is invisible forever. So ranking is aggressive and hard
 * drops are reserved for near-certainties.
 */

import type { PhotoMlTag } from '@services/photoImport/photoTagDb';

/** Interpreted signals for one photo. */
export interface TagSignals {
  /**
   * How much of the frame the largest person occupies, 0..1. Faces are scaled
   * up to approximate the whole body, because the server judges "is a person
   * the subject", and a legible face implies a prominent person even when the
   * body detector misses.
   */
  peopleProminence: number;
  /** Positive = outdoor evidence, negative = indoor/food/document evidence. */
  outdoorScore: number;
  categoryGuess: TagCategory;
  /** Screenshot, document, receipt - things Apple calls "utility" images. */
  utilityLikely: boolean;
  /** Higher is better. Neutral (0) when the OS could not measure it. */
  qualityScore: number;
  /**
   * Capture-context priors, attached at pool decoration time when intent
   * signals are enabled (see `quizCandidateTags.ts`). Both are down-rank-only:
   * a photo saved from Instagram or shot through a car window probably fails
   * the gate, but "probably" is a `marginal`, never a drop.
   */
  savedFromSocialLikely?: boolean;
  movingCapture?: boolean;
}

export type TagCategory = 'scenery' | 'landmark' | 'building' | 'other' | 'unknown';

export type PrefilterTier =
  /** Near-certain reject. Never sent to the paid gate. */
  | 'drop'
  /** Looks like a good puzzle: classify these first. */
  | 'likely'
  /** No usable signal (untagged, or tagged with nothing decisive). */
  | 'unknown'
  /** Probably fails the gate, but not certainly: classify these LAST, not never. */
  | 'marginal';

/**
 * A face bounding box covers roughly a sixth of the person's visible body in a
 * typical framing, so a face filling 5% of the frame implies a person filling
 * ~30%. Used only to raise prominence, never to lower it.
 */
const FACE_TO_BODY_RATIO = 6;

/**
 * A person occupying more than this fraction of the frame is unambiguously the
 * subject, which is precisely the server's rejection criterion. Small figures in
 * a landscape stay well under it and survive.
 */
export const PEOPLE_PROMINENCE_DROP = 0.3;

/** Above this, people are prominent enough to rank last without being dropped. */
const PEOPLE_PROMINENCE_MARGINAL = 0.1;

/** Vision confidences below this are noise in a ~1,300-label taxonomy. */
const LABEL_FLOOR = 0.15;

/**
 * Label vocabularies. Every identifier in every set below is checked against
 * the real classifier taxonomy (`VNClassifyImageRequest.supportedIdentifiers()`,
 * 1,303 labels) by `visionVocabulary.test.ts`: a name Vision never emits does
 * not fail, it silently scores zero forever. Many plausible names are NOT in
 * the taxonomy -- "church", "cathedral", "temple", "mosque", "palace", "city",
 * "skyline", "sea", "coast", "valley", "meadow", "plaza", "meal", "menu",
 * "text" -- so the nearest real labels stand in for them (e.g. `cityscape`,
 * `belltower`, `dome`, `ruins`, `shore`), and a concept with no real label is
 * simply absent.
 *
 * Outdoor scene labels. Includes covered-but-open places (station platforms)
 * because the server counts those as OUTDOOR - getting this wrong is what made
 * the original gate reject nearly everything. Every LANDMARK / SCENERY /
 * BUILDING label is also here; the extra outdoor-only labels (boats, docks,
 * grass, graves, rocks, ...) are outdoor evidence without saying what kind of
 * puzzle the photo would make.
 */
const OUTDOOR_LABELS = new Set([
  'alley',
  'arch',
  'beach',
  'belltower',
  'boat',
  'bridge',
  'building',
  'canyon',
  'castle',
  'cityscape',
  'cliff',
  'clock_tower',
  'crosswalk',
  'cruise_ship',
  'desert',
  'dock',
  'dome',
  'farm',
  'forest',
  'fountain',
  'garden',
  'glacier',
  'grass',
  'grave',
  'harbour',
  'hill',
  'house_single',
  'island',
  'jungle',
  'lake',
  'lighthouse',
  'monument',
  'mountain',
  'obelisk',
  'ocean',
  'orchard',
  'outdoor',
  'park',
  'pier',
  'pyramid',
  'railroad',
  'rice_field',
  'river',
  'road',
  'rocks',
  'ruins',
  'sailboat',
  'sand_dune',
  'shore',
  'sidewalk',
  'sky',
  'skyscraper',
  'snow',
  'stadium',
  'statue',
  'storefront',
  'street',
  'sunset_sunrise',
  'tower',
  'train_station',
  'tree',
  'vineyard',
  'volcano',
  'waterfall',
  'waterways',
  'wetland',
  'windmill',
]);

/**
 * Fully-enclosed interiors and close-up subjects the gate calls "other".
 * `stairs` is deliberately absent: outdoor landmark steps carry it too.
 */
const INDOOR_LABELS = new Set([
  'bathroom',
  'bedroom',
  'bookshelf',
  'closet',
  'desk',
  'furniture',
  'interior_room',
  'interior_shop',
  'kitchen',
  'living_room',
  'museum',
  'restaurant',
  'sofa',
  'table',
]);

const FOOD_LABELS = new Set([
  'bread',
  'cake',
  'cocktail',
  'coffee',
  'dessert',
  'drink',
  'food',
  'fruit',
  'meat',
  'pasta',
  'pizza',
  'plate',
  'salad',
  'sandwich',
  'seafood',
  'soup',
  'vegetable',
  'wine',
]);

/**
 * Screenshots, documents, receipts, whiteboards - Apple's "utility" family.
 *
 * These feed a HARD DROP (summed confidence >= 0.5 skips the gate forever), so
 * only labels that near-certainly mean a document or screen belong here.
 * Deliberately left out: `book` and `bookshelf` (bookshops and libraries can
 * be puzzles), `map` (trailhead and city map boards sit in real scenes),
 * `chalkboard` and `billboards` (street cafes and squares), `credit_card` /
 * `money` / `currency` (close-ups, but not documents; the gate rejects them).
 */
const UTILITY_LABELS = new Set([
  'chart',
  'diagram',
  'document',
  'flipchart',
  'handwriting',
  'newspaper',
  'passport',
  'printed_page',
  'receipt',
  'screenshot',
  'sign',
  'ticket',
  'whiteboard',
]);

const LANDMARK_LABELS = new Set([
  'arch',
  'belltower',
  'castle',
  'clock_tower',
  'dome',
  'lighthouse',
  'monument',
  'obelisk',
  'pyramid',
  'ruins',
  'statue',
  'tower',
  'windmill',
]);

const SCENERY_LABELS = new Set([
  'beach',
  'canyon',
  'cliff',
  'desert',
  'forest',
  'glacier',
  'hill',
  'island',
  'jungle',
  'lake',
  'mountain',
  'ocean',
  'rice_field',
  'river',
  'sand_dune',
  'shore',
  'sky',
  'snow',
  'sunset_sunrise',
  'vineyard',
  'volcano',
  'waterfall',
  'wetland',
]);

const BUILDING_LABELS = new Set([
  'alley',
  'bridge',
  'building',
  'cityscape',
  'crosswalk',
  'fountain',
  'harbour',
  'house_single',
  'pier',
  'road',
  'sidewalk',
  'skyscraper',
  'storefront',
  'street',
]);

/**
 * Every label vocabulary above, exported so a test can hold each identifier to
 * the real classifier taxonomy. A name Vision never emits silently scores zero.
 */
export const TAG_SIGNAL_VOCABULARIES: Readonly<Record<string, ReadonlySet<string>>> = {
  outdoor: OUTDOOR_LABELS,
  indoor: INDOOR_LABELS,
  food: FOOD_LABELS,
  utility: UTILITY_LABELS,
  landmark: LANDMARK_LABELS,
  scenery: SCENERY_LABELS,
  building: BUILDING_LABELS,
};

/** Sum the confidences of a photo's labels that fall in `vocabulary`. */
function scoreLabels(tag: PhotoMlTag, vocabulary: Set<string>): number {
  let total = 0;
  for (const label of tag.labels) {
    if (label.confidence >= LABEL_FLOOR && vocabulary.has(label.identifier)) {
      total += label.confidence;
    }
  }
  return total;
}

function pickCategory(tag: PhotoMlTag): TagCategory {
  const scores: Array<[TagCategory, number]> = [
    ['landmark', scoreLabels(tag, LANDMARK_LABELS)],
    ['scenery', scoreLabels(tag, SCENERY_LABELS)],
    ['building', scoreLabels(tag, BUILDING_LABELS)],
    ['other', scoreLabels(tag, FOOD_LABELS) + scoreLabels(tag, UTILITY_LABELS)],
  ];
  let best: TagCategory = 'unknown';
  let bestScore = 0;
  for (const [category, score] of scores) {
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Interpret one stored tag row. A row whose status is not `ok` carries no
 * measured signal, so it reads as fully neutral rather than as evidence of
 * anything - an iCloud-offloaded photo must not be penalized for being offloaded.
 */
export function deriveSignals(tag: PhotoMlTag): TagSignals {
  if (tag.status !== 'ok') {
    return {
      peopleProminence: 0,
      outdoorScore: 0,
      categoryGuess: 'unknown',
      // A screenshot is knowable without pixels, so this one signal survives.
      utilityLikely: tag.isScreenshot,
      qualityScore: 0,
    };
  }

  const peopleProminence = Math.min(
    1,
    Math.max(tag.maxHumanArea ?? 0, (tag.maxFaceArea ?? 0) * FACE_TO_BODY_RATIO)
  );

  const outdoorScore =
    scoreLabels(tag, OUTDOOR_LABELS) -
    scoreLabels(tag, INDOOR_LABELS) -
    scoreLabels(tag, FOOD_LABELS) -
    scoreLabels(tag, UTILITY_LABELS);

  const utilityLikely =
    tag.isScreenshot || tag.isUtility === true || scoreLabels(tag, UTILITY_LABELS) >= 0.5;

  return {
    peopleProminence,
    outdoorScore,
    categoryGuess: pickCategory(tag),
    utilityLikely,
    // null means "this OS cannot measure aesthetics", NOT "unattractive".
    // Defaulting to 0 keeps iOS < 18 photos interleaved with iOS 18 ones
    // instead of sinking every one of them below the measured photos.
    qualityScore: tag.aestheticScore ?? 0,
  };
}

/**
 * Bucket a photo for pre-filtering.
 *
 * Only `drop` skips the paid gate, and only three things earn it: a screenshot,
 * an Apple-flagged utility image, or a person filling ≥30% of the frame. Indoor
 * and food evidence rank `marginal` -- classified LAST, never dropped -- until
 * agreement telemetry shows the drop would be safe.
 */
export function classifyPrefilter(signals: TagSignals): PrefilterTier {
  if (signals.utilityLikely) return 'drop';
  if (signals.peopleProminence > PEOPLE_PROMINENCE_DROP) return 'drop';

  if (signals.peopleProminence > PEOPLE_PROMINENCE_MARGINAL) return 'marginal';
  if (signals.categoryGuess === 'other') return 'marginal';
  if (signals.outdoorScore < 0) return 'marginal';
  if (signals.savedFromSocialLikely || signals.movingCapture) return 'marginal';

  if (
    signals.outdoorScore > 0 &&
    (signals.categoryGuess === 'scenery' ||
      signals.categoryGuess === 'landmark' ||
      signals.categoryGuess === 'building')
  ) {
    return 'likely';
  }

  return 'unknown';
}

/**
 * Rank order of the tiers within one freshness segment. `drop` never appears
 * here - dropped candidates are removed from the pool before ordering.
 */
export const TIER_ORDER: readonly PrefilterTier[] = ['likely', 'unknown', 'marginal'];

/**
 * Tier for a candidate that has no tags at all. MUST be the same tier the
 * untagged majority falls into, so that a library with zero coverage produces
 * exactly today's ordering.
 */
export const DEFAULT_TIER: PrefilterTier = 'unknown';
