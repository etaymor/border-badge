const ORIGINAL_ENV = { ...process.env };

/**
 * Simulates a dev machine's .env.local leaking into a production build/publish
 * step: EXPO_PUBLIC_APP_ENV=production but EXPO_PUBLIC_API_URL still points at
 * a local dev backend. Every screen that fetches data would hang on its
 * loading state instead of erroring, so this must fail loudly at import time.
 */
describe('env', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
  });

  it.each([
    ['localhost', 'http://localhost:8000'],
    ['127.0.0.1', 'http://127.0.0.1:8000'],
    ['a 192.168.x LAN IP', 'http://192.168.1.100:8000'],
    ['a 10.x LAN IP', 'http://10.0.0.5:8000'],
    ['a 172.16-31.x LAN IP', 'http://172.20.0.5:8000'],
  ])('throws when EXPO_PUBLIC_API_URL is %s in production', (_label, url) => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_API_URL = url;
    process.env.EXPO_PUBLIC_APP_ENV = 'production';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(() => require('../../config/env')).toThrow(/production build/i);
  });

  it('does not throw for the production API URL in production', () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_API_URL = 'https://atlasi.app';
    process.env.EXPO_PUBLIC_APP_ENV = 'production';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(() => require('../../config/env')).not.toThrow();
  });

  it('does not throw for a LAN IP in development', () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_API_URL = 'http://192.168.1.100:8000';
    process.env.EXPO_PUBLIC_APP_ENV = 'development';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(() => require('../../config/env')).not.toThrow();
  });
});
