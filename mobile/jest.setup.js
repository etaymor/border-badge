/* eslint-disable @typescript-eslint/no-require-imports */

// Set required environment variables for tests
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';

// CI runners are CPU-starved enough that real-timer flows (e.g. QuizPlay's
// 420ms acknowledgment hold) overrun waitFor's 1s default. waitFor still
// resolves the moment its assertion passes, so fast machines pay nothing.
require('@testing-library/react-native').configure({ asyncUtilTimeout: 5000 });

// Mock react-native-reanimated
jest.mock(
  'react-native-reanimated',
  () => {
    const mockReact = require('react');
    // Helper to create animated component wrapper
    const createAnimatedComponent = (Component) =>
      mockReact.forwardRef((props, ref) => mockReact.createElement(Component, { ...props, ref }));
    // Pass every prop except the animation builders through, so testID,
    // accessibility props, and pointerEvents survive the mock.
    const MockAnimatedView = mockReact.forwardRef(
      ({ children, entering: _entering, exiting: _exiting, layout: _layout, ...props }, ref) =>
        mockReact.createElement('View', { ...props, ref }, children)
    );
    return {
      default: {
        View: MockAnimatedView,
        createAnimatedComponent,
      },
      createAnimatedComponent,
      View: MockAnimatedView,
      FadeInUp: {
        duration: () => ({
          springify: () => ({}),
          delay: () => ({}),
        }),
      },
      FadeOutUp: {
        duration: () => ({}),
      },
      // Chainable entering/exiting builders used by the quiz play stage.
      FadeIn: {
        duration: () => ({ delay: () => ({}) }),
      },
      FadeOut: {
        duration: () => ({ delay: () => ({}) }),
      },
      FadeInDown: {
        duration: () => ({ delay: () => ({}) }),
      },
      // Layout transition builder used for leaderboard rank displacement.
      LinearTransition: {
        duration: () => ({}),
      },
      // Real useSharedValue returns the SAME object across renders. Returning a
      // fresh one each time would hide recycling bugs (a stale offset written by
      // a previous render would appear to "reset" on its own), so mirror the real
      // identity semantics by holding the object in a ref.
      useSharedValue: jest.fn((initial) => {
        const ref = mockReact.useRef(null);
        if (ref.current === null) ref.current = { value: initial };
        return ref.current;
      }),
      useAnimatedStyle: jest.fn(() => ({})),
      // Invoke the completion callback synchronously so components that chain work
      // off the end of an animation (e.g. SwipeToSkipCard committing a skip) are
      // testable without a real UI-thread animation driver.
      withTiming: jest.fn((value, _config, callback) => {
        callback?.(true);
        return value;
      }),
      withSpring: jest.fn((value, _config, callback) => {
        callback?.(true);
        return value;
      }),
      withDelay: jest.fn((_delayMs, animation) => animation),
      runOnJS: jest.fn((fn) => fn),
      cancelAnimation: jest.fn(),
      useAnimatedReaction: jest.fn(),
      interpolate: jest.fn((value, inputRange, outputRange) => {
        // Linear interpolation supporting multiple keyframes
        // Find the segment that contains our value
        for (let i = 0; i < inputRange.length - 1; i++) {
          const i0 = inputRange[i];
          const i1 = inputRange[i + 1];
          if (value >= i0 && value <= i1) {
            const o0 = outputRange[i];
            const o1 = outputRange[i + 1];
            if (i1 === i0) return o0;
            const ratio = (value - i0) / (i1 - i0);
            return o0 + ratio * (o1 - o0);
          }
        }
        // Value is outside range, clamp to nearest endpoint
        if (value <= inputRange[0]) return outputRange[0];
        return outputRange[outputRange.length - 1];
      }),
      Easing: {
        linear: jest.fn(),
        ease: jest.fn(),
        cubic: jest.fn(),
        out: jest.fn((fn) => fn),
      },
      useReducedMotion: jest.fn(() => false),
    };
  },
  { virtual: true }
);

// Mock react-native-gesture-handler.
//
// Gesture.Pan() / Gesture.Pinch() return a chainable stub that records each
// handler it is given (as `_onUpdate`, `_onEnd`, ...). Tests drive a swipe or a
// pinch by calling those directly, which is the only way to exercise a gesture
// without a real touch system.
// `Swipeable` is retained for TripListsScreen, which still uses the legacy API.
jest.mock('react-native-gesture-handler', () => {
  const mockReact = require('react');
  const mockRN = require('react-native');

  const createGestureStub = () => {
    const gesture = {};
    const chainable = [
      'enabled',
      'activeOffsetX',
      'activeOffsetY',
      'failOffsetX',
      'failOffsetY',
      'minPointers',
      'onBegin',
      'onStart',
      'onUpdate',
      'onEnd',
      'onFinalize',
    ];
    for (const method of chainable) {
      gesture[method] = jest.fn((arg) => {
        gesture[`_${method}`] = arg;
        return gesture;
      });
    }
    return gesture;
  };

  return {
    Gesture: {
      Pan: jest.fn(createGestureStub),
      Pinch: jest.fn(createGestureStub),
      Simultaneous: jest.fn((...gestures) => ({ gestures })),
    },
    GestureDetector: ({ children }) => children,
    GestureHandlerRootView: mockRN.View,
    Swipeable: ({ children }) => mockReact.createElement(mockRN.View, null, children),
    State: {},
    Directions: {},
  };
});

// Mock react-native-screen-transitions
jest.mock('react-native-screen-transitions', () => {
  const mockReact = require('react');
  const mockRN = require('react-native');

  const TransitionView = mockReact.forwardRef(
    ({ children, style, sharedBoundTag: _sharedBoundTag, testID }, ref) =>
      mockReact.createElement(mockRN.View, { ref, style, testID }, children)
  );

  const TransitionPressable = mockReact.forwardRef(
    (
      {
        children,
        style,
        sharedBoundTag: _sharedBoundTag,
        testID,
        onPress,
        onLongPress,
        onPressIn,
        onPressOut,
        accessibilityRole,
        accessibilityLabel,
      },
      ref
    ) =>
      mockReact.createElement(
        mockRN.TouchableOpacity,
        {
          ref,
          style,
          testID,
          onPress,
          onLongPress,
          onPressIn,
          onPressOut,
          accessibilityRole,
          accessibilityLabel,
        },
        children
      )
  );

  return {
    __esModule: true,
    default: {
      View: TransitionView,
      Pressable: TransitionPressable,
      ScrollView: mockRN.ScrollView,
      FlatList: mockRN.FlatList,
      Presets: {
        SlideFromBottom: () => ({}),
        SlideFromTop: () => ({}),
        ZoomIn: () => ({}),
      },
    },
    Transition: {
      View: TransitionView,
      Pressable: TransitionPressable,
    },
  };
});

// Mock react-native-screen-transitions/blank-stack
jest.mock('react-native-screen-transitions/blank-stack', () => {
  const mockReact = require('react');
  const mockRN = require('react-native');

  return {
    createBlankStackNavigator: () => ({
      Navigator: ({ children, screenOptions: _screenOptions }) =>
        mockReact.createElement(mockRN.View, null, children),
      Screen: ({ component: Component, options: _options }) =>
        mockReact.createElement(Component, {}),
    }),
  };
});

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

// Mock react-native-view-shot: there is no native module in jest, so the real
// capture() never settles and any code awaiting it hangs. Suites that need to
// inspect capture calls/options re-mock this per-file (which takes precedence).
jest.mock('react-native-view-shot', () => {
  const mockReact = require('react');
  const MockViewShot = mockReact.forwardRef(({ children }, ref) => {
    mockReact.useImperativeHandle(ref, () => ({
      capture: () => Promise.resolve('file:///mock/view-shot.png'),
    }));
    return mockReact.createElement(mockReact.Fragment, null, children);
  });
  MockViewShot.displayName = 'ViewShot';
  return { __esModule: true, default: MockViewShot };
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
    rpc: jest.fn().mockResolvedValue({ error: null }),
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
  storeOnboardingComplete: jest.fn().mockResolvedValue(undefined),
}));

// Mock Alert - define the mock functions on global first so they can be accessed in tests
global.__mockAlert = {
  alert: jest.fn(),
};
jest.mock('react-native/Libraries/Alert/Alert', () => ({
  __esModule: true,
  default: global.__mockAlert,
}));

// Mock ActionSheetIOS - define the mock functions on global first so they can be accessed in tests
global.__mockActionSheetIOS = {
  showActionSheetWithOptions: jest.fn(),
};
jest.mock('react-native/Libraries/ActionSheetIOS/ActionSheetIOS', () => ({
  __esModule: true,
  default: global.__mockActionSheetIOS,
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

// Mock expo-sqlite (used by countriesDb)
jest.mock(
  'expo-sqlite',
  () => ({
    openDatabaseAsync: jest.fn().mockResolvedValue({
      execAsync: jest.fn(),
      runAsync: jest.fn(),
      getAllAsync: jest.fn().mockResolvedValue([]),
      getFirstAsync: jest.fn().mockResolvedValue(null),
    }),
    useSQLiteContext: jest.fn(),
  }),
  { virtual: true }
);

// Mock expo-asset (dependency of expo-sqlite)
jest.mock(
  'expo-asset',
  () => ({
    Asset: {
      loadAsync: jest.fn(),
      fromModule: jest.fn().mockReturnValue({
        downloadAsync: jest.fn().mockResolvedValue({ localUri: 'file:///mock/asset.db' }),
        uri: 'file:///mock/asset.db',
        localUri: 'file:///mock/asset.db',
      }),
    },
  }),
  { virtual: true }
);

// Mock expo-video (used by ShareExtensionTutorialSheet and onboarding screens)
jest.mock(
  'expo-video',
  () => ({
    useVideoPlayer: jest.fn((source, callback) => {
      const player = {
        loop: false,
        muted: false,
        currentTime: 0,
        play: jest.fn(),
        pause: jest.fn(),
        replace: jest.fn(),
        addListener: jest.fn(() => ({ remove: jest.fn() })),
      };
      if (callback) callback(player);
      return player;
    }),
    VideoView: 'VideoView',
  }),
  { virtual: true }
);

// Mock expo-blur (used by ShareExtensionCallout and ShareExtensionTutorialSheet)
jest.mock(
  'expo-blur',
  () => {
    const mockReact = require('react');
    return {
      BlurView: ({ children, style }) => mockReact.createElement('View', { style }, children),
    };
  },
  { virtual: true }
);

// Mock expo-haptics
jest.mock(
  'expo-haptics',
  () => ({
    impactAsync: jest.fn().mockResolvedValue(undefined),
    ImpactFeedbackStyle: {
      Light: 'light',
      Medium: 'medium',
      Heavy: 'heavy',
    },
    notificationAsync: jest.fn().mockResolvedValue(undefined),
    NotificationFeedbackType: {
      Success: 'success',
      Warning: 'warning',
      Error: 'error',
    },
    selectionAsync: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true }
);

// Mock react-native-purchases (RevenueCat)
jest.mock('react-native-purchases-ui', () => ({
  __esModule: true,
  default: {
    presentPaywall: jest.fn().mockResolvedValue({ paywallResult: 'NOT_PRESENTED' }),
    presentPaywallIfNeeded: jest.fn().mockResolvedValue({ paywallResult: 'NOT_PRESENTED' }),
  },
  PAYWALL_RESULT: {
    NOT_PRESENTED: 'NOT_PRESENTED',
    ERROR: 'ERROR',
    CANCELLED: 'CANCELLED',
    PURCHASED: 'PURCHASED',
    RESTORED: 'RESTORED',
  },
}));

jest.mock('react-native-purchases', () => ({
  configure: jest.fn(),
  isConfigured: jest.fn().mockResolvedValue(true),
  getCustomerInfo: jest.fn().mockResolvedValue({
    entitlements: { active: {} },
    activeSubscriptions: [],
    allPurchasedProductIdentifiers: [],
  }),
  logIn: jest.fn().mockResolvedValue({
    customerInfo: {
      entitlements: { active: {} },
      activeSubscriptions: [],
      allPurchasedProductIdentifiers: [],
    },
    created: true,
  }),
  logOut: jest.fn().mockResolvedValue({
    entitlements: { active: {} },
    activeSubscriptions: [],
    allPurchasedProductIdentifiers: [],
  }),
  getOfferings: jest.fn().mockResolvedValue({ current: null, all: {} }),
  purchasePackage: jest.fn(),
  restorePurchases: jest.fn().mockResolvedValue({
    entitlements: { active: {} },
    activeSubscriptions: [],
    allPurchasedProductIdentifiers: [],
  }),
  addCustomerInfoUpdateListener: jest.fn(() => jest.fn()),
  removeCustomerInfoUpdateListener: jest.fn(),
  setLogLevel: jest.fn(),
  LOG_LEVEL: {
    VERBOSE: 'VERBOSE',
    DEBUG: 'DEBUG',
    INFO: 'INFO',
    WARN: 'WARN',
    ERROR: 'ERROR',
  },
  PURCHASES_ERROR_CODE: {
    PURCHASE_CANCELLED_ERROR: 'PURCHASE_CANCELLED',
    PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR: 'PRODUCT_NOT_AVAILABLE',
    NETWORK_ERROR: 'NETWORK_ERROR',
  },
}));

// Mock react-native-fbsdk-next (Facebook SDK)
jest.mock('react-native-fbsdk-next', () => ({
  AppEventsLogger: {
    logEvent: jest.fn(),
    logPurchase: jest.fn(),
    setUserID: jest.fn(),
    clearUserID: jest.fn(),
    clearUserData: jest.fn(),
  },
  Settings: {
    setAdvertiserTrackingEnabled: jest.fn(),
  },
}));

// Mock expo-tracking-transparency (ATT prompt)
jest.mock('expo-tracking-transparency', () => ({
  requestTrackingPermissionsAsync: jest.fn().mockResolvedValue({ status: 'undetermined' }),
  getTrackingPermissionsAsync: jest.fn().mockResolvedValue({ status: 'undetermined' }),
}));

// Mock countriesDb service
jest.mock('@services/countriesDb', () => ({
  getAllCountries: jest.fn().mockResolvedValue([]),
  getCountriesByRegion: jest.fn().mockResolvedValue([]),
  searchCountries: jest.fn().mockResolvedValue([]),
  getCountryByCode: jest.fn().mockResolvedValue(null),
  getCountriesByCodes: jest.fn().mockResolvedValue([]),
  // Local user country functions for onboarding → passport flow
  saveLocalUserCountry: jest.fn().mockResolvedValue(undefined),
  saveLocalUserCountries: jest.fn().mockResolvedValue(undefined),
  removeLocalUserCountry: jest.fn().mockResolvedValue(undefined),
  getLocalUserCountries: jest.fn().mockResolvedValue([]),
  clearLocalUserCountries: jest.fn().mockResolvedValue(undefined),
  hasLocalUserCountries: jest.fn().mockResolvedValue(false),
  // Home country SQLite backup for migration reliability
  saveHomeCountry: jest.fn().mockResolvedValue(undefined),
  getHomeCountry: jest.fn().mockResolvedValue(null),
  clearHomeCountry: jest.fn().mockResolvedValue(undefined),
}));

// Reset all mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
});
