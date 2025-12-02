/* eslint-disable @typescript-eslint/no-require-imports */

// Set required environment variables for tests
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

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

// Mock @react-native-async-storage/async-storage
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

// Mock the Supabase client
jest.mock('@services/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInWithPassword: jest.fn().mockResolvedValue({ data: {}, error: null }),
      signUp: jest.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: jest.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      }),
    },
    storage: {
      from: jest.fn().mockReturnValue({
        getPublicUrl: jest.fn().mockReturnValue({
          data: { publicUrl: 'https://storage.example.com/media/test.jpg' },
        }),
      }),
    },
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    }),
  },
}));

// Mock the API service
jest.mock('@services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    put: jest.fn(),
  },
  getStoredToken: jest.fn().mockResolvedValue('test-token'),
  storeTokens: jest.fn(),
  clearTokens: jest.fn(),
  setSignOutCallback: jest.fn(),
}));

// Mock Alert
jest.mock('react-native/Libraries/Alert/Alert', () => ({
  alert: jest.fn(),
}));

// Mock Share
jest.mock('react-native/Libraries/Share/Share', () => ({
  share: jest.fn().mockResolvedValue({ action: 'sharedAction' }),
}));

// Mock expo-constants (for Google Places API key) - using virtual:true for modules accessed by expo package
jest.mock(
  'expo-constants',
  () => ({
    expoConfig: {
      extra: {
        EXPO_PUBLIC_GOOGLE_PLACES_API_KEY: 'test-google-api-key',
      },
    },
  }),
  { virtual: true }
);

// Mock expo-image-picker
jest.mock(
  'expo-image-picker',
  () => ({
    launchImageLibraryAsync: jest.fn(),
    launchCameraAsync: jest.fn(),
    requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    requestCameraPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
    MediaTypeOptions: { Images: 'Images' },
  }),
  { virtual: true }
);

// Mock expo-file-system with modern File class API (SDK 54+)
jest.mock(
  'expo-file-system',
  () => {
    // Mock the modern File class used in mediaUpload.ts
    class MockFile {
      constructor(uri) {
        this.uri = uri;
        this.exists = true;
        this.size = 1000;
      }
    }

    return {
      // Modern API (SDK 54+)
      File: MockFile,
      // Legacy methods (kept for backwards compatibility)
      getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 1000 }),
      readAsStringAsync: jest.fn().mockResolvedValue('base64-encoded-content'),
      EncodingType: { Base64: 'base64' },
    };
  },
  { virtual: true }
);

// Mock expo/fetch (used by modern mediaUpload.ts)
jest.mock(
  'expo/fetch',
  () => ({
    fetch: jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    }),
  }),
  { virtual: true }
);

// Mock @expo/vector-icons
jest.mock(
  '@expo/vector-icons',
  () => ({
    Ionicons: 'Ionicons',
  }),
  { virtual: true }
);

// Reset all mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
});
