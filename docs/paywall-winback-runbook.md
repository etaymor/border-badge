# Paywall Winback + Weekly Trial Removal: Rollout Runbook

The code for the $24.99/yr winback offer ships in the app, but it does nothing
until the store products and the RevenueCat offering exist. This runbook covers
the manual steps outside the codebase, in order, and how to check each one.

How the feature works is described in `docs/SUBSCRIPTION.md` under "Winback Offer".

## What changes for users

- Closing the standard paywall without buying shows a one-time $24.99/yr offer.
- Long-pressing the app icon shows "Deleting? Get 50% off" to signed-in free
  users. Tapping it opens the same offer.
- Each of those two triggers fires at most once per install.
- The Weekly plan ($4.99) no longer has a 7-day free trial. Monthly and Annual
  keep theirs.

## Order of operations

The app ignores a missing `winback` offering: both triggers do nothing and
nobody's one chance is used up. So the steps can run in any order without user
harm. This order gets the product through App Review with the build that needs it.

1. App Store Connect: create the product and remove the Weekly trial.
2. RevenueCat: add the product, entitlement, offering and paywall.
3. Build and submit a new binary together with the new product.
4. Verify in sandbox and TestFlight.
5. Watch the analytics after release.

---

## 1. App Store Connect

**App > Monetization > Subscriptions > subscription group "Premium Access"**

### 1a. Create the winback product

| Field | Value |
|-------|-------|
| Reference name | Annual Winback |
| Product ID | `com.atlasi.app.AnnualWinback` (must match exactly) |
| Duration | 1 year |
| Price | $24.99 (USD base; let Apple fill in the other storefronts, or set them by hand) |
| Introductory offer | **None** |
| Localization (en-US) | Display name "Annual", description "Full access, billed yearly" |
| Review screenshot | Screenshot of the winback paywall (take it after step 2) |

- **Level:** in the group's level ordering, put Annual Winback **at the same
  level as Annual**. Then switching between the two counts as a crossgrade and
  not an upgrade or downgrade.
- **Name matters:** the backend webhook finds the plan by substring
  (`backend/app/api/webhooks.py`). "AnnualWinback" contains "Annual", so it maps
  to the `annual` plan with no backend change.

### 1b. Remove the Weekly free trial

**Subscription `com.atlasi.app.Weekly` > Subscription Prices > Introductory Offers**

- End or delete the 7-day free-trial introductory offer, in every storefront
  it's set for.
- Existing trials already in progress are not affected.
- Check that Monthly and Annual still have their 7-day trials.

### 1c. Submit the product for review

A new subscription product has to be reviewed with a binary. Attach
Annual Winback to the app version you submit in step 3 (the
"In-App Purchases and Subscriptions" section of the version page).

---

## 2. RevenueCat dashboard

### 2a. Product

**Product catalog > Products > + New**

- App Store product ID: `com.atlasi.app.AnnualWinback`
- Identifier: `annual_winback`

### 2b. Entitlement

**Product catalog > Entitlements > `Full Access` > Attach**

- Attach `annual_winback`. If you skip this, a buyer pays and gets nothing.

### 2c. Offering

**Product catalog > Offerings > + New**

| Field | Value |
|-------|-------|
| Identifier | `winback` (must match `WINBACK_OFFERING_ID` in `mobile/src/services/revenueCat.ts`) |
| Display name | Winback |
| Packages | One package: Annual (`$rc_annual`) holding `annual_winback` |
| Current offering | **No**. Leave `default` as current. |

### 2d. Paywall for the winback offering

**Paywalls > + New paywall > attach it to the `winback` offering**

- Frame it as a one-time offer, for example: "One-time offer: 50% off. $24.99/year."
- Show the real renewal price. It renews at $24.99, and App Review checks this.
- No trial copy, because this product has no trial.
- Keep the close button. The app presents it with `displayCloseButton: true`.

### 2e. Main paywall trial copy

**Paywalls > the `default` offering's paywall**

- Make sure any "7-day free trial" text uses RevenueCat's per-package intro
  offer variables, or is written per package, so it is **not** shown on the
  Weekly package.
- Preview it with Weekly selected: the call to action should read as a straight
  purchase ("Subscribe for $4.99/week"), not "Start free trial".

---

## 3. Build and release

Remote config alone can't ship this, and an OTA update can't either.
`expo-quick-actions` is a new native module.

```bash
cd mobile
# bump `version` in app.config.js (see CLAUDE.md: autoIncrement is not supported)
eas build --platform ios --profile production
eas submit --platform ios
```

In App Store Connect, attach **Annual Winback** to the version before you submit
it for review (step 1c).

> Do not ship any part of this with `npm run update:production`. An OTA update
> to a binary without the native module would crash the quick-action hook when
> it tries to import it.

---

## 4. Verification

### 4a. Local (simulator, StoreKit config)

`mobile/Products.storekit` already includes the winback product and has no
Weekly trial. It is wired into the Xcode scheme by `plugins/withStoreKitConfig.js`.

1. Start fresh: delete the app, or clear AsyncStorage keys `winback_used:*`.
2. Onboarding: close the paywall. **Expected:** the winback paywall appears
   about half a second later.
3. Close it. **Expected:** onboarding moves on to the first-quiz offer. There is
   no third paywall.
4. Hit a feature limit, for example the 11th entry on a trip, and close that
   paywall. **Expected:** no winback, because `paywall_close` has already been used.
5. Long-press the app icon. **Expected:** "Deleting? Get 50% off" appears with
   the subtitle "One-time offer: $24.99/year".
6. Tap it. **Expected:** the winback paywall opens. Close it and long-press
   again: the action is gone.
7. Kill the app, set up a fresh install, long-press the icon and tap the action
   from a cold start. **Expected:** the app opens and then shows the winback paywall.

### 4b. Sandbox (TestFlight or a dev build on a device with a sandbox tester)

1. Buy the winback from the paywall-close trigger.
   - The app shows premium.
   - The quick action disappears.
   - The Share Extension no longer enforces the 5-per-month limit, which confirms
     the App Group sync ran.
2. RevenueCat customer page: the active entitlement is `Full Access` and the
   product is `com.atlasi.app.AnnualWinback`.
3. Backend: `user_profile.subscription_status` is premium and `plan` is `annual`.
   Or check the `INITIAL_PURCHASE` webhook in the logs.
4. With a new sandbox tester, open the paywall and select Weekly.
   - The paywall shows no trial.
   - The Apple purchase sheet shows the full price with no "free for 1 week" line.

### 4c. Kill switch check (optional)

Temporarily rename the `winback` offering in RevenueCat, then close the paywall
on a fresh install. **Expected:** no winback, and the `winback_used:paywall_close`
key is **not** written. Rename it back afterwards.

---

## 5. After release: what to watch (PostHog)

Events are documented in `docs/analytics.md` under "Paywall and winback".

- **Winback reach:** `winback_shown`, broken down by `trigger`.
- **Winback conversion:** `purchase_completed` where `offer = winback`, divided
  by `view_paywall` where `offer = winback`.
- **Cannibalization:** watch standard `purchase_completed` where
  `offer = standard` and `plan = annual`. If it drops noticeably, users may be
  learning to close the paywall to get the discount.
- **Weekly without a trial:** compare `plan = weekly` purchases before and after.
  Revenue should be up even if the count is down, because there are no
  trial-to-cancel users any more.

## Rollback

| Problem | Action | Needs a build? |
|---------|--------|----------------|
| Turn off the winback everywhere | Delete or rename the `winback` offering in RevenueCat | No |
| Change the winback price | Change the price in App Store Connect. Applies to new purchases. | No |
| Bring back the Weekly trial | Add the introductory offer back on `com.atlasi.app.Weekly` in App Store Connect | No |
| Change the quick action wording | Edit `WINBACK_QUICK_ACTION` in `mobile/src/hooks/useWinbackQuickAction.ts` | OTA is fine once the native module has shipped |
| Remove the quick action entirely | Remove `useWinbackQuickAction` from `App.tsx` | OTA is fine; the module can stay in the binary |
