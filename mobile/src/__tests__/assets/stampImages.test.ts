import { getStampImage, hasStampImage, getAvailableStampCodes } from '../../assets/stampImages';

describe('stampImages', () => {
  describe('getStampImage', () => {
    it('returns image for valid uppercase code', () => {
      const image = getStampImage('US');
      expect(image).not.toBeNull();
    });

    it('returns image for valid lowercase code', () => {
      const image = getStampImage('us');
      expect(image).not.toBeNull();
    });

    it('returns image for mixed case code', () => {
      const image = getStampImage('Fr');
      expect(image).not.toBeNull();
    });

    it('returns null for invalid code', () => {
      const image = getStampImage('XX');
      expect(image).toBeNull();
    });

    it('returns null for empty string', () => {
      const image = getStampImage('');
      expect(image).toBeNull();
    });

    it('returns null for partial code', () => {
      const image = getStampImage('U');
      expect(image).toBeNull();
    });
  });

  describe('hasStampImage', () => {
    it('returns true for valid uppercase code', () => {
      expect(hasStampImage('US')).toBe(true);
    });

    it('returns true for valid lowercase code', () => {
      expect(hasStampImage('jp')).toBe(true);
    });

    it('returns false for invalid code', () => {
      expect(hasStampImage('XX')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(hasStampImage('')).toBe(false);
    });
  });

  describe('getAvailableStampCodes', () => {
    it('returns an array', () => {
      const codes = getAvailableStampCodes();
      expect(Array.isArray(codes)).toBe(true);
    });

    it('returns non-empty array', () => {
      const codes = getAvailableStampCodes();
      expect(codes.length).toBeGreaterThan(0);
    });

    it('includes known country codes', () => {
      const codes = getAvailableStampCodes();
      expect(codes).toContain('US');
      expect(codes).toContain('FR');
      expect(codes).toContain('JP');
      expect(codes).toContain('GB');
    });

    it('all codes are uppercase', () => {
      const codes = getAvailableStampCodes();
      codes.forEach((code) => {
        expect(code).toBe(code.toUpperCase());
      });
    });

    it('all codes are valid (can retrieve image)', () => {
      const codes = getAvailableStampCodes();
      codes.forEach((code) => {
        expect(hasStampImage(code)).toBe(true);
      });
    });
  });
});
