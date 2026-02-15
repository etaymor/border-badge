// Environment configuration using Expo's EXPO_PUBLIC_ prefix
// These variables are replaced at build time

// Validate required Supabase environment variables
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing required Supabase environment variables. ' +
      'Please set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file.'
  );
}

export const env = {
  // API Configuration
  // NOTE: iOS Simulator cannot access localhost. Use your machine's IP address instead.
  // Example: EXPO_PUBLIC_API_URL=http://192.168.1.100:8000
  apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000',

  // Supabase Configuration (for direct auth)
  supabaseUrl,
  supabaseAnonKey,

  // App Environment
  appEnv: (process.env.EXPO_PUBLIC_APP_ENV || 'development') as
    | 'development'
    | 'staging'
    | 'production',

  // Debug flags
  enableDevTools: process.env.EXPO_PUBLIC_ENABLE_DEV_TOOLS === 'true',

  // Web base URL for public pages (terms, privacy, etc.)
  // Environment variable: EXPO_PUBLIC_WEB_BASE_URL (optional)
  // Fallback chain:
  //   1. EXPO_PUBLIC_WEB_BASE_URL if set
  //   2. EXPO_PUBLIC_API_URL if set (useful for development with local backend)
  //   3. https://atlasi.app in production
  //   4. http://localhost:8000 in development
  webBaseUrl: (() => {
    const appEnv = (process.env.EXPO_PUBLIC_APP_ENV || 'development') as string;
    const url =
      process.env.EXPO_PUBLIC_WEB_BASE_URL ||
      process.env.EXPO_PUBLIC_API_URL ||
      (appEnv === 'production' ? 'https://atlasi.app' : 'http://localhost:8000');

    // Validate URL format
    try {
      new URL(url);
      return url;
    } catch {
      throw new Error(
        `Invalid web base URL: "${url}". Must be a valid URL. ` +
          'Set EXPO_PUBLIC_WEB_BASE_URL or ensure EXPO_PUBLIC_API_URL is valid.'
      );
    }
  })(),

  // RevenueCat Configuration
  revenueCatIosApiKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || '',
  revenueCatAndroidApiKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY || '',

  // Facebook Ads
  fbAppId: process.env.EXPO_PUBLIC_FB_APP_ID || '',
  fbClientToken: process.env.EXPO_PUBLIC_FB_CLIENT_TOKEN || '',
} as const;

// Warn if Facebook credentials are missing in production builds.
// The SDK will silently fail to initialize without these.
if (
  env.appEnv === 'production' &&
  (!env.fbAppId || !env.fbClientToken)
) {
  console.warn(
    '[Config] Missing Facebook SDK credentials (EXPO_PUBLIC_FB_APP_ID / EXPO_PUBLIC_FB_CLIENT_TOKEN). ' +
      'Ad conversion tracking will be disabled.'
  );
}

// Helper to check if we're in development
export const isDevelopment = env.appEnv === 'development';

// Helper to check if we're in production
export const isProduction = env.appEnv === 'production';
