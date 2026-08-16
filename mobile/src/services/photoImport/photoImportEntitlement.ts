/**
 * Photo-import entitlement: counting, exemption, and disclosure (U10 / R16, R17).
 *
 * Three responsibilities, all of them consequences of progressive matching:
 *
 *  1. COUNT the free import on the first SUCCESSFUL batch (KTD11). Progressive
 *     results make a partial import normal, so waiting for the whole fetch to
 *     finish would leave most free imports uncharged; charging on dispatch would
 *     charge a run that never got an answer.
 *  2. EXEMPT the trip that consumed the import, so it stays completable on
 *     re-entry, on any device, forever (R17). The server records the consuming
 *     trip beside the counter (U16), which is what makes the exemption survive a
 *     reinstall; the device marker here is only a fast path so a returning user
 *     does not watch a paywall flash while that read is in flight (KTD23).
 *  3. GRANDFATHER users who imported under the unenforced counter (KTD18). The
 *     counter was local-only and was overwritten on every usage refetch by a
 *     server value nothing ever incremented, so making it durable turns an
 *     unenforced limit into a real one. The one-time pass seeds the server from
 *     this device's import history instead of gating those users retroactively.
 *
 * THE CLIENT MAY NEVER CLAIM AN EXEMPTION THE SERVER WILL REFUSE. The server
 * records exactly ONE consuming trip (`COALESCE(usage_photo_import_trip_id,
 * p_trip_id)` — first trip wins) and matches only that one, so every device
 * marker written here has to correspond to that single trip. A marker written
 * for a trip the server never recorded produces the worst possible outcome: no
 * paywall, a screenful of pending rows, and every batch rejected.
 *
 * Every read here FAILS OPEN. A network blip must never lock a user out of a
 * trip they have already paid for. The one exception is a server refusal we
 * have actually SEEN (a 402 on a trip this module called exempt — the R17
 * exemption is bounded by a cluster allowance and can legitimately run out):
 * that is recorded and is authoritative, so the client stops re-claiming an
 * exemption the server has already denied.
 */

import { api } from '@services/api';
import { queryClient } from '../../queryClient';
import { useAuthStore } from '@stores/authStore';
import { useSubscriptionStore } from '@stores/subscriptionStore';

import {
  addConsumedPhotoImportTripId,
  getConsumedPhotoImportTripIds,
  getPhotoImportHistoryTripIds,
  hasRunPhotoImportGrandfatherPass,
  markPhotoImportGrandfatherPassRun,
} from './photoCacheDbSuggestions';

/** Query key of `useSubscriptionUsage`, mirrored so a charge can invalidate it. */
const SUBSCRIPTION_USAGE_QUERY_KEY = ['subscription', 'usage'] as const;

interface UsageResponse {
  share_extension_count?: number;
  share_extension_period_start?: string | null;
  photo_import_count?: number;
  photo_import_limit?: number;
  /** R17: the trip the consumed import was spent on, or null. */
  photo_import_trip_id?: string | null;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
//
// Module level, not hook level, for the same reason the dispatch controller is
// (KTD21): the claim has to survive a candidate switch and a navigation, and two
// concurrent batches resolving in the same tick have to see the SAME claim set.

/** Trip ids whose import has been claimed. The synchronous double-charge guard. */
let claimedTripIds = new Set<string>();
/** Trip ids the user has already been shown the one-time confirmation for. */
let disclosedTripIds = new Set<string>();
/** Device-marker cache, namespaced by user id so accounts cannot cross over. */
let deviceMarkers: { userId: string; tripIds: Set<string> } | null = null;
/** Server-recorded consumed trip, namespaced the same way. */
let serverConsumed: { userId: string; tripId: string | null } | null = null;
/**
 * Trips the server has REFUSED a batch for (402 `PHOTO_IMPORT_LIMIT_REACHED`),
 * even though this module called them exempt.
 *
 * The R17 exemption is bounded by a cluster allowance, so a trip that was
 * genuinely exempt can stop being so mid-import. Without this the client would
 * keep answering "exempt" at every gate and keep walking into the same 402 —
 * paywall never shown, rows never resolved. Deliberately process-local: the
 * allowance may have moved on by the next launch, so the refusal is a stop for
 * this session, not a durable one.
 */
let refusedTripIds = new Set<string>();
/** The in-flight (or completed) one-time grandfather pass. */
let grandfatherPass: Promise<void> | null = null;

/** Test-only: drop every cached decision so one test cannot leak into the next. */
export function resetPhotoImportEntitlementForTests(): void {
  claimedTripIds = new Set();
  disclosedTripIds = new Set();
  deviceMarkers = null;
  serverConsumed = null;
  refusedTripIds = new Set();
  grandfatherPass = null;
}

function currentUserId(): string | null {
  return useAuthStore.getState().session?.user?.id ?? null;
}

/**
 * The one form a trip id takes inside this module.
 *
 * Trip ids are compared case-insensitively (the server does the same), but a
 * `Set` is not: recording a refusal for `Trip-A` and later checking `trip-a`
 * missed the refusal, `sameTrip` then matched the server's consumed trip
 * case-insensitively, and the client re-claimed an exemption the server had
 * already denied — the exact loop the refusal set exists to stop. Every key,
 * membership test, and comparison below goes through this.
 */
function normalizeTripId(tripId: string | null | undefined): string | null {
  if (!tripId) return null;
  const trimmed = tripId.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function sameTrip(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeTripId(a);
  const right = normalizeTripId(b);
  if (left === null || right === null) return false;
  return left === right;
}

// ---------------------------------------------------------------------------
// Disclosure (KTD18)
// ---------------------------------------------------------------------------

/**
 * Whether the free-import confirmation has already been accepted for this trip.
 *
 * Counting on the first batch means a free user can spend their one lifetime
 * import by merely glancing at a trip, so the charge is named BEFORE the first
 * dispatch rather than reported afterwards in the past tense.
 */
export function hasDisclosedFreeImport(tripId: string | null | undefined): boolean {
  const key = normalizeTripId(tripId);
  return key !== null && disclosedTripIds.has(key);
}

/** Record that the user accepted the free-import confirmation for this trip. */
export function markFreeImportDisclosed(tripId: string | null | undefined): void {
  const key = normalizeTripId(tripId);
  if (key) disclosedTripIds.add(key);
}

// ---------------------------------------------------------------------------
// Server refusals (authoritative, and the only thing that overrides fail-open)
// ---------------------------------------------------------------------------

/**
 * Record that the server refused a batch for `tripId` with the 402 entitlement
 * stop, on a trip this module had called exempt.
 *
 * Called from the surfaces that can actually see the rejection (the dispatch
 * fatal error and the scoped single-batch paths). From here on the trip is NOT
 * exempt: the next gate shows the paywall instead of dispatching into the same
 * refusal, and the free-limit banner stops being suppressed. Not looping is the
 * whole point — the refusal wins over the device marker, over the server record,
 * and over fail-open.
 */
export function noteServerRefusedPhotoImport(tripId: string | null | undefined): void {
  const key = normalizeTripId(tripId);
  if (key) refusedTripIds.add(key);
}

// ---------------------------------------------------------------------------
// Device marker (a fast path for a decision the server already confirmed)
// ---------------------------------------------------------------------------
//
// A marker is written in exactly two places, and both mean the SERVER has the
// trip: after an increment that this device's own read agrees consumed it, and
// after a usage read that named it. Nothing else may write one — a marker for a
// trip the server never recorded is a client that waves the user through and a
// server that rejects every batch.

async function readDeviceMarkers(userId: string): Promise<Set<string>> {
  if (deviceMarkers && deviceMarkers.userId === userId) return deviceMarkers.tripIds;
  const ids = await getConsumedPhotoImportTripIds(userId);
  // Normalized on the way in: rows written before this module normalized its
  // keys would otherwise never match a lookup.
  const cached = {
    userId,
    tripIds: new Set(ids.map(normalizeTripId).filter((id): id is string => id !== null)),
  };
  deviceMarkers = cached;
  return cached.tripIds;
}

async function writeDeviceMarker(userId: string, tripId: string): Promise<void> {
  const key = normalizeTripId(tripId);
  if (!key) return;
  try {
    const markers = await readDeviceMarkers(userId);
    if (markers.has(key)) return;
    markers.add(key);
    await addConsumedPhotoImportTripId(userId, key);
  } catch (error) {
    // The marker is only a fast path; losing it costs a round trip, not access.
    console.warn('[PhotoImport] Could not persist the photo-import marker', error);
  }
}

// ---------------------------------------------------------------------------
// Server record (the authority)
// ---------------------------------------------------------------------------

/**
 * Read the trip the server says consumed this user's free import.
 *
 * Throws on a read failure ON PURPOSE — the caller turns that into "allowed",
 * and swallowing it here would make an exhausted user look exempt forever
 * because the null would be cached.
 */
async function readServerConsumedTripId(userId: string): Promise<string | null> {
  if (serverConsumed && serverConsumed.userId === userId) return serverConsumed.tripId;
  const response = await api.get('/subscriptions/usage');
  const data = (response.data ?? {}) as UsageResponse;
  const tripId = data.photo_import_trip_id ?? null;
  serverConsumed = { userId, tripId };
  return tripId;
}

// ---------------------------------------------------------------------------
// The exemption (R17)
// ---------------------------------------------------------------------------

/**
 * Whether matching may run for `tripId` even though the free import is spent.
 *
 * Three steps, in this order:
 *
 *  1. A refusal we have SEEN wins outright. The exemption is bounded by a
 *     cluster allowance, so a 402 on a trip this function previously called
 *     exempt means the answer has changed — and answering "exempt" again would
 *     dispatch straight back into the same rejection.
 *  2. The server record — the same field `POST /photos/suggest-places` compares
 *     against, and therefore the ONLY thing that can grant the exemption.
 *
 * The device marker is deliberately NOT a step. It used to short-circuit ahead
 * of the server read, which made the client's answer and the server's answer
 * two independent opinions — and the client's was the generous one. That is the
 * failure the whole module exists to prevent: no paywall, a hundred pending
 * rows, and every batch rejected. The marker is still written (see
 * `writeDeviceMarker`) as the durable record of a CONFIRMED consumption, but it
 * corroborates the server rather than standing in for it. Losing KTD23's
 * paywall-flash fast path is the price; a flash is a cosmetic problem and a
 * false exemption is not.
 *
 * Returns TRUE on a read error (fail open). A user with a paid-for, half-matched
 * trip must not be locked out of it by a flaky network — except on a trip the
 * server has already refused, where "allow" is known to be wrong.
 */
export async function isPhotoImportExempt(tripId: string | null | undefined): Promise<boolean> {
  const key = normalizeTripId(tripId);
  if (!key) return false;
  if (refusedTripIds.has(key)) return false;
  const userId = currentUserId();
  if (!userId) return false;

  try {
    await ensurePhotoImportGrandfatherPass();

    const consumed = await readServerConsumedTripId(userId);
    if (sameTrip(consumed, key)) {
      void writeDeviceMarker(userId, key);
      return true;
    }
    return false;
  } catch (error) {
    console.warn('[PhotoImport] Entitlement read failed; allowing the import', error);
    return true;
  }
}

// ---------------------------------------------------------------------------
// The charge (R16 / KTD11)
// ---------------------------------------------------------------------------

/**
 * Claim the free import for `tripId`.
 *
 * SYNCHRONOUS by design. The claim is taken before the first await so several
 * batches resolving in the same tick — which is exactly what a concurrent pool
 * produces — cannot each decide they are the first. Mirrors the shape of the
 * bulk-retry in-flight guard.
 *
 * Safe to call from EVERY successful batch: the second and later calls are
 * no-ops. A charge that fails releases its claim so a later batch can retry it,
 * because a run whose charge never landed has not been paid for.
 */
export function claimPhotoImportForTrip(tripId: string | null | undefined): void {
  const key = normalizeTripId(tripId);
  if (!key) return;
  if (claimedTripIds.has(key)) return;
  claimedTripIds.add(key);
  void chargePhotoImport(key);
}

async function chargePhotoImport(tripId: string): Promise<void> {
  try {
    // U16 contract: without `trip_id` the server has no consumed trip to exempt
    // later, so the R17 exemption would be unrecoverable.
    const response = await api.post('/subscriptions/usage/increment', {
      feature: 'photo_import',
      trip_id: tripId,
    });
    const newCount = (response?.data as { new_count?: number } | undefined)?.new_count;
    const store = useSubscriptionStore.getState();
    if (typeof newCount === 'number') {
      store.setUsageLimits(store.shareExtensionUsage, newCount, store.shareExtensionPeriodStart);
    } else {
      store.incrementPhotoImportUsage();
    }

    const userId = currentUserId();
    if (userId) {
      // The server takes the FIRST trip and keeps it, so a successful increment
      // is NOT proof it recorded this one. If a different trip is already known
      // to be the consuming trip, leave the record alone and write no marker:
      // marking this trip would be exactly the false exemption the whole module
      // exists to avoid.
      const known =
        serverConsumed && serverConsumed.userId === userId ? serverConsumed.tripId : null;
      if (known === null || sameTrip(known, tripId)) {
        serverConsumed = { userId, tripId: known ?? tripId };
        await writeDeviceMarker(userId, tripId);
      }
    }

    // The count is durable now, so let the usage query refetch: the value that
    // comes back overwrites the local counter, and before U16 that value was
    // never incremented — which is precisely why the client counter was
    // unenforced.
    queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_USAGE_QUERY_KEY });
  } catch (error) {
    claimedTripIds.delete(normalizeTripId(tripId) ?? tripId);
    console.warn('[PhotoImport] Failed to record the free photo import', error);
  }
}

// ---------------------------------------------------------------------------
// The grandfather pass (KTD18)
// ---------------------------------------------------------------------------

/**
 * Run the one-time grandfather pass, at most once per process and once per user
 * per device. Never rejects.
 *
 * Existing users imported under a counter that was local-only and reset by every
 * usage refetch. Making it durable would gate them for the first time, on trips
 * they have already imported. So on the first entitlement check after this
 * ships, if the server has no consumed trip recorded, the counter is seeded from
 * this device's import history — the charge lands on a trip the user actually
 * imported rather than on the next trip they happen to open, and that trip stays
 * exempt forever.
 *
 * Exactly ONE trip is marked, because the server records exactly one. The pass
 * used to device-mark every trip in the history, which read as generous and was
 * the opposite: the client stopped showing the paywall for three trips while the
 * server would only ever honour one, so trips two and three opened into a
 * screenful of rows whose every batch was rejected. A user with several
 * pre-existing imports keeps ONE of them free; the rest are gated honestly, up
 * front, where the paywall can do its job.
 *
 * The seed trip is `history[0]`. That is deterministic (the query orders by key)
 * but it is NOT "the oldest": the metadata table has no insertion-time column,
 * so trip order is lexicographic by id. Any single trip from real history beats
 * charging whichever trip the user opens next, which is all this needs to be.
 */
export function ensurePhotoImportGrandfatherPass(): Promise<void> {
  if (!grandfatherPass) {
    // The memo is cleared HERE, not inside the pass. `runGrandfatherPass`'s
    // no-session branch reaches its `return` without ever awaiting, so it runs
    // synchronously during this call: a `grandfatherPass = null` written there
    // completed BEFORE the assignment below and was immediately overwritten by
    // it. The memo was never cleared, so a first check that landed before the
    // auth session hydrated -- the ordinary cold-start ordering -- meant the
    // pass never ran at all, and a returning free user with prior imports was
    // gated. That is the regression the pass exists to prevent.
    const pass = runGrandfatherPass()
      .then((ran) => {
        // Only clear OUR memo: a later call may already have installed a new
        // one, and dropping that would let the pass run twice.
        if (!ran && grandfatherPass === pass) grandfatherPass = null;
      })
      .catch((error) => {
        console.warn('[PhotoImport] Grandfather pass failed', error);
      });
    grandfatherPass = pass;
  }
  return grandfatherPass;
}

/** Returns whether the pass actually ran; false means "no session yet". */
async function runGrandfatherPass(): Promise<boolean> {
  const userId = currentUserId();
  if (!userId) return false;
  if (await hasRunPhotoImportGrandfatherPass(userId)) return true;

  const history = await getPhotoImportHistoryTripIds();
  if (history.length > 0) {
    const consumed = await readServerConsumedTripId(userId);
    if (consumed === null) {
      // Seed the durable counter from real history rather than from whichever
      // trip is opened next. `chargePhotoImport` writes the device marker for
      // the trip it actually recorded, so the marker set stays in step with the
      // server's single consuming trip.
      const seed = normalizeTripId(history[0]);
      if (seed) {
        claimedTripIds.add(seed);
        await chargePhotoImport(seed);
      }
    } else {
      // Already recorded — mark that trip (and only that trip) so the fast path
      // is warm without a second usage read.
      await writeDeviceMarker(userId, consumed);
    }
  }

  await markPhotoImportGrandfatherPassRun(userId);
  return true;
}
