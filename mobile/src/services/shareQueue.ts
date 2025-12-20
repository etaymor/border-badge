/**
 * Share Queue Service
 *
 * Provides a persistent queue for failed share submissions with exponential backoff.
 * Shares are stored in AsyncStorage and automatically retried when the app comes
 * to the foreground or network connectivity is restored.
 *
 * Features:
 * - Exponential backoff retry logic (5s base, 1h max, 10 retries max)
 * - Automatic expiration of old shares (7 days)
 * - Deduplication by URL
 * - Silent error handling (logs but doesn't throw)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

// Storage key
const SHARE_QUEUE_KEY = 'share_queue';

// Retry configuration
const BACKOFF_BASE_MS = 5000; // 5 seconds
const BACKOFF_MAX_MS = 3600000; // 1 hour max
const MAX_RETRIES = 10;
const EXPIRY_DAYS = 7;

/**
 * Entry type for saved places
 */
export type EntryType = 'place' | 'food' | 'stay' | 'experience';

/**
 * Source of the shared URL
 */
export type ShareSource = 'clipboard' | 'share_extension';

/**
 * A queued share waiting to be processed
 */
export interface QueuedShare {
  /** Unique identifier for this queued share */
  id: string;
  /** The original shared URL */
  url: string;
  /** Where the share came from */
  source: ShareSource;
  /** Trip ID if user already selected one */
  tripId?: string;
  /** Google Place ID if place was confirmed */
  placeId?: string;
  /** Entry type if user selected one */
  entryType?: EntryType;
  /** User notes */
  notes?: string;
  /** When the share was queued */
  createdAt: number;
  /** Number of retry attempts */
  retryCount: number;
  /** When the last retry was attempted */
  lastRetryAt: number | null;
  /** Last error message */
  error?: string;
}

/**
 * Input for enqueueing a new share (without auto-generated fields)
 */
export type EnqueueShareInput = Omit<QueuedShare, 'id' | 'retryCount' | 'lastRetryAt'>;

/**
 * Result of flushing the queue
 */
export interface FlushResult {
  succeeded: number;
  failed: number;
}

/**
 * Calculate the next retry time based on retry count and last attempt
 */
function getNextRetryTime(retryCount: number, lastRetryAt: number): number {
  const backoff = Math.min(BACKOFF_BASE_MS * Math.pow(2, retryCount), BACKOFF_MAX_MS);
  return lastRetryAt + backoff;
}

/**
 * Check if a share is ready for retry based on backoff timing
 */
function isReadyForRetry(share: QueuedShare): boolean {
  if (share.retryCount >= MAX_RETRIES) return false;
  if (!share.lastRetryAt) return true;
  return Date.now() >= getNextRetryTime(share.retryCount, share.lastRetryAt);
}

/**
 * Check if a share has expired (older than EXPIRY_DAYS)
 */
function isExpired(share: QueuedShare): boolean {
  const expiryMs = EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - share.createdAt > expiryMs;
}

/**
 * Read the queue from storage
 */
async function readQueue(): Promise<QueuedShare[]> {
  try {
    const data = await AsyncStorage.getItem(SHARE_QUEUE_KEY);
    if (!data) return [];
    return JSON.parse(data) as QueuedShare[];
  } catch (error) {
    console.error('Failed to read share queue:', error);
    return [];
  }
}

/**
 * Write the queue to storage
 */
async function writeQueue(queue: QueuedShare[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SHARE_QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('Failed to write share queue:', error);
  }
}

/**
 * Generate a unique ID for a queued share
 */
function generateId(): string {
  return Crypto.randomUUID();
}

/**
 * Add a failed share to the retry queue
 *
 * @param share - The share data to queue
 */
export async function enqueueFailedShare(share: EnqueueShareInput): Promise<void> {
  try {
    const queue = await readQueue();

    // Check for duplicate URL (don't queue same URL twice)
    const existingIndex = queue.findIndex((s) => s.url === share.url);
    if (existingIndex !== -1) {
      // Update existing entry with new data but keep retry state
      queue[existingIndex] = {
        ...queue[existingIndex],
        ...share,
        // Preserve these fields from existing entry
        id: queue[existingIndex].id,
        retryCount: queue[existingIndex].retryCount,
        lastRetryAt: queue[existingIndex].lastRetryAt,
      };
    } else {
      // Add new entry
      const queuedShare: QueuedShare = {
        ...share,
        id: generateId(),
        retryCount: 0,
        lastRetryAt: null,
      };
      queue.push(queuedShare);
    }

    await writeQueue(queue);
  } catch (error) {
    console.error('Failed to enqueue share:', error);
  }
}

/**
 * Get all pending shares in the queue
 *
 * @returns Array of queued shares (excludes expired ones)
 */
export async function getPendingShares(): Promise<QueuedShare[]> {
  const queue = await readQueue();
  // Filter out expired shares
  return queue.filter((share) => !isExpired(share));
}

/**
 * Get the count of pending shares
 *
 * @returns Number of shares in the queue
 */
export async function getPendingShareCount(): Promise<number> {
  const pending = await getPendingShares();
  return pending.length;
}

/**
 * Remove a share from the queue after successful processing
 *
 * @param id - The ID of the share to remove
 */
export async function dequeueShare(id: string): Promise<void> {
  try {
    const queue = await readQueue();
    const filtered = queue.filter((share) => share.id !== id);
    await writeQueue(filtered);
  } catch (error) {
    console.error('Failed to dequeue share:', error);
  }
}

/**
 * Get the next share that is ready for retry
 *
 * @returns The next retryable share, or null if none are ready
 */
export async function getNextRetryableShare(): Promise<QueuedShare | null> {
  const queue = await readQueue();

  for (const share of queue) {
    if (isExpired(share)) continue;
    if (isReadyForRetry(share)) {
      return share;
    }
  }

  return null;
}

/**
 * Mark a retry attempt for a share
 * Updates retryCount and lastRetryAt, optionally sets error message
 *
 * @param id - The ID of the share
 * @param error - Optional error message from the retry attempt
 */
export async function markRetryAttempt(id: string, error?: string): Promise<void> {
  try {
    const queue = await readQueue();
    const index = queue.findIndex((share) => share.id === id);

    if (index !== -1) {
      queue[index] = {
        ...queue[index],
        retryCount: queue[index].retryCount + 1,
        lastRetryAt: Date.now(),
        error: error,
      };
      await writeQueue(queue);
    }
  } catch (err) {
    console.error('Failed to mark retry attempt:', err);
  }
}

/**
 * Clear all expired shares from the queue
 * Should be called periodically (e.g., on app foreground)
 */
export async function clearExpiredShares(): Promise<void> {
  try {
    const queue = await readQueue();
    const filtered = queue.filter((share) => !isExpired(share));

    // Only write if something changed
    if (filtered.length !== queue.length) {
      await writeQueue(filtered);
    }
  } catch (error) {
    console.error('Failed to clear expired shares:', error);
  }
}

/**
 * Clear all shares from the queue
 * Use with caution - removes all pending retries
 */
export async function clearAllShares(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SHARE_QUEUE_KEY);
  } catch (error) {
    console.error('Failed to clear all shares:', error);
  }
}

/**
 * Flush the queue - attempt to process all ready retries
 *
 * This is a placeholder that should be called with a retry function.
 * The actual retry logic should be implemented in the component that
 * calls this, as it needs access to the ingest mutation.
 *
 * @param retryFn - Function to retry a single share, returns true if successful
 * @returns Count of succeeded and failed retries
 */
export async function flushQueue(
  retryFn?: (share: QueuedShare) => Promise<boolean>
): Promise<FlushResult> {
  // First, clear any expired shares
  await clearExpiredShares();

  // If no retry function provided, just return zeros
  if (!retryFn) {
    return { succeeded: 0, failed: 0 };
  }

  const result: FlushResult = { succeeded: 0, failed: 0 };
  let share = await getNextRetryableShare();

  while (share) {
    try {
      const success = await retryFn(share);

      if (success) {
        await dequeueShare(share.id);
        result.succeeded++;
      } else {
        await markRetryAttempt(share.id, 'Retry failed');
        result.failed++;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await markRetryAttempt(share.id, errorMessage);
      result.failed++;
    }

    // Get next share (if any)
    share = await getNextRetryableShare();
  }

  return result;
}

/**
 * Get a share by ID
 *
 * @param id - The ID of the share to find
 * @returns The share if found, null otherwise
 */
export async function getShareById(id: string): Promise<QueuedShare | null> {
  const queue = await readQueue();
  return queue.find((share) => share.id === id) ?? null;
}

/**
 * Update a share's data (e.g., after user selects trip or confirms place)
 *
 * @param id - The ID of the share to update
 * @param updates - Partial share data to merge
 */
export async function updateShare(
  id: string,
  updates: Partial<Omit<QueuedShare, 'id' | 'createdAt'>>
): Promise<void> {
  try {
    const queue = await readQueue();
    const index = queue.findIndex((share) => share.id === id);

    if (index !== -1) {
      queue[index] = {
        ...queue[index],
        ...updates,
      };
      await writeQueue(queue);
    }
  } catch (error) {
    console.error('Failed to update share:', error);
  }
}
