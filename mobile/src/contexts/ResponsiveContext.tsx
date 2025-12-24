import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

// Breakpoints based on common device heights
const BREAKPOINTS = {
  small: 700, // iPhone SE, iPhone 8, etc.
  medium: 850, // iPhone 12/13/14, etc.
} as const;

export type ScreenSize = 'small' | 'medium' | 'large';

export interface ResponsiveValues {
  screenSize: ScreenSize;
  isSmallScreen: boolean;
  isMediumScreen: boolean;
  isLargeScreen: boolean;
  screenHeight: number;
  screenWidth: number;
}

const ResponsiveContext = createContext<ResponsiveValues | null>(null);

interface ResponsiveProviderProps {
  children: ReactNode;
}

/**
 * Provider for responsive values based on screen dimensions.
 * Place this at the app root to share responsive values across all components.
 */
export function ResponsiveProvider({ children }: ResponsiveProviderProps) {
  const { width, height } = useWindowDimensions();

  const value = useMemo<ResponsiveValues>(() => {
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
  }, [width, height]);

  return <ResponsiveContext.Provider value={value}>{children}</ResponsiveContext.Provider>;
}

/**
 * Hook to access responsive values from the ResponsiveProvider.
 * Falls back to direct useWindowDimensions if provider is not present.
 */
export function useResponsiveContext(): ResponsiveValues {
  const context = useContext(ResponsiveContext);

  // Fallback for components rendered outside the provider
  const { width, height } = useWindowDimensions();

  if (context) {
    return context;
  }

  // Fallback calculation if no provider exists
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
