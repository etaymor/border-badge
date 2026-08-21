/**
 * Stable, non-reversible string hashing for analytics.
 *
 * Privacy requirement R27: no coordinate, cluster id, geohash, or place id may appear in an
 * always-on log line or in any analytics event. A raw Google Place ID next to an identified
 * PostHog user reveals that a specific person was at a specific venue.
 *
 * Hashing lets match-quality analysis survive the redaction:
 * - grouping by venue still works (same input always produces the same digest)
 * - cross-event joins still work (a confirm and a reject for the same place agree)
 * - repeat mis-rankings for one venue are still detectable
 * while the readable venue identity never leaves the device.
 *
 * Design constraints:
 * - Deterministic across app launches, devices, users and OS versions. There is deliberately
 *   NO per-install salt: a salt would make each install produce a different digest for the
 *   same place and would break cross-user grouping, which is the entire point of the field.
 * - Synchronous and dependency-free. These helpers run inside UI event handlers; expo-crypto
 *   only exposes async digests, which would force every call site to become async.
 * - Not reversible: FNV-1a is a lossy 64-bit fold of an arbitrary-length input, so the digest
 *   carries no path back to the original id.
 *
 * Collisions: the output is 64 bits (16 hex chars). At analytics cardinality (thousands to
 * low millions of distinct place ids) collisions are vanishingly rare, and a collision only
 * merges two venues into one dashboard bucket. That is an acceptable trade for grouping.
 */

/** Standard 32-bit FNV-1a offset basis. */
const FNV_OFFSET_BASIS = 0x811c9dc5;

/** Standard 32-bit FNV-1a prime. */
const FNV_PRIME = 0x01000193;

/**
 * Offset basis for the second lane (golden-ratio constant). A different basis plus a reversed
 * scan order decorrelates the two lanes, so the concatenated result behaves like 64 bits rather
 * than a doubled-up 32-bit value.
 */
const SECOND_LANE_BASIS = 0x9e3779b9;

/**
 * One 32-bit FNV-1a lane over the UTF-16 code units of `input`.
 * Both bytes of each code unit are mixed so non-ASCII input cannot silently collide.
 */
function fnv1a32(input: string, basis: number, reverse: boolean): number {
  let hash = basis;
  const { length } = input;

  for (let i = 0; i < length; i += 1) {
    const code = input.charCodeAt(reverse ? length - 1 - i : i);
    hash = Math.imul(hash ^ (code & 0xff), FNV_PRIME);
    hash = Math.imul(hash ^ ((code >>> 8) & 0xff), FNV_PRIME);
  }

  return hash >>> 0;
}

/**
 * Hash a string to a stable, non-reversible 16-char lowercase hex digest.
 *
 * The same input always yields the same digest, on any device and for any user.
 */
export function stableHash(value: string): string {
  const high = fnv1a32(value, FNV_OFFSET_BASIS, false);
  const low = fnv1a32(value, SECOND_LANE_BASIS, true);

  return `${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}`;
}

/**
 * Hash an optional string, preserving "no value".
 *
 * Null, undefined and the empty string all stay `null` so a missing id never turns into a
 * real-looking digest that a dashboard would count as a venue.
 */
export function stableHashOrNull(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return stableHash(value);
}
