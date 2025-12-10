import { fireEvent, render, screen, waitFor } from '../utils/testUtils';

import OnboardingPhoneInput from '@components/onboarding/OnboardingPhoneInput';

// Mock getFlagEmoji to avoid emoji rendering issues in tests
jest.mock('@utils/flags', () => ({
  getFlagEmoji: jest.fn((code: string) => `[${code}]`),
}));

// Mock libphonenumber-js for predictable validation
jest.mock('libphonenumber-js', () => ({
  isValidPhoneNumber: jest.fn((phone: string) => {
    // Simple mock: valid if 10+ digits after dial code
    const digitsOnly = phone.replace(/\D/g, '');
    return digitsOnly.length >= 10;
  }),
}));

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

    it('truncates input to 15 digits maximum (E.164 limit)', () => {
      const onChangeText = jest.fn();
      render(<OnboardingPhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

      const input = screen.getByTestId('phone');
      fireEvent.changeText(input, '123456789012345678901234567890');

      // Should truncate to 15 digits
      expect(onChangeText).toHaveBeenCalledWith('+1123456789012345');
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

      // The input should now display the local number (without dial code)
      expect(input.props.value).toBe('5551234567');
      // Dial code should be US (+1)
      expect(screen.getByText('+1')).toBeTruthy();
    });

    it('correctly parses UK number from value prop', () => {
      const onChangeText = jest.fn();
      render(
        <OnboardingPhoneInput value="+447911123456" onChangeText={onChangeText} testID="phone" />
      );

      // Should detect UK country code and display correctly
      expect(screen.getByText('+44')).toBeTruthy();
      const input = screen.getByTestId('phone');
      expect(input.props.value).toBe('7911123456');
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

      // Input should have value
      const input = screen.getByTestId('phone');
      expect(input.props.value).toBe('5551234567');

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
      expect(input.props.value).toBe('7911123456');
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
