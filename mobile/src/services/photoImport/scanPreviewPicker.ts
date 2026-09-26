import { SOCIAL_SAVE_DIMENSIONS } from '@services/photoSignals/captureContext';

import type { PhotoWithLocation } from './types';

export const MAX_SCAN_PREVIEW_COUNTRIES = 10;
export const MAX_SCAN_PREVIEWS_PER_COUNTRY = 2;

export interface ScanPreview {
  assetId: string;
  uri: string;
}

export interface CountryPreviewRow {
  code: string;
  name: string;
  previews: ScanPreview[];
}

export interface ScanPreviewBatchItem {
  code: string;
  name: string;
  photo: PhotoWithLocation;
}

export interface ScanPreviewPickerOptions {
  homeCountry: string;
}

export interface ScanPreviewPickerResult {
  countryPreviews: readonly CountryPreviewRow[];
  changed: boolean;
}

interface PendingCountry {
  code: string;
  name: string;
  candidates: PhotoWithLocation[];
  candidateIds: Set<string>;
}

interface ExistingCountry {
  row: CountryPreviewRow;
  index: number;
  previewIds: Set<string>;
}

function finitePositive(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function pixelCount(photo: PhotoWithLocation): number {
  const pixels = finitePositive(photo.width) * finitePositive(photo.height);
  return Number.isFinite(pixels) ? pixels : 0;
}

function dimensionRank(photo: PhotoWithLocation): number {
  const width = finitePositive(photo.width);
  const height = finitePositive(photo.height);
  if (width === 0 || height === 0) return 1;
  return SOCIAL_SAVE_DIMENSIONS.has(`${width}x${height}`) ? 0 : 2;
}

function creationTime(photo: PhotoWithLocation): number {
  const value = photo.creationTime instanceof Date ? photo.creationTime.getTime() : 0;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function compareCandidates(left: PhotoWithLocation, right: PhotoWithLocation): number {
  // Network (iCloud-optimized) assets are last-resort: every local ranks above every network.
  const networkDifference =
    Number(left.isNetworkAsset === true) - Number(right.isNetworkAsset === true);
  if (networkDifference !== 0) return networkDifference;

  const favoriteDifference = Number(right.isFavorite === true) - Number(left.isFavorite === true);
  if (favoriteDifference !== 0) return favoriteDifference;

  const pixelDifference = pixelCount(right) - pixelCount(left);
  if (pixelDifference !== 0) return pixelDifference;

  const dimensionDifference = dimensionRank(right) - dimensionRank(left);
  if (dimensionDifference !== 0) return dimensionDifference;

  return creationTime(right) - creationTime(left);
}

function addCandidate(pending: PendingCountry, photo: PhotoWithLocation, limit: number): void {
  if (limit === 0 || photo.isScreenshot === true || pending.candidateIds.has(photo.id)) {
    return;
  }

  pending.candidateIds.add(photo.id);
  pending.candidates.push(photo);
  pending.candidates.sort(compareCandidates);
  if (pending.candidates.length > limit) {
    const removed = pending.candidates.pop();
    if (removed) pending.candidateIds.delete(removed.id);
  }
}

/**
 * Append rows and fill their remaining preview slots from one scan batch.
 *
 * Existing rows and previews are immutable: later batches may fill an open
 * slot, but can never reorder or evict an established preview.
 */
export function pickScanPreviews(
  current: readonly CountryPreviewRow[],
  batch: readonly ScanPreviewBatchItem[],
  options: ScanPreviewPickerOptions
): ScanPreviewPickerResult {
  const homeCountry = options.homeCountry.trim().toUpperCase();
  const existingByCode = new Map<string, ExistingCountry>(
    current.map((row, index) => [
      row.code,
      {
        row,
        index,
        previewIds: new Set(row.previews.map((preview) => preview.assetId)),
      },
    ])
  );
  const pendingByCode = new Map<string, PendingCountry>();
  let newPendingCountryCount = 0;

  for (const item of batch) {
    const code = item.code.trim().toUpperCase();
    if (!code || code === homeCountry) continue;

    const existing = existingByCode.get(code);
    let pending = pendingByCode.get(code);
    if (!pending) {
      if (!existing && current.length + newPendingCountryCount >= MAX_SCAN_PREVIEW_COUNTRIES) {
        continue;
      }
      pending = {
        code,
        name: existing?.row.name ?? item.name,
        candidates: [],
        candidateIds: new Set(),
      };
      pendingByCode.set(code, pending);
      if (!existing) newPendingCountryCount += 1;
    }

    if (!existing?.previewIds.has(item.photo.id)) {
      const slotsAvailable = MAX_SCAN_PREVIEWS_PER_COUNTRY - (existing?.row.previews.length ?? 0);
      addCandidate(pending, item.photo, slotsAvailable);
    }
  }

  if (pendingByCode.size === 0) return { countryPreviews: current, changed: false };

  let next: CountryPreviewRow[] | null = null;
  for (const pending of pendingByCode.values()) {
    const existing = existingByCode.get(pending.code);
    const additions = pending.candidates.map((photo) => ({
      assetId: photo.id,
      uri: photo.uri,
    }));

    if (existing) {
      if (additions.length === 0) continue;
      next ??= current.slice();
      next[existing.index] = {
        ...existing.row,
        previews: [...existing.row.previews, ...additions],
      };
      continue;
    }

    next ??= current.slice();
    next.push({ code: pending.code, name: pending.name, previews: additions });
  }

  return next
    ? { countryPreviews: next, changed: true }
    : { countryPreviews: current, changed: false };
}

// ---------------------------------------------------------------------------
// Reading previews: the live photo grid shown while the scan reads the library
// ---------------------------------------------------------------------------

export const MAX_READING_PREVIEWS = 24;
export const READING_PREVIEWS_PER_BATCH = 4;

export interface ReadingPreview extends ScanPreview {
  /** Taken outside the home country — the grid badges these as trip photos. */
  isTravel: boolean;
}

export interface ReadingPreviewBatchItem {
  /** Territory code, or null when the location resolved to no country. */
  code: string | null;
  photo: PhotoWithLocation;
}

export interface ReadingPreviewResult {
  readingPreviews: readonly ReadingPreview[];
  changed: boolean;
}

/**
 * Sample a few photos from one scan batch into a rolling window of the most
 * recent reads. Evenly spaced through the batch so a burst from one day does
 * not fill the grid with near-duplicates. Local assets only: the grid never
 * waits on an iCloud-optimized original.
 */
export function appendReadingPreviews(
  current: readonly ReadingPreview[],
  batch: readonly ReadingPreviewBatchItem[],
  options: ScanPreviewPickerOptions
): ReadingPreviewResult {
  const homeCountry = options.homeCountry.trim().toUpperCase();
  const seen = new Set(current.map((preview) => preview.assetId));
  const eligible = batch.filter(
    ({ photo }) =>
      photo.isNetworkAsset !== true && photo.isScreenshot !== true && !seen.has(photo.id)
  );
  if (eligible.length === 0) return { readingPreviews: current, changed: false };

  const take = Math.min(READING_PREVIEWS_PER_BATCH, eligible.length);
  const step = eligible.length / take;
  const additions: ReadingPreview[] = [];
  for (let index = 0; index < take; index += 1) {
    const { code, photo } = eligible[Math.floor(index * step)];
    if (additions.some((preview) => preview.assetId === photo.id)) continue;
    const normalizedCode = code?.trim().toUpperCase() ?? '';
    additions.push({
      assetId: photo.id,
      uri: photo.uri,
      isTravel: normalizedCode !== '' && normalizedCode !== homeCountry,
    });
  }

  return {
    readingPreviews: [...current, ...additions].slice(-MAX_READING_PREVIEWS),
    changed: true,
  };
}
