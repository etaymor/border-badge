import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  validateDisplayName,
} from '@utils/displayNameValidation';

describe('displayNameValidation', () => {
  describe('constants', () => {
    it('has correct min length', () => {
      expect(DISPLAY_NAME_MIN_LENGTH).toBe(2);
    });

    it('has correct max length', () => {
      expect(DISPLAY_NAME_MAX_LENGTH).toBe(50);
    });
  });

  describe('validateDisplayName', () => {
    it('returns invalid for empty string', () => {
      const result = validateDisplayName('');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Please enter your name');
      expect(result.trimmedValue).toBe('');
    });

    it('returns invalid for whitespace-only string', () => {
      const result = validateDisplayName('   ');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Please enter your name');
      expect(result.trimmedValue).toBe('');
    });

    it('returns invalid for single character', () => {
      const result = validateDisplayName('A');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Name must be at least 2 characters');
      expect(result.trimmedValue).toBe('A');
    });

    it('returns valid for exactly 2 characters', () => {
      const result = validateDisplayName('AB');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.trimmedValue).toBe('AB');
    });

    it('returns valid for exactly 50 characters', () => {
      const name = 'A'.repeat(50);
      const result = validateDisplayName(name);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.trimmedValue).toBe(name);
    });

    it('returns invalid for 51 characters', () => {
      const name = 'A'.repeat(51);
      const result = validateDisplayName(name);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Name must be 50 characters or less');
      expect(result.trimmedValue).toBe(name);
    });

    it('trims whitespace from input', () => {
      const result = validateDisplayName('  John Doe  ');
      expect(result.isValid).toBe(true);
      expect(result.trimmedValue).toBe('John Doe');
    });

    it('validates after trimming - whitespace plus single char', () => {
      const result = validateDisplayName('  A  ');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Name must be at least 2 characters');
      expect(result.trimmedValue).toBe('A');
    });

    it('returns valid for typical names', () => {
      const names = ['John', 'Jane Doe', 'María García', 'Li Wei', '日本語の名前'];

      names.forEach((name) => {
        const result = validateDisplayName(name);
        expect(result.isValid).toBe(true);
        expect(result.trimmedValue).toBe(name);
      });
    });
  });
});
