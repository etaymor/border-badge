/**
 * Winback ledger: each trigger fires at most once per install, and a storage
 * failure fails closed (counts as used) so nobody gets a repeat offer.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { hasUsedWinback, markWinbackUsed } from '@services/winback';

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

describe('winback ledger', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    jest.clearAllMocks();
    store = {};
    mockGetItem.mockImplementation(async (key: string) => store[key] ?? null);
    mockSetItem.mockImplementation(async (key: string, value: string) => {
      store[key] = value;
    });
  });

  it('is unused until marked', async () => {
    expect(await hasUsedWinback('paywall_close')).toBe(false);
    await markWinbackUsed('paywall_close');
    expect(await hasUsedWinback('paywall_close')).toBe(true);
  });

  it('tracks each trigger separately', async () => {
    await markWinbackUsed('paywall_close');
    expect(await hasUsedWinback('quick_action')).toBe(false);
  });

  it('fails closed when storage cannot be read', async () => {
    mockGetItem.mockRejectedValueOnce(new Error('disk'));
    expect(await hasUsedWinback('quick_action')).toBe(true);
  });

  it('swallows write failures', async () => {
    mockSetItem.mockRejectedValueOnce(new Error('disk'));
    await expect(markWinbackUsed('quick_action')).resolves.toBeUndefined();
  });
});
