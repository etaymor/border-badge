import { validateEmail } from '@utils/emailValidation';

describe('emailValidation', () => {
  describe('validateEmail', () => {
    describe('valid emails', () => {
      it('returns valid for standard email format', () => {
        const result = validateEmail('test@example.com');
        expect(result.isValid).toBe(true);
        expect(result.error).toBeUndefined();
        expect(result.normalizedEmail).toBe('test@example.com');
      });

      it('returns valid for email with subdomain', () => {
        const result = validateEmail('user@mail.example.com');
        expect(result.isValid).toBe(true);
        expect(result.normalizedEmail).toBe('user@mail.example.com');
      });

      it('returns valid for email with plus sign', () => {
        const result = validateEmail('user+tag@example.com');
        expect(result.isValid).toBe(true);
        expect(result.normalizedEmail).toBe('user+tag@example.com');
      });

      it('returns valid for email with dots in local part', () => {
        const result = validateEmail('first.last@example.com');
        expect(result.isValid).toBe(true);
        expect(result.normalizedEmail).toBe('first.last@example.com');
      });

      it('returns valid for email with numbers', () => {
        const result = validateEmail('user123@example456.com');
        expect(result.isValid).toBe(true);
        expect(result.normalizedEmail).toBe('user123@example456.com');
      });
    });

    describe('invalid emails', () => {
      it('returns invalid for email without @', () => {
        const result = validateEmail('testexample.com');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Please enter a valid email address');
        expect(result.normalizedEmail).toBeUndefined();
      });

      it('returns invalid for email without domain', () => {
        const result = validateEmail('test@');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Please enter a valid email address');
      });

      it('returns invalid for email without local part', () => {
        const result = validateEmail('@example.com');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Please enter a valid email address');
      });

      it('returns invalid for email without TLD', () => {
        const result = validateEmail('test@example');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Please enter a valid email address');
      });

      it('returns invalid for email with spaces', () => {
        const result = validateEmail('test @example.com');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Please enter a valid email address');
      });

      it('returns invalid for email with multiple @', () => {
        const result = validateEmail('test@@example.com');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Please enter a valid email address');
      });

      it('returns invalid for single-char TLD', () => {
        const result = validateEmail('test@example.c');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Please enter a valid email address');
      });

      it('returns invalid for numeric TLD', () => {
        const result = validateEmail('test@example.123');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Please enter a valid email address');
      });

      it('returns invalid for domain starting with hyphen', () => {
        const result = validateEmail('test@-example.com');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Please enter a valid email address');
      });

      it('returns invalid for consecutive dots in local part', () => {
        const result = validateEmail('user..name@example.com');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Please enter a valid email address');
      });

      it('returns invalid for multiple consecutive dots in local part', () => {
        const result = validateEmail('user...name@example.com');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Please enter a valid email address');
      });

      it('returns invalid for email exceeding max length (320 chars)', () => {
        // Create an email that exceeds 320 characters using many subdomains
        // Each "subdomain." is 10 chars, 33 of them = 330 chars + test@ (5) + example.com (11) = 346 chars
        const longDomain = Array(33).fill('subdomain').join('.') + '.example.com';
        const email = `test@${longDomain}`;
        expect(email.length).toBeGreaterThan(320); // Verify test setup
        const result = validateEmail(email);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Email address is too long');
      });
    });

    describe('empty input', () => {
      it('returns invalid for empty string', () => {
        const result = validateEmail('');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Please enter your email address');
        expect(result.normalizedEmail).toBeUndefined();
      });

      it('returns invalid for null-ish values', () => {
        // @ts-expect-error - testing runtime behavior
        const result = validateEmail(null);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Please enter your email address');
      });

      it('returns invalid for undefined', () => {
        // @ts-expect-error - testing runtime behavior
        const result = validateEmail(undefined);
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Please enter your email address');
      });
    });

    describe('whitespace handling', () => {
      it('returns invalid for whitespace-only string', () => {
        const result = validateEmail('   ');
        expect(result.isValid).toBe(false);
        expect(result.error).toBe('Please enter your email address');
      });

      it('trims leading and trailing whitespace', () => {
        const result = validateEmail('  test@example.com  ');
        expect(result.isValid).toBe(true);
        expect(result.normalizedEmail).toBe('test@example.com');
      });

      it('trims tabs and newlines', () => {
        const result = validateEmail('\ttest@example.com\n');
        expect(result.isValid).toBe(true);
        expect(result.normalizedEmail).toBe('test@example.com');
      });
    });

    describe('normalization', () => {
      it('converts email to lowercase', () => {
        const result = validateEmail('Test@EXAMPLE.COM');
        expect(result.isValid).toBe(true);
        expect(result.normalizedEmail).toBe('test@example.com');
      });

      it('converts mixed case email to lowercase', () => {
        const result = validateEmail('UsEr@ExAmPlE.CoM');
        expect(result.isValid).toBe(true);
        expect(result.normalizedEmail).toBe('user@example.com');
      });
    });
  });
});
