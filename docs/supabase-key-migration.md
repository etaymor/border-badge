# Supabase key migration (Railway leak, October 2026)

Railway's security incident leaked the backend environment, including
`SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) and `SUPABASE_JWT_SECRET` (can forge
any token, service_role included). Supabase no longer rotates the legacy JWT
secret, so the fix is to move to the new key system and then retire the
legacy keys.

## Why this takes two releases

The shipped iOS app talks to Supabase directly (`supabase.auth.*`, storage,
rpc) with the **legacy anon key** baked into its bundle. Supabase disables the
legacy anon and service_role keys together, and revoking the legacy JWT secret
invalidates both. An OTA update can't help a fresh App Store install, which
runs the embedded bundle first. So:

- The backend moves fully to the new keys now (this branch).
- A new App Store build ships the publishable key.
- Legacy keys are disabled only once that build has enough adoption.

**Until the final cutover, the leaked service_role key and JWT secret still
work directly against Supabase.** Step 5 only stops forged tokens from working
against *our API*. Keep the gap between "build approved" and "disable legacy"
short.

## Backend behavior (this branch)

- `app/core/supabase_keys.py` picks keys:
  - Admin calls use `SUPABASE_SECRET_KEY`, falling back to `SUPABASE_SERVICE_ROLE_KEY`.
  - RLS calls use `SUPABASE_PUBLISHABLE_KEY`, falling back to `SUPABASE_ANON_KEY`.
  - `sb_secret_` keys go on the `apikey` header only. They are not JWTs, and the
    gateway mints the service_role JWT itself.
- `app/core/security.py` verifies access tokens:
  - ES256/RS256 tokens are checked against the project JWKS. The cache refreshes
    every 10 minutes, and also when it sees an unknown `kid` (no more than once
    every 5 seconds).
  - HS256 tokens are accepted **only while `SUPABASE_JWT_SECRET` is set**.
- `scripts/verify_supabase_keys.py` is a read-only check of every Supabase
  surface the backend uses. Run it after each step below.

## Runbook

1. **Dashboard → Settings → API Keys:** create a publishable key and a new
   secret key (name it `railway-backend`).
2. **Dashboard → Settings → JWT Keys:** if the legacy secret is not yet
   migrated, click "Migrate JWT secret". Confirm that the **current** key is
   still the legacy HS256 secret and the ES256 key is **standby**. Do not
   rotate yet.
3. **Deploy the backend** with these Railway variables:
   - Set `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
   - Keep `SUPABASE_JWT_SECRET`.
   - Delete `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY`.

   Check that the startup log has no `SUPABASE_LEGACY_KEY_IN_USE`. Then
   smoke-test sign-in, the trip list, a photo upload that writes a thumbnail,
   and an admin endpoint called with `Authorization: Bearer sb_secret_…`.
4. **Rotate JWT keys** so ES256 becomes current. The app picks up ES256 tokens
   on its next refresh, and the backend verifies them through the JWKS.
5. **Wait at least the access-token lifetime (default 1h) plus a margin.** Then
   delete `SUPABASE_JWT_SECRET` from Railway and redeploy. After this, a token
   signed with the leaked secret gets a 401 from our API.
6. **Mobile build (no code change):**
   - Set the EAS env var `EXPO_PUBLIC_SUPABASE_ANON_KEY` to the
     `sb_publishable_` value. The variable keeps its old name.
   - Update local `mobile/.env` too, because `eas update` reads SECRET vars
     from it.
   - Bump the build, then run `eas build` and submit.
   - Optionally publish the same value OTA (`npm run update:production`) so
     installs that already exist switch over before cutover.
7. **Cutover**, once adoption of the new build is acceptable:
   - Dashboard → API Keys: disable the legacy keys.
   - JWT Keys: revoke the legacy secret, which is now "previously used".

   Old binaries that never received the OTA lose Supabase auth at this point.
8. **Cleanup:** remove the legacy fallbacks from `supabase_keys.py` and
   `config.py`, and the legacy lines from `.env` files and
   `docs/environment-setup.md`.

## Other secrets to rotate after the leak

All of these were in the same Railway environment:

- `OPENROUTER_API_KEY`
- `GOOGLE_PLACES_API_KEY`, `GOOGLE_MAPS_BROWSER_API_KEY`
- RevenueCat webhook auth / API key
- `AFFILIATE_SIGNING_SECRET` (rotating it invalidates outstanding signed
  redirect URLs)
- `SKIMLINKS_API_KEY`
- `POSTHOG_API_KEY`
- `INSTAGRAM_OEMBED_TOKEN`
- `RESEND_API_KEY`
- Ad-tracking (Meta/TikTok) tokens

Also review the Supabase API and Auth logs for service_role traffic that
didn't come from Railway since the incident window.
