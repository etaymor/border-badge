import { useWindowDimensions } from 'react-native';

// Breakpoints based on common device heights
const BREAKPOINTS = {
  small: 700, // iPhone SE, iPhone 8, etc.
  medium: 850, // iPhone 12/13/14, etc.
} as const;

export type ScreenSize = 'small' | 'medium' | 'large';

interface ResponsiveValues {
  screenSize: ScreenSize;
  isSmallScreen: boolean;
  isMediumScreen: boolean;
  isLargeScreen: boolean;
  screenHeight: number;
  screenWidth: number;
}

/**
 * Hook for responsive design based on screen height.
 * Use this instead of manually checking screen dimensions throughout the app.
 *
 * @example
 * const { isSmallScreen } = useResponsive();
 * <Text style={[styles.title, isSmallScreen && styles.titleSmall]}>
 */
export function useResponsive(): ResponsiveValues {
  const { width, height } = useWindowDimensions();

  const screenSize: ScreenSize =
    height < BREAKPOINTS.small ? 'small' : height < BREAKPOINTS.medium ? 'medium' : 'large';

  return {
    screenSize,
    isSmallScreen: screenSize === 'small',
    isMediumScreen: screenSize === 'medium',
    isLargeScreen: screenSize === 'large',
    screenHeight: height,
    screenWidth: width,
  };
}
