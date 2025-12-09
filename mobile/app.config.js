import 'dotenv/config';

export default {
  expo: {
    name: 'Border Badge',
    slug: 'border-badge',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    scheme: 'borderbadge',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.borderbadge.app',
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      edgeToEdgeEnabled: true,
      package: 'com.borderbadge.app',
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: ['expo-sqlite', 'expo-font', 'expo-video'],
    extra: {
      EXPO_PUBLIC_GOOGLE_PLACES_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY,
    },
  },
};
