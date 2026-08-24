import 'dotenv/config';

export default {
  expo: {
    name: 'Atlasi',
    slug: 'border-badge',
    version: '1.0.16',
    orientation: 'portrait',
    icon: './assets/atlasi-stamp-app-icon.png',
    userInterfaceStyle: 'automatic',
    // Deep link scheme - handles all paths like atlasi://auth-callback, atlasi://share
    // Used by: magic link auth, OAuth callbacks, share extension
    scheme: 'atlasi',
    newArchEnabled: true,
    // React Compiler auto-memoization (U14). Babel-only transform → OTA-safe
    // (no native change). RC-quality on SDK 54; healthcheck passed clean
    // (198/198 components compile, no incompatible libraries). Requires the new
    // architecture (newArchEnabled above). Revert = delete this one line.
    experiments: {
      reactCompiler: true,
    },
    splash: {
      image: './assets/splash-atlantis.png',
      resizeMode: 'cover',
      backgroundColor: '#F5F0E8', // matches the sky color in the Atlantis image
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.atlasi.app',
      buildNumber: '1',
      usesAppleSignIn: true,
      icon: {
        light: './assets/atlasi-stamp-app-icon.png',
        dark: './assets/atlasi-stamp-app-icon.png',
      },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        // The static continued-processing identifier for modules/job-continuation
        // (iOS 26 BGContinuedProcessingTask). The expo-background-task plugin
        // APPENDS its own identifier to this array rather than overwriting it.
        BGTaskSchedulerPermittedIdentifiers: ['com.atlasi.app.continued-processing'],
        NSPhotoLibraryUsageDescription:
          'We need access to your photos to help create trip entries from your travel photos.',
        NSLocationWhenInUseUsageDescription:
          'We need your location to identify where your photos were taken.',
        SKAdNetworkItems: [
          { SKAdNetworkIdentifier: 'v9wttpbfk9.skadnetwork' },
          { SKAdNetworkIdentifier: 'n38lu8286q.skadnetwork' },
          { SKAdNetworkIdentifier: '238da6jt44.skadnetwork' },
          { SKAdNetworkIdentifier: '22mmun2rn5.skadnetwork' },
        ],
      },
      privacyManifests: {
        NSPrivacyTracking: true,
        NSPrivacyTrackingDomains: ['graph.facebook.com', 'analytics.tiktok.com'],
        NSPrivacyCollectedDataTypes: [
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeDeviceID',
            NSPrivacyCollectedDataTypeLinked: false,
            NSPrivacyCollectedDataTypeTracking: true,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising',
            ],
          },
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeEmailAddress',
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: true,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising',
            ],
          },
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeUserID',
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: true,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising',
            ],
          },
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePurchaseHistory',
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: true,
            NSPrivacyCollectedDataTypePurposes: [
              'NSPrivacyCollectedDataTypePurposeThirdPartyAdvertising',
            ],
          },
        ],
        NSPrivacyAccessedAPITypes: [
          {
            NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
            NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
          },
        ],
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/atlasi-stamp-app-icon.png',
        monochromeImage: './assets/atlasi-stamp-app-icon.png',
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
      // Adds UIBackgroundModes: ['processing'] and the BGTaskScheduler
      // identifier to Info.plist. See services/jobs/backgroundJobTask — this
      // is why that phase needs an `eas build` and cannot ship over the air.
      'expo-background-task',
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
      [
        'expo-tracking-transparency',
        {
          userTrackingPermission:
            'Allow Atlasi to use your data for measuring ad effectiveness. Your data is hashed and anonymized before being shared.',
        },
      ],
      [
        'react-native-fbsdk-next',
        {
          appID: process.env.EXPO_PUBLIC_FB_APP_ID,
          clientToken: process.env.EXPO_PUBLIC_FB_CLIENT_TOKEN,
          displayName: 'Atlasi',
          scheme: `fb${process.env.EXPO_PUBLIC_FB_APP_ID}`,
          advertiserIDCollectionEnabled: false,
          autoLogAppEventsEnabled: true,
          isAutoInitEnabled: true,
          iosUserTrackingPermission: false,
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
