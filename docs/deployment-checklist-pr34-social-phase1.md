# Deployment Checklist: PR #34 - Friends & Social System Phase 1

**PR Title:** feat(social): implement Friends & Social System Phase 1
**Branch:** `feature/friends-social-phase-1`
**Risk Level:** HIGH - Multiple schema changes, new tables, RLS policy updates
**Estimated Deploy Time:** 30-45 minutes (including verification)

---

## Table of Contents

1. [Data Invariants](#1-data-invariants)
2. [Pre-Deploy Verification](#2-pre-deploy-verification)
3. [Environment Variables](#3-environment-variables)
4. [Migration Execution](#4-migration-execution)
5. [Edge Function Deployment](#5-edge-function-deployment)
6. [Post-Deploy Verification](#6-post-deploy-verification)
7. [API Smoke Tests](#7-api-smoke-tests)
8. [Rollback Procedures](#8-rollback-procedures)
9. [Monitoring Plan](#9-monitoring-plan)

---

## 1. Data Invariants

These invariants MUST remain true before and after deployment:

### Existing Data Protection
- [ ] All existing `user_profile` records remain intact
- [ ] All existing `trip` records remain accessible to their owners
- [ ] All existing `entry` records remain accessible through their parent trips
- [ ] No user loses access to their own data

### New Schema Invariants
- [ ] All `user_profile.username` values are unique (case-insensitive)
- [ ] All `user_profile.username` values match format: 3-30 chars, alphanumeric + underscore only
- [ ] No user can follow themselves (`follower_id != following_id`)
- [ ] No user can block themselves (`blocker_id != blocked_id`)
- [ ] No duplicate follow relationships exist
- [ ] No duplicate block relationships exist

### RLS Policy Invariants
- [ ] Trip visibility: Owner always sees own trips
- [ ] Trip visibility: Approved tagged users see tagged trips (unless blocked)
- [ ] Trip visibility: Followers see followed users' trips (unless blocked)
- [ ] Entry visibility: Follows trip visibility rules
- [ ] Block enforcement: Blocked users cannot see blocker's content

---

## 2. Pre-Deploy Verification

### 2.1 Baseline Counts (Save These Values)

Run these queries BEFORE deployment and record the results:

```sql
-- Baseline: User profile count
SELECT COUNT(*) as total_users FROM user_profile;
-- Expected: Record current count = ______

-- Baseline: Users with display_name
SELECT COUNT(*) as users_with_display_name
FROM user_profile
WHERE display_name IS NOT NULL;
-- Expected: Record current count = ______

-- Baseline: Trip count by user access
SELECT
  COUNT(*) as total_trips,
  COUNT(*) FILTER (WHERE deleted_at IS NULL) as active_trips
FROM trip;
-- Expected: Record counts = ______ / ______

-- Baseline: Entry count
SELECT COUNT(*) as total_entries FROM entry WHERE deleted_at IS NULL;
-- Expected: Record current count = ______
```

### 2.2 Pre-Migration Schema Verification

```sql
-- Verify user_profile table exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'user_profile'
ORDER BY ordinal_position;

-- Verify trip table exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'trip'
ORDER BY ordinal_position;

-- Check current RLS policies on trip table
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'trip';

-- Check if username column already exists (in case of partial migration)
SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_name = 'user_profile' AND column_name = 'username'
) as username_exists;
```

### 2.3 Data Quality Checks

```sql
-- Check for NULL display_names that would cause username generation issues
SELECT COUNT(*) as null_display_names
FROM user_profile
WHERE display_name IS NULL;
-- Expected: 0 or handle in migration

-- Check for display_names that might generate invalid usernames
SELECT id, display_name
FROM user_profile
WHERE display_name !~ '[a-zA-Z0-9]';
-- Expected: Handle edge cases in username generation function
```

---

## 3. Environment Variables

### 3.1 Backend Environment (`backend/.env`)

**Required for Production:**

| Variable | Required | Purpose | How to Verify |
|----------|----------|---------|---------------|
| `INVITE_SIGNING_SECRET` | YES | HMAC signing for invite codes | `echo $INVITE_SIGNING_SECRET` (32+ char random string) |
| `SUPABASE_URL` | YES | Supabase project URL | Already configured |
| `SUPABASE_SERVICE_ROLE_KEY` | YES | Admin operations | Already configured |

```bash
# Verify backend environment
cd backend
grep -E "^INVITE_SIGNING_SECRET=" .env
# Expected: INVITE_SIGNING_SECRET=<32+ character random string>

# Generate a secure secret if missing:
# openssl rand -hex 32
```

**Pre-Deploy Check:**
- [ ] `INVITE_SIGNING_SECRET` is set in production environment
- [ ] Secret is at least 32 characters (256 bits)
- [ ] Secret is NOT the default dev value `dev-secret-change-in-production`

### 3.2 Supabase Edge Function Secrets

**Required for Edge Functions:**

| Secret | Edge Function | Purpose |
|--------|---------------|---------|
| `RESEND_API_KEY` | `send-invite-email` | Email delivery via Resend |
| `APP_URL` | `send-invite-email` | Base URL for invite links |
| `SUPABASE_URL` | `process-signup-invites` | Database access |
| `SUPABASE_SERVICE_ROLE_KEY` | `process-signup-invites` | Admin database access |

```bash
# Set edge function secrets via Supabase CLI
supabase secrets set RESEND_API_KEY=re_xxxxx
supabase secrets set APP_URL=https://borderbadge.app

# Verify secrets are set
supabase secrets list
```

**Pre-Deploy Check:**
- [ ] `RESEND_API_KEY` configured in Supabase secrets
- [ ] `APP_URL` configured in Supabase secrets
- [ ] Resend domain verified for `borderbadge.app`

---

## 4. Migration Execution

### 4.1 Migration Order (MUST be sequential)

| Order | Migration File | Description | Estimated Time | Rollback Complexity |
|-------|---------------|-------------|----------------|---------------------|
| 1 | `0032_add_username.sql` | Add username column, generate for existing users | ~1-2 min | Medium - drop column |
| 2 | `0033_social_tables.sql` | Create user_follow, user_block, pending_invite tables | ~30 sec | Easy - drop tables |
| 3 | `0034_feed_function.sql` | Create get_activity_feed function | ~10 sec | Easy - drop function |
| 4 | `0035_ranking_function.sql` | Create get_friends_ranking function | ~10 sec | Easy - drop function |
| 5 | `0036_check_email_function.sql` | Create check_email_exists function, add invite_code | ~10 sec | Easy - drop function |
| 6 | `0037_push_token_column.sql` | Add push_token, push_platform columns | ~10 sec | Easy - drop columns |
| 7 | `0038_trip_visibility_followers.sql` | Update trip/entry RLS policies | ~10 sec | Medium - restore policies |
| 8 | `0039_user_activity_feed.sql` | Create get_user_activity_feed function | ~10 sec | Easy - drop function |

### 4.2 Migration Execution Steps

```bash
# Option A: Via Supabase Dashboard
# 1. Go to SQL Editor in Supabase Dashboard
# 2. Run each migration file in order
# 3. Verify each completes before running next

# Option B: Via Supabase CLI
cd supabase
supabase db push

# Option C: Manual execution per migration (safest)
# Run each file individually and verify before proceeding
```

### 4.3 Migration Verification Queries

**After Migration 0032 (username):**
```sql
-- Verify username column exists and is NOT NULL
SELECT COUNT(*) as users_without_username
FROM user_profile
WHERE username IS NULL;
-- Expected: 0

-- Verify unique index exists
SELECT indexname FROM pg_indexes
WHERE tablename = 'user_profile' AND indexname = 'idx_user_profile_username_lower';
-- Expected: 1 row

-- Verify username format constraint
SELECT COUNT(*) as invalid_usernames
FROM user_profile
WHERE username !~ '^[a-zA-Z0-9_]+$'
   OR LENGTH(username) < 3
   OR LENGTH(username) > 30;
-- Expected: 0
```

**After Migration 0033 (social tables):**
```sql
-- Verify tables created
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('user_follow', 'user_block', 'pending_invite')
ORDER BY table_name;
-- Expected: 3 rows

-- Verify RLS enabled
SELECT tablename, rowsecurity FROM pg_tables
WHERE tablename IN ('user_follow', 'user_block', 'pending_invite');
-- Expected: All show rowsecurity = true

-- Verify RLS policies exist
SELECT tablename, policyname FROM pg_policies
WHERE tablename IN ('user_follow', 'user_block', 'pending_invite')
ORDER BY tablename, policyname;
-- Expected: Multiple policies per table
```

**After Migration 0034-0035 (functions):**
```sql
-- Verify functions created
SELECT routine_name FROM information_schema.routines
WHERE routine_name IN ('get_activity_feed', 'get_friends_ranking', 'is_blocked_bidirectional')
  AND routine_type = 'FUNCTION';
-- Expected: 3 rows
```

**After Migration 0036 (check_email):**
```sql
-- Verify check_email_exists function
SELECT routine_name FROM information_schema.routines
WHERE routine_name = 'check_email_exists';
-- Expected: 1 row

-- Verify invite_code column added
SELECT column_name FROM information_schema.columns
WHERE table_name = 'pending_invite' AND column_name = 'invite_code';
-- Expected: 1 row
```

**After Migration 0037 (push tokens):**
```sql
-- Verify push columns added
SELECT column_name FROM information_schema.columns
WHERE table_name = 'user_profile' AND column_name IN ('push_token', 'push_platform');
-- Expected: 2 rows
```

**After Migration 0038 (RLS policies):**
```sql
-- Verify trip visibility policy updated
SELECT policyname FROM pg_policies
WHERE tablename = 'trip' AND policyname = 'Trip visibility with followers and blocks';
-- Expected: 1 row

-- Verify entry visibility policy
SELECT policyname FROM pg_policies
WHERE tablename = 'entry' AND policyname = 'Entry visibility matches trip';
-- Expected: 1 row
```

---

## 5. Edge Function Deployment

### 5.1 Deploy Edge Functions

```bash
cd supabase

# Deploy all edge functions
supabase functions deploy send-push-notification
supabase functions deploy send-invite-email
supabase functions deploy process-signup-invites

# Verify deployment
supabase functions list
```

### 5.2 Edge Function Health Checks

**send-push-notification:**
```bash
# Test with empty request (should return 400)
curl -X POST "https://<project>.supabase.co/functions/v1/send-push-notification" \
  -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: {"error":"No push tokens provided"}
```

**send-invite-email:**
```bash
# Test without RESEND_API_KEY configured (should return 500)
curl -X POST "https://<project>.supabase.co/functions/v1/send-invite-email" \
  -H "Authorization: Bearer <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","inviter_name":"Test","invite_code":"abc"}'
# Expected: Either success or "Email service not configured" error
```

### 5.3 Database Webhook Setup (process-signup-invites)

```sql
-- Create webhook trigger for new user signups
-- This should be configured in Supabase Dashboard > Database > Webhooks

-- Webhook configuration:
-- Name: process-signup-invites
-- Table: auth.users
-- Events: INSERT
-- URL: https://<project>.supabase.co/functions/v1/process-signup-invites
-- HTTP Headers: Authorization: Bearer <service-role-key>
```

**Pre-Deploy Check:**
- [ ] Edge function `send-push-notification` deployed
- [ ] Edge function `send-invite-email` deployed
- [ ] Edge function `process-signup-invites` deployed
- [ ] Database webhook configured for `auth.users` INSERT events

---

## 6. Post-Deploy Verification

### 6.1 Immediate Verification (Within 5 Minutes)

```sql
-- Verify all users have valid usernames
SELECT COUNT(*) as users_without_valid_username
FROM user_profile
WHERE username IS NULL
   OR LENGTH(username) < 3
   OR LENGTH(username) > 30
   OR username !~ '^[a-zA-Z0-9_]+$';
-- Expected: 0

-- Verify no username collisions (case-insensitive)
SELECT LOWER(username), COUNT(*)
FROM user_profile
GROUP BY LOWER(username)
HAVING COUNT(*) > 1;
-- Expected: 0 rows

-- Verify user counts match baseline
SELECT COUNT(*) as total_users FROM user_profile;
-- Compare with pre-deploy baseline

-- Verify trip counts match baseline
SELECT
  COUNT(*) as total_trips,
  COUNT(*) FILTER (WHERE deleted_at IS NULL) as active_trips
FROM trip;
-- Compare with pre-deploy baseline

-- Verify no orphaned data
SELECT COUNT(*) as orphaned_entries
FROM entry e
LEFT JOIN trip t ON e.trip_id = t.id
WHERE t.id IS NULL AND e.deleted_at IS NULL;
-- Expected: 0
```

### 6.2 RLS Policy Verification

```sql
-- Test: User can see their own trips
-- Run as authenticated user (set role)
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "<test-user-id>"}';

SELECT COUNT(*) FROM trip WHERE user_id = '<test-user-id>';
-- Expected: Returns user's trip count

-- Test: User cannot see other users' trips (without following)
SELECT COUNT(*) FROM trip WHERE user_id = '<other-user-id>';
-- Expected: 0 (unless following relationship exists)

RESET ROLE;
```

### 6.3 Function Verification

```sql
-- Test get_activity_feed function
SELECT * FROM get_activity_feed(
  '<user-id>'::UUID,
  NULL,
  5
);
-- Expected: Returns up to 5 activities from followed users (may be empty)

-- Test get_friends_ranking function
SELECT * FROM get_friends_ranking('<user-id>'::UUID);
-- Expected: Returns rank, total_friends, my_countries, leader info

-- Test check_username_availability function
SELECT * FROM check_username_availability('test_user_123');
-- Expected: available = true/false, reason, suggestions

-- Test check_email_exists function (service role only)
SELECT * FROM check_email_exists('test@example.com');
-- Expected: {"exists": true/false}
```

---

## 7. API Smoke Tests

### 7.1 New API Endpoints

Run these curl commands against production API after deployment:

**Profile with Username:**
```bash
curl -X GET "https://api.borderbadge.app/profile" \
  -H "Authorization: Bearer <user-token>"
# Expected: Response includes "username" field
```

**Follow System:**
```bash
# Get follow stats
curl -X GET "https://api.borderbadge.app/follows/stats" \
  -H "Authorization: Bearer <user-token>"
# Expected: {"follower_count": 0, "following_count": 0}

# Get following list
curl -X GET "https://api.borderbadge.app/follows/following" \
  -H "Authorization: Bearer <user-token>"
# Expected: [] (empty array for new users)
```

**Activity Feed:**
```bash
curl -X GET "https://api.borderbadge.app/feed" \
  -H "Authorization: Bearer <user-token>"
# Expected: {"items": [], "next_cursor": null, "has_more": false}
```

**Block System:**
```bash
curl -X GET "https://api.borderbadge.app/blocks" \
  -H "Authorization: Bearer <user-token>"
# Expected: [] (empty array)
```

**User Search:**
```bash
curl -X GET "https://api.borderbadge.app/users/search?q=test" \
  -H "Authorization: Bearer <user-token>"
# Expected: Array of matching user profiles
```

**Push Token Registration:**
```bash
curl -X POST "https://api.borderbadge.app/notifications/register" \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"token": "ExponentPushToken[xxxx]", "platform": "ios"}'
# Expected: {"status": "registered"}
```

### 7.2 Existing API Regression Tests

```bash
# Verify existing endpoints still work
curl -X GET "https://api.borderbadge.app/countries" \
  -H "Authorization: Bearer <user-token>"
# Expected: List of countries

curl -X GET "https://api.borderbadge.app/trips" \
  -H "Authorization: Bearer <user-token>"
# Expected: User's trips
```

---

## 8. Rollback Procedures

### 8.1 Rollback Decision Matrix

| Condition | Action |
|-----------|--------|
| Migration 0032 fails mid-execution | Rollback username column |
| RLS policies break existing access | Revert to previous policies immediately |
| Edge functions fail to deploy | App still works, invites disabled |
| API endpoints return 500 errors | Deploy previous backend version |

### 8.2 Full Rollback Steps

**Step 1: Revert Backend Code**
```bash
# Deploy previous backend version
git checkout <previous-commit>
# Or revert PR merge
git revert <merge-commit>
```

**Step 2: Rollback Database (DANGER - Data Loss Possible)**

```sql
-- CAUTION: Only run if absolutely necessary
-- This will lose all social data created after deployment

-- Rollback 0039: Drop user activity feed function
DROP FUNCTION IF EXISTS get_user_activity_feed(UUID, UUID, TIMESTAMPTZ, INT);

-- Rollback 0038: Restore original RLS policies
DROP POLICY IF EXISTS "Trip visibility with followers and blocks" ON trip;
DROP POLICY IF EXISTS "Entry visibility matches trip" ON entry;
-- Re-create original policies (from backup/previous migration)

-- Rollback 0037: Remove push columns
ALTER TABLE user_profile DROP COLUMN IF EXISTS push_token;
ALTER TABLE user_profile DROP COLUMN IF EXISTS push_platform;

-- Rollback 0036: Drop check_email function
DROP FUNCTION IF EXISTS check_email_exists(TEXT);
ALTER TABLE pending_invite DROP COLUMN IF EXISTS invite_code;

-- Rollback 0035: Drop ranking function
DROP FUNCTION IF EXISTS get_friends_ranking(UUID);

-- Rollback 0034: Drop feed function
DROP FUNCTION IF EXISTS get_activity_feed(UUID, TIMESTAMPTZ, INT);

-- Rollback 0033: Drop social tables
DROP TABLE IF EXISTS pending_invite CASCADE;
DROP TABLE IF EXISTS user_block CASCADE;
DROP TABLE IF EXISTS user_follow CASCADE;
DROP TYPE IF EXISTS invite_type CASCADE;
DROP FUNCTION IF EXISTS is_blocked_bidirectional(UUID);
DROP FUNCTION IF EXISTS get_user_country_counts(UUID[]);

-- Rollback 0032: Remove username (CAUTION - loses usernames)
ALTER TABLE user_profile DROP COLUMN IF EXISTS username;
DROP FUNCTION IF EXISTS generate_username_from_name(TEXT);
DROP FUNCTION IF EXISTS check_username_availability(TEXT);
-- Restore original handle_new_user trigger (from backup)
```

**Step 3: Disable Edge Functions**
```bash
# Delete edge functions
supabase functions delete send-push-notification
supabase functions delete send-invite-email
supabase functions delete process-signup-invites

# Remove database webhook (via Supabase Dashboard)
```

### 8.3 Partial Rollback (Feature Flag Approach)

If issues are isolated to specific features:

```sql
-- Disable new RLS policies without full rollback
-- Add feature flag check to policies

-- Or: Temporarily disable problematic features in backend
-- by returning empty responses from affected endpoints
```

---

## 9. Monitoring Plan

### 9.1 Key Metrics to Watch

| Metric | Source | Alert Threshold | Dashboard |
|--------|--------|-----------------|-----------|
| API Error Rate | Backend logs | > 1% for 5 min | Datadog/CloudWatch |
| API Response Time (p95) | Backend logs | > 2s for 5 min | Datadog/CloudWatch |
| Database Connection Errors | Supabase logs | Any | Supabase Dashboard |
| RLS Policy Errors | Supabase logs | Any | Supabase Dashboard |
| Edge Function Errors | Supabase logs | > 5% | Supabase Dashboard |
| New User Signup Rate | Auth events | < 50% of baseline | Analytics |

### 9.2 Error Patterns to Alert On

| Error Pattern | Meaning | Action |
|---------------|---------|--------|
| `permission denied for table user_profile` | RLS policy issue | Check policy migration |
| `null value in column "username"` | Username migration incomplete | Run backfill |
| `check constraint "chk_username_format"` | Invalid username generated | Fix generation function |
| `duplicate key value violates unique constraint` | Username collision | Check uniqueness |
| `Edge function 'X' call failed` | Edge function down | Check Supabase |

### 9.3 Post-Deploy Monitoring Schedule

| Time | Action |
|------|--------|
| +0 min | Verify migrations complete, run immediate checks |
| +5 min | Run all SQL verification queries |
| +15 min | Complete API smoke tests |
| +30 min | Review error logs, check user reports |
| +1 hour | Console spot check, verify baselines |
| +4 hours | Review metrics trends |
| +24 hours | Final verification, close deployment ticket |

### 9.4 Console Spot Checks

```ruby
# Run in production console 1 hour after deploy

# Verify username distribution
UserProfile.group("LENGTH(username)").count
# Expected: Distribution of username lengths

# Spot check random users have valid usernames
UserProfile.order("RANDOM()").limit(10).pluck(:username)
# Expected: All valid usernames

# Check for any orphaned social data
UserFollow.where("follower_id NOT IN (SELECT user_id FROM user_profile)").count
# Expected: 0

# Verify no blocked users can see blocker content
# (manual verification with test accounts)
```

---

## Go/No-Go Summary

### Pre-Deploy Required
- [ ] All baseline counts recorded
- [ ] `INVITE_SIGNING_SECRET` set in production (32+ chars)
- [ ] `RESEND_API_KEY` configured in Supabase secrets
- [ ] `APP_URL` configured in Supabase secrets
- [ ] Staging test passed
- [ ] Rollback plan reviewed by team
- [ ] On-call engineer identified

### Deploy Steps
1. [ ] Run migrations 0032-0039 in order
2. [ ] Verify each migration completes
3. [ ] Deploy backend code
4. [ ] Deploy edge functions
5. [ ] Configure database webhook
6. [ ] Run immediate verification queries

### Post-Deploy Required
- [ ] All verification queries pass
- [ ] API smoke tests pass
- [ ] No increase in error rate
- [ ] Baseline counts match
- [ ] Test follow/block/invite flow manually

### Close Deployment
- [ ] 24-hour monitoring complete
- [ ] No user reports of issues
- [ ] Deployment ticket closed
- [ ] Rollback artifacts retained for 7 days

---

## Quick Reference: Critical Files

| File | Path | Purpose |
|------|------|---------|
| Migration 0032 | `/Users/emerson/Sites/border-badge/supabase/migrations/0032_add_username.sql` | Username system |
| Migration 0033 | `/Users/emerson/Sites/border-badge/supabase/migrations/0033_social_tables.sql` | Social tables + RLS |
| Migration 0038 | `/Users/emerson/Sites/border-badge/supabase/migrations/0038_trip_visibility_followers.sql` | Updated RLS policies |
| Edge Function | `/Users/emerson/Sites/border-badge/supabase/functions/send-push-notification/index.ts` | Push notifications |
| Edge Function | `/Users/emerson/Sites/border-badge/supabase/functions/send-invite-email/index.ts` | Email invites |
| Backend Config | `/Users/emerson/Sites/border-badge/backend/app/core/config.py` | INVITE_SIGNING_SECRET |
| Invite Signer | `/Users/emerson/Sites/border-badge/backend/app/core/invite_signer.py` | HMAC signing logic |
| Follows API | `/Users/emerson/Sites/border-badge/backend/app/api/follows.py` | Follow endpoints |
| Invites API | `/Users/emerson/Sites/border-badge/backend/app/api/invites.py` | Invite endpoints |
| Feed API | `/Users/emerson/Sites/border-badge/backend/app/api/feed.py` | Activity feed |
