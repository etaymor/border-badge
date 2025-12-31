import { fireEvent, render, screen } from '../../utils/testUtils';

import {
  SharedEntryImage,
  SharedEntryPressable,
  getEntrySharedTag,
} from '@components/transitions/SharedEntryImage';
import { Text, View } from 'react-native';

describe('SharedEntryImage', () => {
  describe('getEntrySharedTag', () => {
    it('generates correct tag for entry ID', () => {
      expect(getEntrySharedTag('entry-123')).toBe('entry-entry-123');
      expect(getEntrySharedTag('abc-def-789')).toBe('entry-abc-def-789');
    });

    it('handles UUID-style IDs', () => {
      const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      expect(getEntrySharedTag(uuid)).toBe(`entry-${uuid}`);
    });
  });

  describe('SharedEntryImage', () => {
    it('renders children correctly', () => {
      render(
        <SharedEntryImage entryId="entry-123" testID="shared-image">
          <Text testID="child-text">Entry Content</Text>
        </SharedEntryImage>
      );

      expect(screen.getByTestId('shared-image')).toBeTruthy();
      expect(screen.getByTestId('child-text')).toBeTruthy();
      expect(screen.getByText('Entry Content')).toBeTruthy();
    });

    it('applies custom style', () => {
      const customStyle = { width: 160, height: 200, borderRadius: 8 };
      render(
        <SharedEntryImage entryId="entry-456" style={customStyle} testID="styled-image">
          <View />
        </SharedEntryImage>
      );

      const element = screen.getByTestId('styled-image');
      const flatStyle = Array.isArray(element.props.style)
        ? element.props.style.flat()
        : [element.props.style];
      const hasCustomStyle = flatStyle.some(
        (s: Record<string, unknown>) =>
          s?.width === 160 && s?.height === 200 && s?.borderRadius === 8
      );
      expect(hasCustomStyle).toBe(true);
    });
  });

  describe('SharedEntryPressable', () => {
    it('renders children correctly', () => {
      render(
        <SharedEntryPressable entryId="entry-123" testID="shared-pressable">
          <Text testID="child-text">Pressable Entry</Text>
        </SharedEntryPressable>
      );

      expect(screen.getByTestId('shared-pressable')).toBeTruthy();
      expect(screen.getByTestId('child-text')).toBeTruthy();
    });

    it('calls onPress handler when pressed', () => {
      const onPressMock = jest.fn();
      render(
        <SharedEntryPressable entryId="entry-456" testID="pressable" onPress={onPressMock}>
          <Text>Press Me</Text>
        </SharedEntryPressable>
      );

      fireEvent.press(screen.getByTestId('pressable'));
      expect(onPressMock).toHaveBeenCalledTimes(1);
    });

    it('calls onLongPress handler', () => {
      const onLongPressMock = jest.fn();
      render(
        <SharedEntryPressable entryId="entry-789" testID="pressable" onLongPress={onLongPressMock}>
          <Text>Long Press Me</Text>
        </SharedEntryPressable>
      );

      fireEvent(screen.getByTestId('pressable'), 'longPress');
      expect(onLongPressMock).toHaveBeenCalledTimes(1);
    });

    it('passes accessibility props correctly', () => {
      render(
        <SharedEntryPressable
          entryId="entry-test"
          testID="accessible-pressable"
          accessibilityRole="button"
          accessibilityLabel="View entry details"
        >
          <Text>Entry</Text>
        </SharedEntryPressable>
      );

      const element = screen.getByTestId('accessible-pressable');
      expect(element.props.accessibilityRole).toBe('button');
      expect(element.props.accessibilityLabel).toBe('View entry details');
    });
  });
});
