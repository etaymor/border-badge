import { fireEvent, render, screen } from '../utils/testUtils';

import { OTPInput } from '@components/ui/OTPInput';

describe('OTPInput', () => {
  const defaultProps = {
    value: '',
    onChangeText: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('paste handling', () => {
    it('handles paste of full 6-digit OTP code', () => {
      const onChangeText = jest.fn();
      render(<OTPInput {...defaultProps} onChangeText={onChangeText} testID="otp" />);

      const firstCell = screen.getByTestId('otp-cell-0');
      fireEvent.changeText(firstCell, '123456');

      expect(onChangeText).toHaveBeenCalledWith('123456');
    });

    it('handles paste with non-numeric characters (filters to digits only)', () => {
      const onChangeText = jest.fn();
      render(<OTPInput {...defaultProps} onChangeText={onChangeText} testID="otp" />);

      const firstCell = screen.getByTestId('otp-cell-0');
      fireEvent.changeText(firstCell, '12-34-56');

      expect(onChangeText).toHaveBeenCalledWith('123456');
    });

    it('handles paste of partial codes (fills available digits)', () => {
      const onChangeText = jest.fn();
      render(<OTPInput {...defaultProps} onChangeText={onChangeText} testID="otp" />);

      const firstCell = screen.getByTestId('otp-cell-0');
      fireEvent.changeText(firstCell, '123');

      expect(onChangeText).toHaveBeenCalledWith('123');
    });

    it('truncates pasted codes longer than 6 digits', () => {
      const onChangeText = jest.fn();
      render(<OTPInput {...defaultProps} onChangeText={onChangeText} testID="otp" />);

      const firstCell = screen.getByTestId('otp-cell-0');
      fireEvent.changeText(firstCell, '12345678');

      expect(onChangeText).toHaveBeenCalledWith('123456');
    });
  });

  describe('single digit entry', () => {
    it('updates value correctly on single digit entry', () => {
      const onChangeText = jest.fn();
      render(<OTPInput {...defaultProps} onChangeText={onChangeText} testID="otp" />);

      const firstCell = screen.getByTestId('otp-cell-0');
      fireEvent.changeText(firstCell, '5');

      expect(onChangeText).toHaveBeenCalledWith('5');
    });

    it('filters out non-numeric characters on single entry', () => {
      const onChangeText = jest.fn();
      render(<OTPInput {...defaultProps} onChangeText={onChangeText} testID="otp" />);

      const firstCell = screen.getByTestId('otp-cell-0');
      fireEvent.changeText(firstCell, 'a');

      expect(onChangeText).toHaveBeenCalledWith('');
    });
  });

  describe('backspace handling', () => {
    it('clears current cell on backspace when cell has value', () => {
      const onChangeText = jest.fn();
      render(<OTPInput {...defaultProps} value="123" onChangeText={onChangeText} testID="otp" />);

      const thirdCell = screen.getByTestId('otp-cell-2');
      fireEvent(thirdCell, 'keyPress', { nativeEvent: { key: 'Backspace' } });

      expect(onChangeText).toHaveBeenCalledWith('12');
    });

    it('moves to previous cell and clears it when current cell is empty', () => {
      const onChangeText = jest.fn();
      render(<OTPInput {...defaultProps} value="12" onChangeText={onChangeText} testID="otp" />);

      // Third cell (index 2) is empty, backspace should clear second cell
      const thirdCell = screen.getByTestId('otp-cell-2');
      fireEvent(thirdCell, 'keyPress', { nativeEvent: { key: 'Backspace' } });

      expect(onChangeText).toHaveBeenCalledWith('1');
    });
  });

  describe('custom length', () => {
    it('respects custom length prop', () => {
      render(<OTPInput {...defaultProps} length={4} testID="otp" />);

      expect(screen.getByTestId('otp-cell-0')).toBeTruthy();
      expect(screen.getByTestId('otp-cell-1')).toBeTruthy();
      expect(screen.getByTestId('otp-cell-2')).toBeTruthy();
      expect(screen.getByTestId('otp-cell-3')).toBeTruthy();
      expect(screen.queryByTestId('otp-cell-4')).toBeNull();
    });
  });

  describe('error display', () => {
    it('displays error message when error prop is set', () => {
      render(<OTPInput {...defaultProps} error="Invalid code" testID="otp" />);

      expect(screen.getByText('Invalid code')).toBeTruthy();
    });
  });
});
