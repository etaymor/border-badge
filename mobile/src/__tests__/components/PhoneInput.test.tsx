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
});
