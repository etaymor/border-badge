import 'dotenv/config';

export default {
  expo: {
    name: 'Atlasi',
    slug: 'border-badge',
    version: '1.0.1',
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
      bundleIdentifier: 'com.atlasi.app',
      buildNumber: '4',
      usesAppleSignIn: true,
      icon: {
        light: './assets/Atlasi-book-app-icon-cream.png',
        dark: './assets/Atlasi-book-app-icon-midnight.png',
      },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSPhotoLibraryUsageDescription:
          'We need access to your photos to help create trip entries from your travel photos.',
        NSLocationWhenInUseUsageDescription:
          'We need your location to identify where your photos were taken.',
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/Atlasi-book-app-icon-cream.png',
        monochromeImage: './assets/Atlasi-book-app-icon-midnight.png',
        backgroundColor: '#FDF6ED',
      },
      edgeToEdgeEnabled: true,
      package: 'com.atlasi.app',
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-sqlite',
      'expo-font',
      'expo-video',
      'expo-apple-authentication',
      'expo-secure-store',
      './plugins/withShareExtension',
      './plugins/withStoreKitConfig',
      [
        'expo-media-library',
        {
          photosPermission:
            'Allow Atlasi to access your photos to suggest trip entries based on where they were taken.',
          savePhotosPermission: 'Allow Atlasi to save photos.',
          isAccessMediaLocationEnabled: true,
        },
      ],
    ],
    updates: {
      url: 'https://u.expo.dev/4b406924-7c4e-4723-87a1-c40ad227d873',
      requestHeaders: {
        'expo-channel-name': 'production',
      },
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    extra: {
      eas: {
        projectId: '4b406924-7c4e-4723-87a1-c40ad227d873',
        build: {
          experimental: {
            ios: {
              appExtensions: [
                {
                  targetName: 'ShareExtension',
                  bundleIdentifier: 'com.atlasi.app.ShareExtension',
                  entitlements: {
                    'com.apple.security.application-groups': ['group.com.atlasi.app'],
                    // Keychain sharing for auth tokens between main app and extension
                    // Must match the accessGroup used in api.ts and KeychainHelper.swift
                    'keychain-access-groups': ['$(AppIdentifierPrefix)com.atlasi.app'],
                  },
                },
              ],
            },
          },
        },
      },
      EXPO_PUBLIC_GOOGLE_PLACES_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY,
    },
  },
};
