import 'dotenv/config';

export default {
  expo: {
    name: 'Atlasi',
    slug: 'border-badge',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/Atlasi-book-app-icon-cream.png',
    userInterfaceStyle: 'automatic',
    scheme: 'borderbadge',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#FDF6ED', // warmCream - app default background
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
    plugins: ['expo-sqlite', 'expo-font', 'expo-video', 'expo-apple-authentication'],
    extra: {
      EXPO_PUBLIC_GOOGLE_PLACES_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY,
    },
  },
};
