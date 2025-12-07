import { fireEvent, render, screen, waitFor } from '../utils/testUtils';

import { PhoneInput } from '@components/ui/PhoneInput';

// Mock getFlagEmoji to avoid emoji rendering issues in tests
jest.mock('@utils/flags', () => ({
  getFlagEmoji: jest.fn((code: string) => `[${code}]`),
}));

describe('PhoneInput', () => {
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
      render(<PhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

      const input = screen.getByTestId('phone');
      fireEvent.changeText(input, '(555) 123-4567');

      // Should output E.164 format with only digits (default US +1)
      expect(onChangeText).toHaveBeenCalledWith('+15551234567');
    });

    it('outputs correct E.164 format with dial code', () => {
      const onChangeText = jest.fn();
      render(<PhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

      const input = screen.getByTestId('phone');
      fireEvent.changeText(input, '5551234567');

      // Default country is US (+1)
      expect(onChangeText).toHaveBeenCalledWith('+15551234567');
    });

    it('outputs empty string when input is cleared', () => {
      const onChangeText = jest.fn();
      render(<PhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

      const input = screen.getByTestId('phone');
      fireEvent.changeText(input, '');

      expect(onChangeText).toHaveBeenCalledWith('');
    });
  });

  describe('country selection', () => {
    it('updates E.164 format when country selection changes', async () => {
      const onChangeText = jest.fn();
      render(<PhoneInput {...defaultProps} onChangeText={onChangeText} testID="phone" />);

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
      render(<PhoneInput {...defaultProps} defaultCountryCode="GB" testID="phone" />);

      // Should show UK dial code
      expect(screen.getByText('+44')).toBeTruthy();
    });
  });

  describe('country picker search', () => {
    it('filters countries by name', async () => {
      render(<PhoneInput {...defaultProps} testID="phone" />);

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
      render(<PhoneInput {...defaultProps} testID="phone" />);

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
      render(<PhoneInput {...defaultProps} testID="phone" />);

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
  });

  describe('error handling', () => {
    it('displays error message when error prop is set', () => {
      render(<PhoneInput {...defaultProps} error="Invalid phone number" testID="phone" />);

      expect(screen.getByText('Invalid phone number')).toBeTruthy();
    });
  });

  describe('controlled component behavior', () => {
    it('syncs internal state when value prop changes externally', () => {
      const onChangeText = jest.fn();
      const { rerender } = render(
        <PhoneInput value="" onChangeText={onChangeText} testID="phone" />
      );

      // Initially empty
      const input = screen.getByTestId('phone');
      expect(input.props.value).toBe('');

      // Simulate external value change (e.g., from form state restoration)
      rerender(<PhoneInput value="+15551234567" onChangeText={onChangeText} testID="phone" />);

      // The input should now display the formatted local number
      // Note: formatForDisplay adds spaces, so "5551234567" becomes "555 123 4567"
      expect(input.props.value).toBe('555 123 4567');
      // Dial code should be US (+1)
      expect(screen.getByText('+1')).toBeTruthy();
    });

    it('correctly parses UK number from value prop', () => {
      const onChangeText = jest.fn();
      render(<PhoneInput value="+447911123456" onChangeText={onChangeText} testID="phone" />);

      // Should detect UK country code and display correctly
      expect(screen.getByText('+44')).toBeTruthy();
      const input = screen.getByTestId('phone');
      // formatForDisplay uses US pattern: "791 112 3456"
      expect(input.props.value).toBe('791 112 3456');
    });

    it('uses defaultCountryCode as tiebreaker for ambiguous dial codes', () => {
      const onChangeText = jest.fn();
      // +1 could be US or Canada - defaultCountryCode should be used
      render(
        <PhoneInput
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
        <PhoneInput value="+15551234567" onChangeText={onChangeText} testID="phone" />
      );

      // Input should have value
      const input = screen.getByTestId('phone');
      expect(input.props.value).toBe('555 123 4567');

      // Clear the value prop
      rerender(<PhoneInput value="" onChangeText={onChangeText} testID="phone" />);

      // Input should be empty
      expect(input.props.value).toBe('');
    });
  });
});
