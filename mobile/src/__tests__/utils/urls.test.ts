/**
 * Tests for public share URL builders, including ?ref= attribution (U7).
 */

import { getPublicListUrl, getPublicProfileUrl, getPublicTripUrl } from '@utils/urls';

describe('public share URLs', () => {
  const originalWebBaseUrl = process.env.EXPO_PUBLIC_WEB_BASE_URL;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_WEB_BASE_URL = 'https://atlasi.app';
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_WEB_BASE_URL = originalWebBaseUrl;
  });

  it('builds profile, trip, and list URLs', () => {
    expect(getPublicProfileUrl('alex')).toBe('https://atlasi.app/u/alex');
    expect(getPublicTripUrl('summer-abc')).toBe('https://atlasi.app/t/summer-abc');
    expect(getPublicListUrl('tokyo-eats')).toBe('https://atlasi.app/l/tokyo-eats');
  });

  it('appends ?ref= attribution when a referrer is given', () => {
    expect(getPublicProfileUrl('alex', 'alex')).toBe('https://atlasi.app/u/alex?ref=alex');
    expect(getPublicTripUrl('summer-abc', 'alex')).toBe('https://atlasi.app/t/summer-abc?ref=alex');
    expect(getPublicListUrl('tokyo-eats', 'alex')).toBe('https://atlasi.app/l/tokyo-eats?ref=alex');
  });

  it('URL-encodes the ref value', () => {
    expect(getPublicListUrl('tokyo-eats', 'a&b')).toBe('https://atlasi.app/l/tokyo-eats?ref=a%26b');
  });

  it('omits ref when the referrer is undefined or empty', () => {
    expect(getPublicProfileUrl('alex', undefined)).toBe('https://atlasi.app/u/alex');
    expect(getPublicProfileUrl('alex', '')).toBe('https://atlasi.app/u/alex');
  });

  it('returns empty string without a configured base URL', () => {
    delete process.env.EXPO_PUBLIC_WEB_BASE_URL;
    expect(getPublicProfileUrl('alex', 'alex')).toBe('');
  });

  it('returns empty string without an identifier', () => {
    expect(getPublicProfileUrl('', 'alex')).toBe('');
    expect(getPublicListUrl('', 'alex')).toBe('');
    expect(getPublicTripUrl('', 'alex')).toBe('');
  });
});
