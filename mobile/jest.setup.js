/* eslint-disable @typescript-eslint/no-require-imports */

// Mock react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => {
  const mockReact = require('react');
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  return {
    SafeAreaProvider: ({ children }) => mockReact.createElement('View', null, children),
    SafeAreaView: ({ children, style }) => mockReact.createElement('View', { style }, children),
    SafeAreaFrameContext: mockReact.createContext(frame),
    SafeAreaInsetsContext: mockReact.createContext(inset),
    useSafeAreaInsets: () => inset,
    useSafeAreaFrame: () => frame,
    initialWindowMetrics: {
      frame,
      insets: inset,
    },
  };
});

// Mock react-native-screens
jest.mock('react-native-screens', () => {
  const mockRN = require('react-native');
  return {
    enableScreens: jest.fn(),
    screensEnabled: jest.fn(() => true),
    Screen: mockRN.View,
    ScreenContainer: mockRN.View,
    ScreenStack: mockRN.View,
    ScreenStackHeaderConfig: mockRN.View,
    ScreenStackHeaderBackButtonImage: mockRN.View,
    ScreenStackHeaderCenterView: mockRN.View,
    ScreenStackHeaderLeftView: mockRN.View,
    ScreenStackHeaderRightView: mockRN.View,
    ScreenStackHeaderSubview: mockRN.View,
    NativeScreen: mockRN.View,
    NativeScreenContainer: mockRN.View,
    NativeScreenNavigationContainer: mockRN.View,
    useTransitionProgress: jest.fn(),
    createNativeStackNavigator: jest.fn(),
  };
});

// Mock expo-secure-store
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
