# Migration Reconciliation: main x feature/friends-social-phase-1

The U1 merge of `origin/main` (commit `00a5752e`) brought both sides' migrations into
`supabase/migrations/` with colliding numbers 0032-0057. Main's files are the applied
production history, so they kept their numbers. The branch's 29 social migrations were
renumbered (via `git mv`, preserving relative order) to follow main's highest number
(0057), and a diff-audit re-authored the renumbered files wherever they would have
silently overwritten a fix main landed later.

## Renumbering map (old branch number -> new number)

| Old | New | File |
|-----|-----|------|
| 0032 | 0058 | add_username |
| 0033 | 0059 | social_tables |
| 0034 | 0060 | feed_function |
| 0035 | 0061 | ranking_function |
| 0036 | 0062 | check_email_function |
| 0037 | 0063 | push_token_column |
| 0038 | 0064 | trip_visibility_followers |
| 0039 | 0065 | user_activity_feed |
| 0040 | 0066 | pending_invite_delete_policy |
| 0041 | 0067 | lookup_user_by_email |
| 0042 | 0068 | pending_invite_status_column |
| 0043 | 0069 | fix_handle_new_user_trigger |
| 0044 | 0070 | process_pending_invites_on_signup |
| 0045 | 0071 | feed_performance_optimizations |
| 0046 | 0072 | feed_pagination_fix |
| 0049 | 0073 | user_profile_public_read |
| 0050 | 0074 | feed_composite_indexes_and_batch_limits |
| 0051 | 0075 | user_countries_public_read |
| 0052 | 0076 | profile_stats_function |
| 0053 | 0077 | profile_stats_with_follows |
| 0054 | 0078 | optimize_profile_stats |
| 0055 | 0079 | social_feed_inbox |
| 0056 | 0080 | social_feed_rls_policies |
| 0057 | 0081 | security_definer_search_path |
| 0058 | 0082 | entry_restore_event_trigger |
| 0059 | 0083 | social_home_stats_rpc |
| 0060 | 0084 | push_tokens_table |
| 0061 | 0085 | follow_block_constraint |
| 0062 | 0086 | drop_deprecated_push_token_columns |

(The branch had no 0047/0048, so numbering is contiguous from 0073 onward.)

## Overlap-audit outcomes (files whose CONTENT changed)

Renumbering moves the social files AFTER main's fixes, so any social migration that
redefines a shared object would overwrite main's later fix. Audited overlaps:

1. **`0064_trip_visibility_followers.sql`** (was 0038) - its comprehensive trip SELECT
   policy replaced main's `0054_fix_rls_performance` policies. Re-authored so the
   surviving policy carries BOTH sides: `(select auth.uid())` InitPlan pattern (main
   0054), `deleted_at IS NULL` soft-delete guard (main 0054's view policies), and the
   branch's follower/approved-tag visibility with `is_blocked_bidirectional` checks. It
   now also drops main 0054's "Users can view trips they are tagged on" (the
   comprehensive policy covers approved tags WITH block checks; keeping both would let
   blocked-but-tagged users bypass blocks). Its conditional "Users can insert own
   trips" DO-block was removed because main 0054's "Users can create own trips" INSERT
   policy already exists (avoids a duplicate permissive policy). The update/delete
   DO-blocks remain and no-op: main's 0033/0054 versions (is_system guards + InitPlan)
   are the surviving definitions.

2. **`0081_security_definer_search_path.sql`** (was 0057) - its `soft_delete_trip`
   redefinition predated main's `0034_soft_delete_system_check` and would have dropped
   the `is_system = false` guard. Re-authored to keep the guard and main's
   `SET search_path = public, pg_catalog`. Its `is_blocked_bidirectional` and
   `get_friends_ranking` sections are untouched (main never defined those).

3. **`0058_add_username.sql`** (was 0032) - `check_username_availability` is the
   surviving definition of that function and was SECURITY DEFINER without
   `SET search_path`; added `SET search_path = public` (consistent with main 0053 /
   branch 0081 hardening). The `handle_new_user` in this file is superseded by
   0069/0070, left as-is.

4. **`0074_feed_composite_indexes_and_batch_limits.sql`** (was 0050) -
   `get_user_country_counts` is the surviving definition and was SECURITY DEFINER
   without `SET search_path`; added `SET search_path = public`.

Audited and deliberately NOT changed:

- **`handle_new_user`** (0069/0070, final version in 0070): no main migration touches
  `handle_new_user` or the `auth.users` trigger. The branch versions already insert via
  the correct `user_id` column (main 0049's column fix concerned the subscription
  functions only), carry `SET search_path = public`, and 0070 adds invite processing.
  All `user_profile` columns main added (welcome_emails_scheduled, unsubscribe_token,
  subscription fields) have defaults, so the trigger's INSERT remains valid.
- **`0073_user_profile_public_read` / `0075_user_countries_public_read`**: their
  policies are `USING (true)` (no `auth.uid()` call), so main 0054's InitPlan pattern
  does not apply. 0073 intentionally drops main 0054's "Users can view own profile"
  (public read supersedes it); main's "Users can update own profile" (InitPlan) survives.
- **Entry policies in 0064**: main never touched entry policies; the conditional
  creates behave exactly as they did on the branch. Note: `user_countries` ends up with
  both an own-read and a public-read SELECT policy, and `entry` with both
  "Trip participants can view entries" and the branch's policies - pre-existing branch
  redundancy, not a merge regression.
- No index-name or column-name collisions exist between the two sides (verified by
  script over both file sets).

## Verification status

From-zero apply verification via the local Supabase stack (`supabase start`) was
SKIPPED by user decision (no local Docker stack). The reconciliation was verified
statically instead:

- Migration numbers are unique and gap-free (0000-0086, 87 files).
- Only 4 renumbered files changed content (git rename detection confirms the other 25
  are byte-identical): 0058, 0064, 0074, 0081 - the audited edits listed above.
- The LAST definition of every overlapping function/policy in apply order was checked
  and carries both sides' fixes (search_path, is_system guard, InitPlan pattern,
  invite processing, correct user_profile columns).
- Dollar-quoting and parentheses balance verified for the edited files.

Because no from-zero apply was run, **the drift-check queries below are the critical
safety gate before applying anything to production.**

## Prod drift check (run BEFORE applying anything to production)

Production may already have SOME branch-side social migrations applied under their OLD
numbers (0032-0062) if they were ever pushed from the branch. The queries below
determine actual state; do not assume from the migration table alone.

```sql
-- 1. Which migrations does prod think are applied?
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;

-- 2. Social hardening state: if 0081 (old 0057) was applied, these carry search_path
SELECT proname, proconfig
FROM pg_proc
WHERE proname IN ('is_blocked_bidirectional', 'get_friends_ranking', 'soft_delete_trip');
-- applied => proconfig contains 'search_path=public' (soft_delete_trip:
-- 'search_path=public, pg_catalog' once reconciled 0081 or main 0034 is applied)

-- 3. Do the social tables exist at all?
SELECT to_regclass('public.push_token');       -- non-NULL => 0084 (old 0060) applied
SELECT to_regclass('public.user_follow');      -- non-NULL => 0059 (old 0033) applied
SELECT to_regclass('public.social_feed_inbox');-- non-NULL => 0079 (old 0055) applied

-- 4. Triggers that only exist if late social migrations ran
SELECT tgname FROM pg_trigger
WHERE tgname IN ('enforce_no_follow_when_blocked', 'trg_entry_restore_event');
-- enforce_no_follow_when_blocked => 0085 (old 0061); trg_entry_restore_event => 0082 (old 0058)

-- 5. soft_delete_trip behavior: confirm the is_system guard survived
SELECT prosrc FROM pg_proc WHERE proname = 'soft_delete_trip';
-- must contain 'is_system = false'
```

### Reconciling prod state

- **If prod has NONE of the social migrations** (fresh from main at 0057): apply
  0058-0086 normally (`supabase db push`). Nothing else needed.
- **If prod has some/all social migrations under OLD numbers** (e.g.
  `schema_migrations` rows for 0032_add_username etc. alongside main's 0032):
  1. For each old-numbered social row, mark the renumbered file as applied without
     re-running it: `supabase migration repair --status applied 0058` (etc., per the
     map above), and remove/repair the stale old-number rows
     (`supabase migration repair --status reverted <old>`) so the migration table
     matches the files on disk.
  2. The SQL in the renumbered files is unchanged EXCEPT the four re-authored files
     above. For those, run their statements manually (they are idempotent:
     CREATE OR REPLACE / DROP POLICY IF EXISTS + CREATE POLICY) so prod picks up the
     merged definitions - in particular the reconciled trip SELECT policy and the
     `is_system` guard in `soft_delete_trip`.
  3. Re-run the drift queries above to confirm: search_path present on all three
     functions, `is_system = false` in `soft_delete_trip`, and the trip SELECT policy
     is "Trip visibility with followers and blocks" with `(select auth.uid())`.
- Statements in these migrations are largely idempotent (IF NOT EXISTS /
  CREATE OR REPLACE / DROP ... IF EXISTS), so re-application is safe in most cases;
  the exceptions are plain `CREATE TABLE` / `CREATE POLICY` statements, which will
  error if the object exists - that error itself is a signal the migration was already
  applied under its old number (use `migration repair` instead of re-running).
