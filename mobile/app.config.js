import 'dotenv/config';

export default {
  expo: {
    name: 'Atlasi',
    slug: 'border-badge',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/Atlasi-book-app-icon-cream.png',
    userInterfaceStyle: 'automatic',
    // Deep link scheme - handles all paths like atlasi://auth-callback, atlasi://share
    // Used by: magic link auth, OAuth callbacks, share extension
    scheme: 'atlasi',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-atlantis.png',
      resizeMode: 'cover',
      backgroundColor: '#F5F0E8', // matches the sky color in the Atlantis image
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.borderbadge.app',
      usesAppleSignIn: true,
      icon: {
        light: './assets/Atlasi-book-app-icon-cream.png',
        dark: './assets/Atlasi-book-app-icon-midnight.png',
        tinted: true,
      },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/Atlasi-book-app-icon-cream.png',
        monochromeImage: './assets/Atlasi-book-app-icon-midnight.png',
        backgroundColor: '#FDF6ED',
      },
      edgeToEdgeEnabled: true,
      package: 'com.borderbadge.app',
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-sqlite',
      'expo-font',
      'expo-video',
      'expo-apple-authentication',
      './plugins/withShareExtension',
    ],
    updates: {
      url: 'https://u.expo.dev/4b406924-7c4e-4723-87a1-c40ad227d873',
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    extra: {
      eas: {
        projectId: '4b406924-7c4e-4723-87a1-c40ad227d873',
      },
      EXPO_PUBLIC_GOOGLE_PLACES_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY,
    },
  },
};
