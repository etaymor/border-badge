# Onboarding Paywall Fix: Account Before Purchase

## Problem Statement

The current onboarding flow presents the RevenueCat paywall **before** account creation:

```
... → NameEntry → EmotionalHook → FunctionalHook → Paywall → AccountCreation
```

This means purchases attach to an anonymous `$RCAnonymousID` instead of the user's Supabase UUID. The consequences:

1. **INITIAL_PURCHASE webhook is silently dropped** — `webhooks.py` validates `app_user_id` as a UUID, and `$RCAnonymousID:xxxx` fails validation, so the webhook returns `{"status": "ignored", "reason": "invalid_user_id"}`.
2. **`Purchases.logIn()` after account creation should trigger a TRANSFER webhook**, but this call is fire-and-forget in `useAuthSession.ts`. If it fails, the purchase is permanently orphaned.
3. **Race condition in `App.tsx`** — `useAppInitialization` calls `fetchCustomerInfo()` on the anonymous user concurrently with `syncRevenueCat()` in `useAuthSession`, potentially overwriting premium status with anonymous (free) status.
4. **RevenueCat dashboard has no user info** — email, name, and Supabase UUID are never set because `logIn()` only fires after the purchase completes.

## Proposed Solution: Move Account Creation Before Paywall

Reorder the onboarding flow so the user creates an account **before** seeing the paywall:

```
CURRENT:  ... → NameEntry → EmotionalHook → FunctionalHook → Paywall → AccountCreation
PROPOSED: ... → NameEntry → AccountCreation → EmotionalHook → FunctionalHook → Paywall
```

This ensures:
- `Purchases.logIn(supabaseUserId)` runs before any purchase
- Purchases attach directly to the Supabase UUID
- INITIAL_PURCHASE webhook has a valid UUID
- RevenueCat dashboard shows email/name from the start

## Core Architectural Challenge

When `setSession(data.session)` is called after account creation, `RootNavigator` immediately switches from OnboardingNavigator to MainTabNavigator because `isUnauthenticated = !session` becomes `false`. The user would jump from AccountCreation straight to the passport grid, skipping EmotionalHook, FunctionalHook, and Paywall.

### Solution: Add `needsPostSignupFlow` state

Add a new boolean to `authStore` that keeps the user in the onboarding navigator after account creation until the post-signup screens (hooks + paywall) are complete. The RootNavigator condition changes from:

```typescript
// CURRENT
const isUnauthenticated = !session;
const shouldShowOnboarding = isUnauthenticated && !hasCompletedOnboarding;
```

to:

```typescript
// PROPOSED
const isUnauthenticated = !session;
const needsPostSignup = useAuthStore((s) => s.needsPostSignupFlow);
const shouldShowOnboarding = (isUnauthenticated && !hasCompletedOnboarding) || needsPostSignup;
```

This way, after account creation:
1. `setSession()` is called → user is authenticated
2. `needsPostSignupFlow` is set to `true` → onboarding continues to show
3. User sees EmotionalHook → FunctionalHook → Paywall (now authenticated!)
4. After paywall, `needsPostSignupFlow` is set to `false` → RootNavigator switches to Main

## Detailed File Changes

### 1. `mobile/src/stores/authStore.ts`

**Add `needsPostSignupFlow` state and action:**

```typescript
interface AuthState {
  // ... existing fields
  needsPostSignupFlow: boolean;

  // ... existing actions
  setNeedsPostSignupFlow: (needs: boolean) => void;
}
```

Add to initial state: `needsPostSignupFlow: false`
Add action: `setNeedsPostSignupFlow: (needs) => set({ needsPostSignupFlow: needs })`
Update `signOut`: reset `needsPostSignupFlow` to `false`

### 2. `mobile/src/navigation/RootNavigator.tsx`

**Keep OnboardingNavigator visible when `needsPostSignupFlow` is true:**

```typescript
export function RootNavigator() {
  const { session, hasCompletedOnboarding, isLoading } = useAuthStore();
  const needsPostSignupFlow = useAuthStore((s) => s.needsPostSignupFlow);

  // ...

  const isUnauthenticated = !session;
  const shouldShowOnboarding =
    (isUnauthenticated && !hasCompletedOnboarding) || needsPostSignupFlow;

  return (
    <ErrorBoundary>
      <Stack.Navigator ...>
        {shouldShowOnboarding ? (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
            {isUnauthenticated && (
              <Stack.Screen name="Auth" component={AuthNavigator} />
            )}
          </>
        ) : isUnauthenticated ? (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabNavigator} />
            <Stack.Screen name="PaywallModal" component={PaywallModalScreen} />
          </>
        )}
      </Stack.Navigator>
    </ErrorBoundary>
  );
}
```

Key detail: when `needsPostSignupFlow` is true and user is authenticated, we show OnboardingNavigator but **not** AuthNavigator (the user is already signed in). This prevents the Auth stack from being accessible during the post-signup flow.

### 3. `mobile/src/navigation/OnboardingNavigator.tsx`

**Reorder screens: AccountCreation before hooks and paywall:**

```
WelcomeCarousel → OnboardingSlider → Motivation → HomeCountry →
DreamDestination → ContinentIntro → ContinentCountryGrid → AntarcticaPrompt →
ProgressSummary → NameEntry → AccountCreation → EmotionalHook →
FunctionalHook → Paywall
```

Remove `AccountCreation` from its current position (after Paywall) and place it after `NameEntry`.

Remove `Paywall`'s navigation to `AccountCreation` — it will instead complete the onboarding flow.

### 4. `mobile/src/navigation/types.ts`

No changes needed — `OnboardingStackParamList` already has all the screen names. The navigator ordering doesn't affect types.

### 5. `mobile/src/hooks/useAuth.ts` — `useSignUpWithPassword`

**Set `needsPostSignupFlow` before `setSession()`:**

In `onSuccess`, change the flow to:
1. Store tokens
2. Capture onboarding snapshot
3. Set `isMigrating(true)`
4. **Set `needsPostSignupFlow(true)`** ← NEW
5. Set `hasCompletedOnboarding(false)`
6. Set `setSession(data.session)` — navigator stays on Onboarding because `needsPostSignupFlow` is true
7. Schedule welcome emails, analytics, migration (as before)

```typescript
onSuccess: async (data, variables) => {
  if (data.session) {
    // ... token storage (unchanged)

    const snapshot = captureOnboardingSnapshot();
    setIsMigrating(true);

    // Keep user in onboarding for EmotionalHook → FunctionalHook → Paywall
    setNeedsPostSignupFlow(true);

    // Schedule welcome emails
    try {
      await api.post('/welcome/emails', { display_name: variables.displayName });
    } catch (error) { console.warn('Failed to schedule welcome emails:', error); }

    setHasCompletedOnboarding(false);
    setSession(data.session);
    // ↑ RootNavigator still shows Onboarding because needsPostSignupFlow = true

    // Analytics
    const uniqueCountries = new Set([
      ...snapshot.selectedCountries,
      ...(snapshot.homeCountry ? [snapshot.homeCountry] : []),
    ]);
    Analytics.completeOnboarding({
      countriesCount: uniqueCountries.size,
      homeCountry: snapshot.homeCountry,
      trackingPreference: snapshot.trackingPreference,
    });

    // Background migration
    migrateGuestData(data.session, snapshot)
      .catch(() => console.warn('Migration failed for new password user'))
      .finally(() => setIsMigrating(false));
  }
},
```

### 6. `mobile/src/hooks/useAppleAuth.ts` — `useAppleSignIn`

**Same change for new users: set `needsPostSignupFlow(true)` before `setSession()`.**

In the `onSuccess` handler, in the `else` branch (new user / not `onboarded`):

```typescript
} else {
  const snapshot = captureOnboardingSnapshot();
  setIsMigrating(true);

  // Keep user in onboarding for hooks + paywall
  setNeedsPostSignupFlow(true);

  setSession(data.session);

  // ... analytics, welcome emails, migration (unchanged)
}
```

For **returning users** (`onboarded === true`), do NOT set `needsPostSignupFlow` — they go straight to Main.

### 7. `mobile/src/hooks/useGoogleAuth.ts` — `useGoogleSignIn`

**Same change as Apple auth: set `needsPostSignupFlow(true)` for new users.**

In the `onSuccess` handler, in the `else` branch (new user):

```typescript
} else {
  const snapshot = captureOnboardingSnapshot();
  setIsMigrating(true);

  // Keep user in onboarding for hooks + paywall
  setNeedsPostSignupFlow(true);

  setSession(data.session);

  // ... analytics, welcome emails, migration (unchanged)
}
```

### 8. `mobile/src/screens/onboarding/AccountCreationScreen.tsx`

**Change navigation after account creation: go to EmotionalHook instead of being the terminal screen.**

Currently, `AccountCreationScreen` is the final onboarding screen — it calls `signUp.mutate()` which triggers `setSession()` and the navigator switches to Main.

After the change, `setSession()` fires but `needsPostSignupFlow` keeps the user in OnboardingNavigator. The AccountCreationScreen needs to navigate to the next screen:

- In `useSignUpWithPassword`'s `onSuccess`, after `setSession()`, navigate to `EmotionalHook`
- For Apple/Google auth, same navigation after `onSuccess`

**Option A (preferred): Navigate after mutation success via `onSuccess` callback.**

Add navigation to `AccountCreationScreen`:

```typescript
const signUp = useSignUpWithPassword();

useEffect(() => {
  if (signUp.isSuccess) {
    navigation.navigate('EmotionalHook');
  }
}, [signUp.isSuccess, navigation]);
```

Same for Apple and Google:

```typescript
useEffect(() => {
  if (appleSignIn.isSuccess) {
    navigation.navigate('EmotionalHook');
  }
}, [appleSignIn.isSuccess, navigation]);

useEffect(() => {
  if (googleSignIn.isSuccess) {
    navigation.navigate('EmotionalHook');
  }
}, [googleSignIn.isSuccess, navigation]);
```

### 9. `mobile/src/screens/onboarding/PaywallScreen.tsx`

**Change: after paywall completes, finish onboarding instead of navigating to AccountCreation.**

Replace `proceedToAccountCreation` with `finishOnboarding`:

```typescript
import { storeOnboardingComplete } from '@services/api';
import { useAuthStore } from '@stores/authStore';

export function PaywallScreen({ navigation }: Props) {
  const { setHasCompletedOnboarding, setNeedsPostSignupFlow } = useAuthStore();

  const finishOnboarding = useCallback(async () => {
    // Mark onboarding complete in secure storage
    await storeOnboardingComplete();
    setHasCompletedOnboarding(true);
    // Clear the post-signup flag — RootNavigator will switch to Main
    setNeedsPostSignupFlow(false);
  }, [setHasCompletedOnboarding, setNeedsPostSignupFlow]);

  const handlePresentPaywall = useCallback(async () => {
    if (hasPresented.current) return;
    hasPresented.current = true;
    setIsLoading(false);

    const { cancelled, error } = await presentPaywall();

    if (!cancelled && error) {
      Analytics.paywallDismissed({ location: 'onboarding' });
    }

    // Finish onboarding → transition to Main
    await finishOnboarding();
  }, [presentPaywall, finishOnboarding]);

  // ... rest unchanged
}
```

### 10. `mobile/src/screens/onboarding/EmotionalHookScreen.tsx`

**No change needed.** Already navigates to `FunctionalHook` on continue. The "Login" button navigates to `Auth` which is fine for the pre-signup flow but is slightly odd in the post-signup flow.

**Recommended: hide "Login" button when user is already authenticated.**

```typescript
import { useAuthStore } from '@stores/authStore';

export function EmotionalHookScreen({ navigation }: Props) {
  const session = useAuthStore((s) => s.session);

  // ...

  const handleLogin = () => {
    Analytics.skipToLogin('EmotionalHook');
    navigation.navigate('Auth', { screen: 'Login' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <OnboardingHookHeader
        onBack={() => navigation.goBack()}
        onLogin={session ? undefined : handleLogin}
      />
      {/* ... */}
    </SafeAreaView>
  );
}
```

### 11. `mobile/src/screens/onboarding/FunctionalHookScreen.tsx`

**Same as EmotionalHook: hide "Login" button when already authenticated.**

```typescript
import { useAuthStore } from '@stores/authStore';

export function FunctionalHookScreen({ navigation }: Props) {
  const session = useAuthStore((s) => s.session);

  // ...

  return (
    <SafeAreaView style={styles.container}>
      <OnboardingHookHeader
        onBack={() => navigation.goBack()}
        onLogin={session ? undefined : handleLogin}
      />
      {/* ... */}
    </SafeAreaView>
  );
}
```

**Also verify:** `OnboardingHookHeader` handles `onLogin={undefined}` gracefully (hides the button). If not, update it.

### 12. `mobile/src/components/onboarding/OnboardingHookHeader.tsx`

**Verify:** The header component hides the "Login" button when `onLogin` is undefined/null. If it doesn't, add a conditional:

```typescript
{onLogin && (
  <TouchableOpacity onPress={onLogin}>
    <Text>Login</Text>
  </TouchableOpacity>
)}
```

### 13. `mobile/src/hooks/usePaywallPresentation.ts`

**No change needed.** The `waitForLogIn()` call is already in place. Since the user is now authenticated before the paywall is shown, `prepareLogIn()` and `settleLogIn()` will have been called by `useAuthSession` during account creation. The paywall will correctly wait for `logIn()` to complete.

### 14. `mobile/App.tsx` — Fix race condition

**Remove `fetchCustomerInfo()` from `useAppInitialization`.**

Currently, `useAppInitialization` calls:
```typescript
initializeRevenueCat()
  .then(() => useSubscriptionStore.getState().fetchCustomerInfo())
```

This fetches anonymous customer info on app launch, which can overwrite the subscription status set by `syncRevenueCat()` in `useAuthSession`.

Change to only initialize the SDK, not fetch customer info:
```typescript
useEffect(() => {
  void initAnalytics();
  initializeRevenueCat().catch((error) => {
    console.error('Failed to initialize RevenueCat:', error);
  });
  // ... rest unchanged
}, []);
```

`fetchCustomerInfo()` is already called as part of `syncRevenueCat()` in `useAuthSession` when the user has a session, and in `usePaywallPresentation` after purchases. It does not need to be called for anonymous users.

### 15. `mobile/src/hooks/useAuthSession.ts`

**No changes needed.** `syncRevenueCat()` already calls `prepareLogIn()`, `identifyRevenueCatUser()`, and `settleLogIn()`. This runs when `setSession()` fires the Supabase `onAuthStateChange` listener, which happens during account creation — perfectly timed before the paywall.

### 16. Backend: `backend/app/api/webhooks.py`

**No changes needed.** The webhook already validates `app_user_id` as a UUID. Now that purchases happen after `logIn(supabaseUUID)`, the INITIAL_PURCHASE webhook will contain the correct Supabase UUID and pass validation.

## Flow Walkthrough: New User (Email Auth)

1. User goes through onboarding: WelcomeCarousel → ... → NameEntry
2. User taps "Continue" on NameEntry → navigates to **AccountCreation**
3. User enters email + password → taps "Create Account"
4. `useSignUpWithPassword.onSuccess`:
   - Stores tokens
   - Sets `needsPostSignupFlow(true)`
   - Sets `hasCompletedOnboarding(false)`
   - Sets `setSession(data.session)` → triggers `useAuthSession.onAuthStateChange`
5. `useAuthSession.onAuthStateChange` fires with the new session:
   - Calls `syncRevenueCat(userId, { email, displayName })`
   - This calls `prepareLogIn()`, then `Purchases.logIn(userId)`, then `settleLogIn(true)`
   - Sets email/displayName as subscriber attributes
6. `RootNavigator` re-renders: `session` is set but `needsPostSignupFlow` is true → still shows OnboardingNavigator
7. `AccountCreationScreen` detects `signUp.isSuccess` → navigates to **EmotionalHook**
8. User views EmotionalHook → FunctionalHook → **Paywall**
9. `PaywallScreen` calls `presentPaywall()`:
   - `waitForLogIn()` resolves `true` (logIn already completed in step 5)
   - Paywall UI shows, purchase attaches to Supabase UUID
   - INITIAL_PURCHASE webhook fires with Supabase UUID → passes validation → DB updated
10. After paywall: `finishOnboarding()` sets `hasCompletedOnboarding(true)`, `needsPostSignupFlow(false)`
11. `RootNavigator` re-renders: session exists, no post-signup flow → shows MainTabNavigator

## Flow Walkthrough: New User (Apple Auth)

1. User reaches AccountCreation screen in onboarding
2. User taps "Continue with Apple"
3. `useAppleSignIn.mutationFn` runs:
   - Apple sign-in sheet shows → user authenticates
   - `supabase.auth.signInWithIdToken()` → session created
   - Tokens stored, display name updated via RPC
4. `useAppleSignIn.onSuccess`:
   - `hasUserOnboarded()` returns false (new user)
   - Sets `needsPostSignupFlow(true)`, `isMigrating(true)`
   - Sets `setSession(data.session)` → triggers useAuthSession
5. Same as email flow from step 5 onwards

## Flow Walkthrough: New User (Google Auth)

Same as Apple auth flow — identical pattern.

## Flow Walkthrough: Returning User (Any Auth Method)

1. User opens app, session is restored by `useAuthSession.initAuth`
2. `hasCompletedOnboarding` is restored from SecureStore
3. `needsPostSignupFlow` defaults to `false`
4. `RootNavigator`: session exists, no post-signup flow → shows MainTabNavigator
5. User sees passport grid immediately

**OR** returning user signs in from AuthScreen:
1. `useSignInWithPassword.onSuccess`:
   - `hasUserOnboarded()` returns true
   - Sets `hasCompletedOnboarding(true)`, stores to SecureStore
   - Sets `setSession(data.session)`
   - Does NOT set `needsPostSignupFlow`
2. `RootNavigator`: session exists, no post-signup flow → shows MainTabNavigator

## Edge Cases

### User force-quits during post-signup flow
- `needsPostSignupFlow` is in Zustand but NOT persisted to AsyncStorage
- On next launch, `useAuthSession.initAuth` restores the session
- `needsPostSignupFlow` defaults to `false` → user goes to Main
- They missed the paywall but their account exists with RevenueCat linkage
- They can subscribe later from settings

### User presses back on EmotionalHook after account creation
- They go back to AccountCreation screen, which now shows them signed-in state
- This is a bit awkward but harmless. AccountCreation could detect `session` and show a "Continue" button instead or auto-navigate forward.
- **Recommended: prevent back navigation** on EmotionalHook when `session` exists (disable gesture back, hide back button when authenticated)

### Apple/Google auth on AccountCreation screen as returning user
- `hasUserOnboarded()` returns `true` for returning users
- `onSuccess` sets `hasCompletedOnboarding(true)`, does NOT set `needsPostSignupFlow`
- `RootNavigator` switches to Main immediately — correct behavior

### `waitForLogIn()` timing
- `syncRevenueCat()` fires when `setSession()` triggers `onAuthStateChange` in `useAuthSession`
- The paywall is 2 screens later (EmotionalHook → FunctionalHook → Paywall)
- By the time the user reaches Paywall, `logIn()` has almost certainly completed
- Even if it hasn't, `waitForLogIn()` will block until it resolves — correct behavior

### Webhook races during onboarding paywall
- After account creation, `Purchases.logIn(supabaseUUID)` runs
- If user purchases immediately, the INITIAL_PURCHASE webhook will have the Supabase UUID
- `syncRevenueCat` also calls `/subscriptions/verify` which serves as a fallback
- Multiple sources of truth that converge correctly

## Summary of All File Changes

| File | Change |
|------|--------|
| `mobile/src/stores/authStore.ts` | Add `needsPostSignupFlow` state + setter |
| `mobile/src/navigation/RootNavigator.tsx` | Use `needsPostSignupFlow` in conditional rendering |
| `mobile/src/navigation/OnboardingNavigator.tsx` | Reorder: AccountCreation before EmotionalHook |
| `mobile/src/hooks/useAuth.ts` | Set `needsPostSignupFlow(true)` in `useSignUpWithPassword.onSuccess` |
| `mobile/src/hooks/useAppleAuth.ts` | Set `needsPostSignupFlow(true)` for new users in `onSuccess` |
| `mobile/src/hooks/useGoogleAuth.ts` | Set `needsPostSignupFlow(true)` for new users in `onSuccess` |
| `mobile/src/screens/onboarding/AccountCreationScreen.tsx` | Navigate to EmotionalHook after successful signup |
| `mobile/src/screens/onboarding/PaywallScreen.tsx` | Call `finishOnboarding()` instead of navigating to AccountCreation |
| `mobile/src/screens/onboarding/EmotionalHookScreen.tsx` | Hide "Login" button when already authenticated |
| `mobile/src/screens/onboarding/FunctionalHookScreen.tsx` | Hide "Login" button when already authenticated |
| `mobile/src/components/onboarding/OnboardingHookHeader.tsx` | Verify null-safe `onLogin` handling |
| `mobile/App.tsx` | Remove `fetchCustomerInfo()` from `useAppInitialization` |

**No backend changes needed.** The webhook handler already works correctly with Supabase UUIDs.
