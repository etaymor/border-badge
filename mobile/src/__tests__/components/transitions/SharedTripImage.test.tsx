import { fireEvent, render, screen } from '../../utils/testUtils';

import {
  SharedTripImage,
  SharedTripPressable,
  getTripSharedTag,
} from '@components/transitions/SharedTripImage';
import { Text, View } from 'react-native';

describe('SharedTripImage', () => {
  describe('getTripSharedTag', () => {
    it('generates correct tag for trip ID', () => {
      expect(getTripSharedTag('abc-123')).toBe('trip-abc-123');
      expect(getTripSharedTag('xyz-789')).toBe('trip-xyz-789');
    });

    it('handles UUID-style IDs', () => {
      const uuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      expect(getTripSharedTag(uuid)).toBe(`trip-${uuid}`);
    });
  });

  describe('SharedTripImage', () => {
    it('renders children correctly', () => {
      render(
        <SharedTripImage tripId="trip-123" testID="shared-image">
          <Text testID="child-text">Test Content</Text>
        </SharedTripImage>
      );

      expect(screen.getByTestId('shared-image')).toBeTruthy();
      expect(screen.getByTestId('child-text')).toBeTruthy();
      expect(screen.getByText('Test Content')).toBeTruthy();
    });

    it('applies custom style', () => {
      const customStyle = { width: 72, height: 72, borderRadius: 12 };
      render(
        <SharedTripImage tripId="trip-456" style={customStyle} testID="styled-image">
          <View />
        </SharedTripImage>
      );

      const element = screen.getByTestId('styled-image');
      const flatStyle = Array.isArray(element.props.style)
        ? element.props.style.flat()
        : [element.props.style];
      const hasCustomStyle = flatStyle.some(
        (s: Record<string, unknown>) =>
          s?.width === 72 && s?.height === 72 && s?.borderRadius === 12
      );
      expect(hasCustomStyle).toBe(true);
    });
  });

  describe('SharedTripPressable', () => {
    it('renders children correctly', () => {
      render(
        <SharedTripPressable tripId="trip-123" testID="shared-pressable">
          <Text testID="child-text">Pressable Content</Text>
        </SharedTripPressable>
      );

      expect(screen.getByTestId('shared-pressable')).toBeTruthy();
      expect(screen.getByTestId('child-text')).toBeTruthy();
    });

    it('calls onPress handler when pressed', () => {
      const onPressMock = jest.fn();
      render(
        <SharedTripPressable tripId="trip-456" testID="pressable" onPress={onPressMock}>
          <Text>Press Me</Text>
        </SharedTripPressable>
      );

      fireEvent.press(screen.getByTestId('pressable'));
      expect(onPressMock).toHaveBeenCalledTimes(1);
    });

    it('calls onPressIn and onPressOut handlers', () => {
      const onPressInMock = jest.fn();
      const onPressOutMock = jest.fn();
      render(
        <SharedTripPressable
          tripId="trip-789"
          testID="pressable"
          onPressIn={onPressInMock}
          onPressOut={onPressOutMock}
        >
          <Text>Press Me</Text>
        </SharedTripPressable>
      );

      const pressable = screen.getByTestId('pressable');
      fireEvent(pressable, 'pressIn');
      expect(onPressInMock).toHaveBeenCalledTimes(1);

      fireEvent(pressable, 'pressOut');
      expect(onPressOutMock).toHaveBeenCalledTimes(1);
    });

    it('passes accessibility props correctly', () => {
      render(
        <SharedTripPressable
          tripId="trip-test"
          testID="accessible-pressable"
          accessibilityRole="button"
          accessibilityLabel="View trip details"
        >
          <Text>Trip</Text>
        </SharedTripPressable>
      );

      const element = screen.getByTestId('accessible-pressable');
      expect(element.props.accessibilityRole).toBe('button');
      expect(element.props.accessibilityLabel).toBe('View trip details');
    });
  });
});
