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

  describe('value prop changes', () => {
    it('uses fresh value for backspace after external value change', () => {
      const onChangeText = jest.fn();
      const { rerender } = render(
        <OTPInput value="123" onChangeText={onChangeText} testID="otp" />
      );

      // External update changes value to "12345"
      rerender(<OTPInput value="12345" onChangeText={onChangeText} testID="otp" />);

      // Now backspace on 6th cell (index 5, which is empty)
      // Should clear the 5th cell (digit "5") using fresh value, not stale "123"
      const sixthCell = screen.getByTestId('otp-cell-5');
      fireEvent(sixthCell, 'keyPress', { nativeEvent: { key: 'Backspace' } });

      // Should result in "1234" (cleared the 5 from position 4)
      expect(onChangeText).toHaveBeenLastCalledWith('1234');
    });

    it('correctly handles consecutive backspaces with value updates', () => {
      const onChangeText = jest.fn();
      const { rerender } = render(
        <OTPInput value="123456" onChangeText={onChangeText} testID="otp" />
      );

      // First backspace on last cell
      const sixthCell = screen.getByTestId('otp-cell-5');
      fireEvent(sixthCell, 'keyPress', { nativeEvent: { key: 'Backspace' } });
      expect(onChangeText).toHaveBeenLastCalledWith('12345');

      // Simulate parent updating value after our callback
      rerender(<OTPInput value="12345" onChangeText={onChangeText} testID="otp" />);

      // Second backspace - should use updated value "12345"
      const fifthCell = screen.getByTestId('otp-cell-4');
      fireEvent(fifthCell, 'keyPress', { nativeEvent: { key: 'Backspace' } });
      expect(onChangeText).toHaveBeenLastCalledWith('1234');
    });
  });
});
