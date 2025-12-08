import {
  getCountryImage,
  hasCountryImage,
  getAvailableCountryCodes,
} from '../../assets/countryImages';

describe('countryImages', () => {
  describe('getCountryImage', () => {
    it('returns image for valid uppercase code', () => {
      const image = getCountryImage('US');
      expect(image).not.toBeNull();
    });

    it('returns image for valid lowercase code', () => {
      const image = getCountryImage('us');
      expect(image).not.toBeNull();
    });

    it('returns image for mixed case code', () => {
      const image = getCountryImage('Fr');
      expect(image).not.toBeNull();
    });

    it('returns null for invalid code', () => {
      const image = getCountryImage('XX');
      expect(image).toBeNull();
    });

    it('returns null for empty string', () => {
      const image = getCountryImage('');
      expect(image).toBeNull();
    });

    it('returns null for partial code', () => {
      const image = getCountryImage('U');
      expect(image).toBeNull();
    });
  });

  describe('hasCountryImage', () => {
    it('returns true for valid uppercase code', () => {
      expect(hasCountryImage('US')).toBe(true);
    });

    it('returns true for valid lowercase code', () => {
      expect(hasCountryImage('jp')).toBe(true);
    });

    it('returns false for invalid code', () => {
      expect(hasCountryImage('XX')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(hasCountryImage('')).toBe(false);
    });
  });

  describe('getAvailableCountryCodes', () => {
    it('returns an array', () => {
      const codes = getAvailableCountryCodes();
      expect(Array.isArray(codes)).toBe(true);
    });

    it('returns non-empty array', () => {
      const codes = getAvailableCountryCodes();
      expect(codes.length).toBeGreaterThan(0);
    });

    it('includes known country codes', () => {
      const codes = getAvailableCountryCodes();
      expect(codes).toContain('US');
      expect(codes).toContain('FR');
      expect(codes).toContain('JP');
      expect(codes).toContain('GB');
    });

    it('all codes are uppercase', () => {
      const codes = getAvailableCountryCodes();
      codes.forEach((code) => {
        expect(code).toBe(code.toUpperCase());
      });
    });

    it('all codes are valid (can retrieve image)', () => {
      const codes = getAvailableCountryCodes();
      codes.forEach((code) => {
        expect(hasCountryImage(code)).toBe(true);
      });
    });
  });
});
