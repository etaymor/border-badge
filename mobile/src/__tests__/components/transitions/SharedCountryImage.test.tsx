import { fireEvent, render, screen } from '../../utils/testUtils';

import {
  SharedCountryImage,
  SharedCountryPressable,
  getCountrySharedTag,
} from '@components/transitions/SharedCountryImage';
import { Text, View } from 'react-native';

describe('SharedCountryImage', () => {
  describe('getCountrySharedTag', () => {
    it('generates correct tag for country code', () => {
      expect(getCountrySharedTag('US')).toBe('country-US');
      expect(getCountrySharedTag('FR')).toBe('country-FR');
      expect(getCountrySharedTag('JP')).toBe('country-JP');
    });

    it('handles lowercase codes', () => {
      expect(getCountrySharedTag('us')).toBe('country-us');
    });
  });

  describe('SharedCountryImage', () => {
    it('renders children correctly', () => {
      render(
        <SharedCountryImage countryId="US" testID="shared-image">
          <Text testID="child-text">Test Content</Text>
        </SharedCountryImage>
      );

      expect(screen.getByTestId('shared-image')).toBeTruthy();
      expect(screen.getByTestId('child-text')).toBeTruthy();
      expect(screen.getByText('Test Content')).toBeTruthy();
    });

    it('applies custom style', () => {
      const customStyle = { backgroundColor: 'red', padding: 10 };
      render(
        <SharedCountryImage countryId="FR" style={customStyle} testID="styled-image">
          <View />
        </SharedCountryImage>
      );

      const element = screen.getByTestId('styled-image');
      const flatStyle = Array.isArray(element.props.style)
        ? element.props.style.flat()
        : [element.props.style];
      const hasCustomStyle = flatStyle.some(
        (s: Record<string, unknown>) => s?.backgroundColor === 'red' && s?.padding === 10
      );
      expect(hasCustomStyle).toBe(true);
    });

    it('renders with different country IDs', () => {
      const { rerender } = render(
        <SharedCountryImage countryId="US" testID="test-element">
          <View />
        </SharedCountryImage>
      );
      expect(screen.getByTestId('test-element')).toBeTruthy();

      rerender(
        <SharedCountryImage countryId="JP" testID="test-element">
          <View />
        </SharedCountryImage>
      );
      expect(screen.getByTestId('test-element')).toBeTruthy();
    });
  });

  describe('SharedCountryPressable', () => {
    it('renders children correctly', () => {
      render(
        <SharedCountryPressable countryId="US" testID="shared-pressable">
          <Text testID="child-text">Pressable Content</Text>
        </SharedCountryPressable>
      );

      expect(screen.getByTestId('shared-pressable')).toBeTruthy();
      expect(screen.getByTestId('child-text')).toBeTruthy();
      expect(screen.getByText('Pressable Content')).toBeTruthy();
    });

    it('calls onPress handler when pressed', () => {
      const onPressMock = jest.fn();
      render(
        <SharedCountryPressable countryId="FR" testID="pressable" onPress={onPressMock}>
          <Text>Press Me</Text>
        </SharedCountryPressable>
      );

      fireEvent.press(screen.getByTestId('pressable'));
      expect(onPressMock).toHaveBeenCalledTimes(1);
    });

    it('calls onLongPress handler when long pressed', () => {
      const onLongPressMock = jest.fn();
      render(
        <SharedCountryPressable countryId="JP" testID="pressable" onLongPress={onLongPressMock}>
          <Text>Long Press Me</Text>
        </SharedCountryPressable>
      );

      fireEvent(screen.getByTestId('pressable'), 'longPress');
      expect(onLongPressMock).toHaveBeenCalledTimes(1);
    });

    it('applies custom style', () => {
      const customStyle = { margin: 20, borderRadius: 8 };
      render(
        <SharedCountryPressable countryId="DE" style={customStyle} testID="styled-pressable">
          <View />
        </SharedCountryPressable>
      );

      const element = screen.getByTestId('styled-pressable');
      const flatStyle = Array.isArray(element.props.style)
        ? element.props.style.flat()
        : [element.props.style];
      const hasCustomStyle = flatStyle.some(
        (s: Record<string, unknown>) => s?.margin === 20 && s?.borderRadius === 8
      );
      expect(hasCustomStyle).toBe(true);
    });

    it('passes accessibility props correctly', () => {
      render(
        <SharedCountryPressable
          countryId="IT"
          testID="accessible-pressable"
          accessibilityRole="button"
          accessibilityLabel="View Italy details"
        >
          <Text>Italy</Text>
        </SharedCountryPressable>
      );

      const element = screen.getByTestId('accessible-pressable');
      expect(element.props.accessibilityRole).toBe('button');
      expect(element.props.accessibilityLabel).toBe('View Italy details');
    });

    it('handles both onPress and onLongPress', () => {
      const onPressMock = jest.fn();
      const onLongPressMock = jest.fn();
      render(
        <SharedCountryPressable
          countryId="ES"
          testID="dual-handler"
          onPress={onPressMock}
          onLongPress={onLongPressMock}
        >
          <Text>Spain</Text>
        </SharedCountryPressable>
      );

      fireEvent.press(screen.getByTestId('dual-handler'));
      expect(onPressMock).toHaveBeenCalledTimes(1);
      expect(onLongPressMock).not.toHaveBeenCalled();

      fireEvent(screen.getByTestId('dual-handler'), 'longPress');
      expect(onLongPressMock).toHaveBeenCalledTimes(1);
    });

    it('calls onPressIn and onPressOut handlers', () => {
      const onPressInMock = jest.fn();
      const onPressOutMock = jest.fn();
      render(
        <SharedCountryPressable
          countryId="BR"
          testID="pressable"
          onPressIn={onPressInMock}
          onPressOut={onPressOutMock}
        >
          <Text>Brazil</Text>
        </SharedCountryPressable>
      );

      const pressable = screen.getByTestId('pressable');
      fireEvent(pressable, 'pressIn');
      expect(onPressInMock).toHaveBeenCalledTimes(1);

      fireEvent(pressable, 'pressOut');
      expect(onPressOutMock).toHaveBeenCalledTimes(1);
    });
  });
});
