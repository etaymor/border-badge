/**
 * Tests for the stable, non-reversible analytics hash (R27).
 */
import { stableHash, stableHashOrNull } from '@utils/stableHash';

describe('stableHash', () => {
  it('returns the same hash for the same input across separate calls', () => {
    const placeId = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

    expect(stableHash(placeId)).toBe(stableHash(placeId));
  });

  it('returns different hashes for different inputs', () => {
    expect(stableHash('ChIJN1t_tDeuEmsRUsoyG83frY4')).not.toBe(
      stableHash('ChIJd8BlQ2BZwokRAFUEcm_qrcA')
    );
  });

  it('returns different hashes for inputs differing by one character', () => {
    expect(stableHash('ChIJN1t_tDeuEmsRUsoyG83frY4')).not.toBe(
      stableHash('ChIJN1t_tDeuEmsRUsoyG83frY5')
    );
  });

  it('is order sensitive', () => {
    expect(stableHash('abc')).not.toBe(stableHash('cba'));
  });

  it('always produces 16 lowercase hex characters', () => {
    const inputs = ['a', '', 'ChIJN1t_tDeuEmsRUsoyG83frY4', 'Café de Flore', '0'.repeat(500)];

    inputs.forEach((input) => {
      expect(stableHash(input)).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  it('never echoes the input back', () => {
    const placeId = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

    expect(stableHash(placeId)).not.toContain('ChIJ');
  });

  it('spreads a realistic batch of place ids without collisions', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `ChIJplace_${i}_suffix`);
    const hashes = new Set(ids.map(stableHash));

    expect(hashes.size).toBe(ids.length);
  });
});

describe('stableHashOrNull', () => {
  it('returns null for null', () => {
    expect(stableHashOrNull(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(stableHashOrNull(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(stableHashOrNull('')).toBeNull();
  });

  it('matches stableHash for a real value', () => {
    expect(stableHashOrNull('ChIJN1t_tDeuEmsRUsoyG83frY4')).toBe(
      stableHash('ChIJN1t_tDeuEmsRUsoyG83frY4')
    );
  });
});
