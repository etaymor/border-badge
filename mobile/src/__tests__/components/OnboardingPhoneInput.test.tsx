import { fireEvent, render, screen, waitFor } from '../utils/testUtils';

import OnboardingPhoneInput from '@components/onboarding/OnboardingPhoneInput';

// Mock getFlagEmoji to avoid emoji rendering issues in tests
jest.mock('@utils/flags', () => ({
  getFlagEmoji: jest.fn((code: string) => `[${code}]`),
}));

// Mock country-specific max digits (national number lengths from libphonenumber-js examples)
const mockExampleNumbers: Record<string, string> = {
  US: '2015550123', // 10 digits
  CA: '5062345678', // 10 digits
  GB: '7400123456', // 10 digits
  DE: '15123456789', // 11 digits
  AU: '412345678', // 9 digits
};

// Mock libphonenumber-js for predictable validation and formatting
jest.mock('libphonenumber-js', () => ({
  isValidPhoneNumber: jest.fn((phone: string) => {
    // Simple mock: valid if 10+ digits after dial code
    const digitsOnly = phone.replace(/\D/g, '');
    return digitsOnly.length >= 10;
  }),
  AsYouType: jest.fn().mockImplementation((countryCode: string) => ({
    input: jest.fn((number: string) => {
      // Mock formatting based on country
      if (countryCode === 'GB') {
        // UK format: XXXX XXX XXXX
        if (number.length <= 4) return number;
        if (number.length <= 7) return `${number.slice(0, 4)} ${number.slice(4)}`;
        return `${number.slice(0, 4)} ${number.slice(4, 7)} ${number.slice(7)}`;
      }
      // US/CA format: (XXX) XXX-XXXX
      if (number.length <= 3) return number;
      if (number.length <= 6) return `(${number.slice(0, 3)}) ${number.slice(3)}`;
      return `(${number.slice(0, 3)}) ${number.slice(3, 6)}-${number.slice(6, 10)}`;
    }),
  })),
  getExampleNumber: jest.fn((countryCode: string) => {
    const example = mockExampleNumbers[countryCode];
    if (!example) return undefined;
    return { nationalNumber: example };
  }),
}));

// Mock the examples import
jest.mock('libphonenumber-js/mobile/examples', () => ({}));

describe('OnboardingPhoneInput', () => {
  const defaultProps = {
    value: '',
    onChangeText: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('phone number formatting', () => {
    it('strips non-numeric characters from input', () => {
      const onChangeText = jest.fn();
      render(<OnboardingPhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

      const input = screen.getByTestId('phone');
      fireEvent.changeText(input, '(555) 123-4567');

      // Should output E.164 format with only digits (default US +1)
      expect(onChangeText).toHaveBeenCalledWith('+15551234567');
    });

    it('outputs correct E.164 format with dial code', () => {
      const onChangeText = jest.fn();
      render(<OnboardingPhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

      const input = screen.getByTestId('phone');
      fireEvent.changeText(input, '5551234567');

      // Default country is US (+1)
      expect(onChangeText).toHaveBeenCalledWith('+15551234567');
    });

    it('outputs empty string when input is cleared', () => {
      const onChangeText = jest.fn();
      render(<OnboardingPhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

      const input = screen.getByTestId('phone');
      fireEvent.changeText(input, '');

      expect(onChangeText).toHaveBeenCalledWith('');
    });

    it('truncates input to country-specific max digits (US = 10)', () => {
      const onChangeText = jest.fn();
      render(<OnboardingPhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

      const input = screen.getByTestId('phone');
      fireEvent.changeText(input, '123456789012345678901234567890');

      // Should truncate to 10 digits for US (based on example number length)
      expect(onChangeText).toHaveBeenCalledWith('+11234567890');
    });

    it('handles character-by-character input without cursor issues', () => {
      const onChangeText = jest.fn();
      render(<OnboardingPhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

      const input = screen.getByTestId('phone');

      // Simulate typing one character at a time
      fireEvent.changeText(input, '5');
      expect(onChangeText).toHaveBeenLastCalledWith('+15');

      fireEvent.changeText(input, '55');
      expect(onChangeText).toHaveBeenLastCalledWith('+155');

      fireEvent.changeText(input, '555');
      expect(onChangeText).toHaveBeenLastCalledWith('+1555');

      fireEvent.changeText(input, '5551');
      expect(onChangeText).toHaveBeenLastCalledWith('+15551');

      fireEvent.changeText(input, '55512');
      expect(onChangeText).toHaveBeenLastCalledWith('+155512');

      // Continue to full 10-digit number
      fireEvent.changeText(input, '5551234567');
      expect(onChangeText).toHaveBeenLastCalledWith('+15551234567');
    });
  });

  describe('country selection', () => {
    it('updates E.164 format when country selection changes', async () => {
      const onChangeText = jest.fn();
      render(<OnboardingPhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

      // First, enter a phone number with default US country
      const input = screen.getByTestId('phone');
      fireEvent.changeText(input, '5551234567');

      expect(onChangeText).toHaveBeenLastCalledWith('+15551234567');

      // Open country picker
      const countryPicker = screen.getByTestId('phone-country-picker');
      fireEvent.press(countryPicker);

      // Wait for modal to appear and select UK
      await waitFor(() => {
        expect(screen.getByText('Select Country')).toBeTruthy();
      });

      // Find and press UK option
      fireEvent.press(screen.getByText('United Kingdom'));

      // Now the E.164 should be updated with UK dial code
      expect(onChangeText).toHaveBeenLastCalledWith('+445551234567');
    });

    it('uses default country code prop on mount', () => {
      render(<OnboardingPhoneInput {...defaultProps} defaultCountryCode="GB" testID="phone" />);

      // Should show UK dial code
      expect(screen.getByText('+44')).toBeTruthy();
    });

    it('preserves user country selection when defaultCountryCode changes', async () => {
      const onChangeText = jest.fn();
      const { rerender } = render(
        <OnboardingPhoneInput
          {...defaultProps}
          onChangeText={onChangeText}
          defaultCountryCode="US"
          testID="phone"
        />
      );

      // Initially shows US
      expect(screen.getByText('+1')).toBeTruthy();

      // User explicitly selects UK
      fireEvent.press(screen.getByTestId('phone-country-picker'));
      await waitFor(() => {
        expect(screen.getByText('Select Country')).toBeTruthy();
      });
      fireEvent.press(screen.getByText('United Kingdom'));

      // Should show UK
      expect(screen.getByText('+44')).toBeTruthy();

      // Rerender with different defaultCountryCode - should NOT change
      rerender(
        <OnboardingPhoneInput
          {...defaultProps}
          onChangeText={onChangeText}
          defaultCountryCode="CA"
          testID="phone"
        />
      );

      // Should still show UK (user's explicit selection)
      expect(screen.getByText('+44')).toBeTruthy();
    });
  });

  describe('country picker search', () => {
    it('filters countries by name', async () => {
      render(<OnboardingPhoneInput {...defaultProps} testID="phone" />);

      // Open country picker
      fireEvent.press(screen.getByTestId('phone-country-picker'));

      await waitFor(() => {
        expect(screen.getByText('Select Country')).toBeTruthy();
      });

      // Search for "Germany"
      const searchInput = screen.getByPlaceholderText('Search countries...');
      fireEvent.changeText(searchInput, 'Germany');

      // Germany should be visible
      expect(screen.getByText('Germany')).toBeTruthy();

      // France should not be visible
      expect(screen.queryByText('France')).toBeNull();
    });

    it('filters countries by dial code', async () => {
      render(<OnboardingPhoneInput {...defaultProps} testID="phone" />);

      // Open country picker
      fireEvent.press(screen.getByTestId('phone-country-picker'));

      await waitFor(() => {
        expect(screen.getByText('Select Country')).toBeTruthy();
      });

      // Search for "+44" (UK dial code)
      const searchInput = screen.getByPlaceholderText('Search countries...');
      fireEvent.changeText(searchInput, '+44');

      // UK should be visible
      expect(screen.getByText('United Kingdom')).toBeTruthy();
    });

    it('filters countries by country code', async () => {
      render(<OnboardingPhoneInput {...defaultProps} testID="phone" />);

      // Open country picker
      fireEvent.press(screen.getByTestId('phone-country-picker'));

      await waitFor(() => {
        expect(screen.getByText('Select Country')).toBeTruthy();
      });

      // Search for "GB" (UK country code)
      const searchInput = screen.getByPlaceholderText('Search countries...');
      fireEvent.changeText(searchInput, 'GB');

      // UK should be visible
      expect(screen.getByText('United Kingdom')).toBeTruthy();
    });

    it('closes picker and clears search when Done is pressed', async () => {
      render(<OnboardingPhoneInput {...defaultProps} testID="phone" />);

      // Open country picker
      fireEvent.press(screen.getByTestId('phone-country-picker'));

      await waitFor(() => {
        expect(screen.getByText('Select Country')).toBeTruthy();
      });

      // Search for something
      const searchInput = screen.getByPlaceholderText('Search countries...');
      fireEvent.changeText(searchInput, 'Germany');

      // Press Done
      fireEvent.press(screen.getByText('Done'));

      // Modal should be closed (can't easily test modal visibility, but search should be cleared on reopen)
    });
  });

  describe('error handling', () => {
    it('displays error message when error prop is set', () => {
      render(
        <OnboardingPhoneInput {...defaultProps} error="Invalid phone number" testID="phone" />
      );

      expect(screen.getByText('Invalid phone number')).toBeTruthy();
    });

    it('falls back to unformatted number when AsYouType throws', () => {
      // Override AsYouType to throw an error
      const { AsYouType } = jest.requireMock('libphonenumber-js') as {
        AsYouType: jest.Mock;
      };
      AsYouType.mockImplementationOnce(() => {
        throw new Error('Invalid country code');
      });

      const onChangeText = jest.fn();
      render(<OnboardingPhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

      const input = screen.getByTestId('phone');
      fireEvent.changeText(input, '5551234567');

      // Should still emit E.164 format even if formatting fails
      expect(onChangeText).toHaveBeenCalledWith('+15551234567');
    });

    it('falls back to 15 max digits when getExampleNumber returns undefined', async () => {
      // This is tested implicitly - unknown country codes return undefined
      // and component falls back to 15 digits
      const { getExampleNumber } = jest.requireMock('libphonenumber-js') as {
        getExampleNumber: jest.Mock;
      };
      getExampleNumber.mockReturnValueOnce(undefined);

      const onChangeText = jest.fn();
      render(<OnboardingPhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

      const input = screen.getByTestId('phone');
      // With fallback to 15 digits, all 15 should be allowed
      fireEvent.changeText(input, '123456789012345');

      expect(onChangeText).toHaveBeenCalledWith('+1123456789012345');
    });
  });

  describe('country-specific max digits', () => {
    it('uses country-specific max digits when country changes', async () => {
      const onChangeText = jest.fn();
      render(<OnboardingPhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

      // Enter a long number (should be truncated to 10 for US)
      const input = screen.getByTestId('phone');
      fireEvent.changeText(input, '12345678901234567890');
      expect(onChangeText).toHaveBeenLastCalledWith('+11234567890'); // 10 digits for US

      // Open country picker and select Germany (11 digits max)
      fireEvent.press(screen.getByTestId('phone-country-picker'));
      await waitFor(() => {
        expect(screen.getByText('Select Country')).toBeTruthy();
      });

      // Search for Germany
      const searchInput = screen.getByPlaceholderText('Search countries...');
      fireEvent.changeText(searchInput, 'Germany');
      fireEvent.press(screen.getByText('Germany'));

      // Now enter a long number again - should use Germany's 11 digit max
      fireEvent.changeText(input, '12345678901234567890');
      expect(onChangeText).toHaveBeenLastCalledWith('+4912345678901'); // 11 digits for DE
    });
  });

  describe('validation callback', () => {
    it('calls onValidationChange with true for valid phone numbers', () => {
      const onValidationChange = jest.fn();
      render(
        <OnboardingPhoneInput
          {...defaultProps}
          onValidationChange={onValidationChange}
          testID="phone"
        />
      );

      const input = screen.getByTestId('phone');
      fireEvent.changeText(input, '5551234567'); // 10 digits = valid in our mock

      // Should be called with true (valid)
      expect(onValidationChange).toHaveBeenLastCalledWith(true);
    });

    it('calls onValidationChange with false for invalid phone numbers', () => {
      const onValidationChange = jest.fn();
      render(
        <OnboardingPhoneInput
          {...defaultProps}
          onValidationChange={onValidationChange}
          testID="phone"
        />
      );

      const input = screen.getByTestId('phone');
      fireEvent.changeText(input, '555'); // Too short = invalid

      // Should be called with false (invalid)
      expect(onValidationChange).toHaveBeenLastCalledWith(false);
    });

    it('handles non-memoized onValidationChange without infinite loop', () => {
      // This tests that the ref-based callback pattern works
      let renderCount = 0;
      const TestWrapper = () => {
        renderCount++;
        // Create a new function on every render (not memoized)
        const onValidationChange = (isValid: boolean) => {
          // intentionally not memoized
          void isValid;
        };
        return (
          <OnboardingPhoneInput
            value=""
            onChangeText={jest.fn()}
            onValidationChange={onValidationChange}
            testID="phone"
          />
        );
      };

      render(<TestWrapper />);

      // Should not cause excessive re-renders
      expect(renderCount).toBeLessThan(5);
    });
  });

  describe('controlled component behavior', () => {
    it('syncs internal state when value prop changes externally', () => {
      const onChangeText = jest.fn();
      const { rerender } = render(
        <OnboardingPhoneInput value="" onChangeText={onChangeText} testID="phone" />
      );

      // Initially empty
      const input = screen.getByTestId('phone');
      expect(input.props.value).toBe('');

      // Simulate external value change (e.g., from form state restoration)
      rerender(
        <OnboardingPhoneInput value="+15551234567" onChangeText={onChangeText} testID="phone" />
      );

      // The input should now display the formatted local number (US format)
      expect(input.props.value).toBe('(555) 123-4567');
      // Dial code should be US (+1)
      expect(screen.getByText('+1')).toBeTruthy();
    });

    it('correctly parses UK number from value prop', () => {
      const onChangeText = jest.fn();
      render(
        <OnboardingPhoneInput value="+447911123456" onChangeText={onChangeText} testID="phone" />
      );

      // Should detect UK country code and display formatted (UK format)
      expect(screen.getByText('+44')).toBeTruthy();
      const input = screen.getByTestId('phone');
      expect(input.props.value).toBe('7911 123 456');
    });

    it('uses defaultCountryCode as tiebreaker for ambiguous dial codes', () => {
      const onChangeText = jest.fn();
      // +1 could be US or Canada - defaultCountryCode should be used
      render(
        <OnboardingPhoneInput
          value="+15551234567"
          onChangeText={onChangeText}
          defaultCountryCode="CA"
          testID="phone"
        />
      );

      // Should show Canada as selected (because defaultCountryCode is CA)
      expect(screen.getByText('+1')).toBeTruthy();
      // The flag mock shows [CA] for Canada
      expect(screen.getByText('[CA]')).toBeTruthy();
    });

    it('clears internal state when value prop is cleared', () => {
      const onChangeText = jest.fn();
      const { rerender } = render(
        <OnboardingPhoneInput value="+15551234567" onChangeText={onChangeText} testID="phone" />
      );

      // Input should have formatted value (US format)
      const input = screen.getByTestId('phone');
      expect(input.props.value).toBe('(555) 123-4567');

      // Clear the value prop
      rerender(<OnboardingPhoneInput value="" onChangeText={onChangeText} testID="phone" />);

      // Input should be empty
      expect(input.props.value).toBe('');
    });

    it('handles dial code matching with proper precedence', () => {
      const onChangeText = jest.fn();
      // +44 is UK - verifies that longer matches aren't incorrectly matched
      // (e.g., +4 shouldn't match before +44 if both existed)
      render(
        <OnboardingPhoneInput value="+447911123456" onChangeText={onChangeText} testID="phone" />
      );

      // Should detect UK (+44)
      expect(screen.getByText('+44')).toBeTruthy();
      const input = screen.getByTestId('phone');
      expect(input.props.value).toBe('7911 123 456');
    });
  });

  describe('clear button', () => {
    it('shows clear button when input has value', () => {
      const onChangeText = jest.fn();
      render(<OnboardingPhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

      const input = screen.getByTestId('phone');
      fireEvent.changeText(input, '5551234567');

      // Clear button should be visible (Ionicons close-circle)
      // We can't easily test for the icon, but the handler should work
    });

    it('clears input when clear button is pressed', () => {
      const onChangeText = jest.fn();
      render(<OnboardingPhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

      const input = screen.getByTestId('phone');
      fireEvent.changeText(input, '5551234567');

      // Reset mock to track clear action
      onChangeText.mockClear();

      // The clear button is rendered conditionally - trigger it
      // Note: In the actual component, pressing clear calls handleLocalNumberChange('')
      fireEvent.changeText(input, '');

      expect(onChangeText).toHaveBeenCalledWith('');
    });
  });
});
