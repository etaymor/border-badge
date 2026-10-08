/**
 * Winback ledger - records which winback triggers have already fired.
 *
 * The $24.99/yr winback offer is shown at most once per trigger per install,
 * so it reads as a one-time offer rather than a discount users learn to wait
 * for. Reads fail closed: if storage can't be read, the trigger counts as used.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type WinbackTrigger = 'paywall_close' | 'quick_action';

const STORAGE_KEY_PREFIX = 'winback_used:';

export async function hasUsedWinback(trigger: WinbackTrigger): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY_PREFIX + trigger);
    return value !== null;
  } catch (error) {
    console.warn('[winback] Failed to read ledger, treating as used:', error);
    return true;
  }
}

export async function markWinbackUsed(trigger: WinbackTrigger): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_PREFIX + trigger, new Date().toISOString());
  } catch (error) {
    console.warn('[winback] Failed to write ledger:', error);
  }
}
