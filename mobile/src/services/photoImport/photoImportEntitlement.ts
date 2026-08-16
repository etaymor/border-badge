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
 * Every read here FAILS OPEN. A network blip must never lock a user out of a
 * trip they have already paid for.
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
/** The in-flight (or completed) one-time grandfather pass. */
let grandfatherPass: Promise<void> | null = null;

/** Test-only: drop every cached decision so one test cannot leak into the next. */
export function resetPhotoImportEntitlementForTests(): void {
  claimedTripIds = new Set();
  disclosedTripIds = new Set();
  deviceMarkers = null;
  serverConsumed = null;
  grandfatherPass = null;
}

function currentUserId(): string | null {
  return useAuthStore.getState().session?.user?.id ?? null;
}

function sameTrip(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
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
  return tripId != null && disclosedTripIds.has(tripId);
}

/** Record that the user accepted the free-import confirmation for this trip. */
export function markFreeImportDisclosed(tripId: string | null | undefined): void {
  if (tripId) disclosedTripIds.add(tripId);
}

// ---------------------------------------------------------------------------
// Device marker (the fast path — never the decision)
// ---------------------------------------------------------------------------

async function readDeviceMarkers(userId: string): Promise<Set<string>> {
  if (deviceMarkers && deviceMarkers.userId === userId) return deviceMarkers.tripIds;
  const ids = await getConsumedPhotoImportTripIds(userId);
  const cached = { userId, tripIds: new Set(ids) };
  deviceMarkers = cached;
  return cached.tripIds;
}

async function writeDeviceMarker(userId: string, tripId: string): Promise<void> {
  try {
    const markers = await readDeviceMarkers(userId);
    if (markers.has(tripId)) return;
    markers.add(tripId);
    await addConsumedPhotoImportTripId(userId, tripId);
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
 * Order matters: the device marker first (fast, avoids the paywall flash), then
 * the server record, which is the same field `POST /photos/suggest-places`
 * compares against and therefore the only thing that can actually be trusted.
 *
 * Returns TRUE on a read error (fail open). A user with a paid-for, half-matched
 * trip must not be locked out of it by a flaky network.
 */
export async function isPhotoImportExempt(tripId: string | null | undefined): Promise<boolean> {
  if (!tripId) return false;
  const userId = currentUserId();
  if (!userId) return false;

  try {
    await ensurePhotoImportGrandfatherPass();

    const markers = await readDeviceMarkers(userId);
    if (markers.has(tripId)) return true;

    const consumed = await readServerConsumedTripId(userId);
    if (sameTrip(consumed, tripId)) {
      void writeDeviceMarker(userId, tripId);
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
  if (!tripId) return;
  if (claimedTripIds.has(tripId)) return;
  claimedTripIds.add(tripId);
  void chargePhotoImport(tripId);
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
      serverConsumed = { userId, tripId: serverConsumed?.tripId ?? tripId };
      await writeDeviceMarker(userId, tripId);
    }

    // The count is durable now, so let the usage query refetch: the value that
    // comes back overwrites the local counter, and before U16 that value was
    // never incremented — which is precisely why the client counter was
    // unenforced.
    queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_USAGE_QUERY_KEY });
  } catch (error) {
    claimedTripIds.delete(tripId);
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
 * they have already imported. So on the first entitlement check after this ships:
 *
 *  - every trip already taken into matching on this device is marked exempt, so
 *    none of them is gated retroactively; and
 *  - if the server has no consumed trip recorded, the counter is seeded from the
 *    oldest of them, so the charge lands on a trip the user actually imported
 *    rather than on the next trip they happen to open.
 */
export function ensurePhotoImportGrandfatherPass(): Promise<void> {
  if (!grandfatherPass) {
    grandfatherPass = runGrandfatherPass().catch((error) => {
      console.warn('[PhotoImport] Grandfather pass failed', error);
    });
  }
  return grandfatherPass;
}

async function runGrandfatherPass(): Promise<void> {
  const userId = currentUserId();
  if (!userId) {
    // Nothing to grandfather without an account, and nothing to remember either:
    // clear the memo so the pass runs once the session lands.
    grandfatherPass = null;
    return;
  }
  if (await hasRunPhotoImportGrandfatherPass(userId)) return;

  const history = await getPhotoImportHistoryTripIds();
  if (history.length > 0) {
    const consumed = await readServerConsumedTripId(userId);
    if (consumed === null) {
      // Seed the durable counter from real history rather than from whichever
      // trip is opened next.
      claimedTripIds.add(history[0]);
      await chargePhotoImport(history[0]);
    }
    for (const tripId of history) {
      await writeDeviceMarker(userId, tripId);
    }
  }

  await markPhotoImportGrandfatherPassRun(userId);
}
