import { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { ResponsiveProvider, useResponsiveContext, type ScreenSize } from './ResponsiveContext';

// Mock useWindowDimensions at the module level using the internal path
// This is necessary because jest.requireActual('react-native') causes issues with native modules
const mockDimensions = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => mockDimensions),
}));

// Import the mocked module and cast to proper type
// eslint-disable-next-line @typescript-eslint/no-require-imports
const useWindowDimensions = require('react-native/Libraries/Utilities/useWindowDimensions')
  .default as jest.Mock<{ width: number; height: number; scale: number; fontScale: number }>;

// Test component that displays responsive values
function ResponsiveTestConsumer() {
  const { screenSize, isSmallScreen, isMediumScreen, isLargeScreen, screenHeight, screenWidth } =
    useResponsiveContext();

  return (
    <View>
      <Text testID="screenSize">{screenSize}</Text>
      <Text testID="isSmallScreen">{String(isSmallScreen)}</Text>
      <Text testID="isMediumScreen">{String(isMediumScreen)}</Text>
      <Text testID="isLargeScreen">{String(isLargeScreen)}</Text>
      <Text testID="screenHeight">{String(screenHeight)}</Text>
      <Text testID="screenWidth">{String(screenWidth)}</Text>
    </View>
  );
}

function renderWithProvider(ui: ReactNode) {
  return render(<ResponsiveProvider>{ui}</ResponsiveProvider>);
}

// Helper to get text content from a testID
function getTextContent(testId: string): string {
  const element = screen.getByTestId(testId);
  return element.props.children;
}

describe('ResponsiveContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default dimensions (iPhone 14)
    useWindowDimensions.mockReturnValue({
      width: 390,
      height: 844,
      scale: 2,
      fontScale: 1,
    });
  });

  describe('breakpoint calculations', () => {
    it('should identify small screens correctly (height < 700)', () => {
      useWindowDimensions.mockReturnValue({
        width: 320,
        height: 568,
        scale: 2,
        fontScale: 1,
      });

      renderWithProvider(<ResponsiveTestConsumer />);

      expect(getTextContent('screenSize')).toBe('small');
      expect(getTextContent('isSmallScreen')).toBe('true');
      expect(getTextContent('isMediumScreen')).toBe('false');
      expect(getTextContent('isLargeScreen')).toBe('false');
      expect(getTextContent('screenHeight')).toBe('568');
    });

    it('should identify medium screens correctly (700 <= height < 850)', () => {
      useWindowDimensions.mockReturnValue({
        width: 390,
        height: 750,
        scale: 2,
        fontScale: 1,
      });

      renderWithProvider(<ResponsiveTestConsumer />);

      expect(getTextContent('screenSize')).toBe('medium');
      expect(getTextContent('isSmallScreen')).toBe('false');
      expect(getTextContent('isMediumScreen')).toBe('true');
      expect(getTextContent('isLargeScreen')).toBe('false');
    });

    it('should identify large screens correctly (height >= 850)', () => {
      useWindowDimensions.mockReturnValue({
        width: 428,
        height: 926,
        scale: 3,
        fontScale: 1,
      });

      renderWithProvider(<ResponsiveTestConsumer />);

      expect(getTextContent('screenSize')).toBe('large');
      expect(getTextContent('isSmallScreen')).toBe('false');
      expect(getTextContent('isMediumScreen')).toBe('false');
      expect(getTextContent('isLargeScreen')).toBe('true');
    });

    it('should handle edge case at 700px boundary (medium)', () => {
      useWindowDimensions.mockReturnValue({
        width: 375,
        height: 700,
        scale: 2,
        fontScale: 1,
      });

      renderWithProvider(<ResponsiveTestConsumer />);

      expect(getTextContent('screenSize')).toBe('medium');
      expect(getTextContent('isSmallScreen')).toBe('false');
    });

    it('should handle edge case at 850px boundary (large)', () => {
      useWindowDimensions.mockReturnValue({
        width: 390,
        height: 850,
        scale: 2,
        fontScale: 1,
      });

      renderWithProvider(<ResponsiveTestConsumer />);

      expect(getTextContent('screenSize')).toBe('large');
      expect(getTextContent('isMediumScreen')).toBe('false');
    });
  });

  describe('screen dimensions', () => {
    it('should provide correct screen width and height', () => {
      useWindowDimensions.mockReturnValue({
        width: 414,
        height: 896,
        scale: 2,
        fontScale: 1,
      });

      renderWithProvider(<ResponsiveTestConsumer />);

      expect(getTextContent('screenWidth')).toBe('414');
      expect(getTextContent('screenHeight')).toBe('896');
    });
  });

  describe('fallback behavior', () => {
    it('should provide fallback values when provider is missing', () => {
      useWindowDimensions.mockReturnValue({
        width: 320,
        height: 568,
        scale: 2,
        fontScale: 1,
      });

      // Render WITHOUT provider to test fallback
      render(<ResponsiveTestConsumer />);

      // Should still work using fallback logic
      expect(getTextContent('screenSize')).toBe('small');
      expect(getTextContent('isSmallScreen')).toBe('true');
      expect(getTextContent('screenHeight')).toBe('568');
    });

    it('should calculate correct fallback for large screen without provider', () => {
      useWindowDimensions.mockReturnValue({
        width: 428,
        height: 926,
        scale: 3,
        fontScale: 1,
      });

      render(<ResponsiveTestConsumer />);

      expect(getTextContent('screenSize')).toBe('large');
      expect(getTextContent('isLargeScreen')).toBe('true');
    });
  });

  describe('common device sizes', () => {
    const deviceTests: Array<{
      name: string;
      width: number;
      height: number;
      expected: ScreenSize;
    }> = [
      { name: 'iPhone SE (1st gen)', width: 320, height: 568, expected: 'small' },
      { name: 'iPhone 8', width: 375, height: 667, expected: 'small' },
      { name: 'iPhone 12 mini', width: 375, height: 812, expected: 'medium' },
      { name: 'iPhone 14', width: 390, height: 844, expected: 'medium' },
      { name: 'iPhone 14 Pro Max', width: 430, height: 932, expected: 'large' },
      { name: 'iPhone 15 Pro Max', width: 430, height: 932, expected: 'large' },
    ];

    deviceTests.forEach(({ name, width, height, expected }) => {
      it(`should correctly identify ${name} as ${expected} screen`, () => {
        useWindowDimensions.mockReturnValue({
          width,
          height,
          scale: 2,
          fontScale: 1,
        });

        renderWithProvider(<ResponsiveTestConsumer />);

        expect(getTextContent('screenSize')).toBe(expected);
      });
    });
  });
});
