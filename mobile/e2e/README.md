# E2E Testing with Detox

This directory contains end-to-end tests using [Detox](https://wix.github.io/Detox/).

## Setup

### Prerequisites

1. **macOS with Xcode** (for iOS)
2. **Android Studio with Android SDK** (for Android)
3. **Node.js 18+**

### Installation

```bash
# Install Detox CLI globally
npm install -g detox-cli

# Install dependencies
npm install

# For iOS: Install Detox build
cd ios && pod install && cd ..
```

### Building the App

```bash
# Build for iOS
detox build --configuration ios.sim.debug

# Build for Android
detox build --configuration android.emu.debug
```

### Running Tests

```bash
# Run iOS tests
detox test --configuration ios.sim.debug

# Run Android tests
detox test --configuration android.emu.debug
```

## Test Structure

```
e2e/
├── README.md          # This file
├── jest.config.js     # Jest config for Detox
├── init.ts            # Test setup and utilities
├── firstTest.e2e.ts   # Smoke test example
└── flows/
    ├── auth.e2e.ts    # Authentication flow tests
    ├── trips.e2e.ts   # Trip creation/management tests
    └── entries.e2e.ts # Entry creation/management tests
```

## Writing Tests

Tests use Jest and the Detox API:

```typescript
describe('Example flow', () => {
  beforeAll(async () => {
    await device.launchApp();
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  it('should show welcome screen', async () => {
    await expect(element(by.text('Welcome'))).toBeVisible();
  });
});
```

## Configuration

The `.detoxrc.js` file in the project root contains:

- Device configurations (iOS simulators, Android emulators)
- Build configurations (debug, release)
- Test runner settings

## CI/CD

For CI, Detox tests can be run after unit tests pass:

```yaml
e2e:
  needs: test
  runs-on: macos-latest
  steps:
    - uses: actions/checkout@v4
    - run: npm ci
    - run: detox build --configuration ios.sim.release
    - run: detox test --configuration ios.sim.release
```

## Troubleshooting

### iOS simulator not found

Ensure you have the correct simulator installed:

```bash
xcrun simctl list devices
```

### Android emulator not starting

Check that your emulator is properly configured:

```bash
emulator -list-avds
```

### Tests timing out

Increase timeouts in `.detoxrc.js` or add explicit waits:

```typescript
await waitFor(element(by.id('loading')))
  .not.toBeVisible()
  .withTimeout(10000);
```

## Timeout Guidelines

Use consistent timeouts based on operation type:

| Operation Type          | Timeout | Examples                                       |
| ----------------------- | ------- | ---------------------------------------------- |
| Form interactions       | 3000ms  | Keyboard appearing, text input                 |
| API responses           | 5000ms  | Single network call, data loading              |
| Navigation/Screen loads | 10000ms | Screen transitions, complex state              |
| Auth flows              | 15000ms | Login, signup (multiple API calls + redirects) |

Example:

```typescript
// Form input visibility
await waitFor(element(by.id('email-input')))
  .toBeVisible()
  .withTimeout(3000);

// API call completion
await waitFor(element(by.id('trips-list')))
  .toBeVisible()
  .withTimeout(5000);

// Auth flow completion
await waitForEither(by.id('start-journey-button'), by.label('trips-tab'), 15000);
```

## Test Helpers

The `init.ts` file provides reusable helpers:

- `waitForEither(matcher1, matcher2, timeout)` - Wait for either of two elements
- `tapAddButton('trip' | 'entry')` - Handle FAB vs empty state button
- `signUp(email, password)` - Complete signup flow
- `login(email, password)` - Complete login flow
- `completeOnboarding()` - Skip through onboarding
- `logout()` - Sign out current user
- `navigateToTab(tabId)` - Navigate to a specific tab
- `createTrip(name)` - Create a trip and return to list
- `clearAppState()` - Reset app state between test runs
