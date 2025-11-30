// Environment configuration using Expo's EXPO_PUBLIC_ prefix
// These variables are replaced at build time

export const env = {
  // API Configuration
  // NOTE: iOS Simulator cannot access localhost. Use your machine's IP address instead.
  // Example: EXPO_PUBLIC_API_URL=http://192.168.1.100:8000
  apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000',

  // Supabase Configuration (for direct auth)
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',

  // App Environment
  appEnv: (process.env.EXPO_PUBLIC_APP_ENV || 'development') as
    | 'development'
    | 'staging'
    | 'production',

  // Debug flags
  enableDevTools: process.env.EXPO_PUBLIC_ENABLE_DEV_TOOLS === 'true',
} as const;

// Helper to check if we're in development
export const isDevelopment = env.appEnv === 'development';

// Helper to check if we're in production
export const isProduction = env.appEnv === 'production';
