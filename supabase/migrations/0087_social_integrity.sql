-- Migration: Social integrity hardening (plan U2)
--
-- Fixes the signup-breaking and feed-integrity defects at the database layer:
-- 1. process_pending_invites_for_user: insert lowercase 'pending' into
--    trip_tags.status (the uppercase 'PENDING' literal failed the
--    trip_tag_status enum cast and aborted signup), stop marking invites
--    accepted when the referenced trip is deleted/nulled, add per-invite
--    exception handling, and skip invites older than the invite-code expiry
--    window (30 days, mirroring settings.invite_expiration_days used by
--    backend/app/core/invite_signer.py).
-- 2. handle_new_user: wrap invite processing in an exception handler so
--    signup is structurally un-abortable by social data.
-- 3. AFTER DELETE ON user_follow trigger purging the unfollower's inbox rows
--    for the unfollowed author.
-- 4. block_user_full SECURITY DEFINER RPC: severs follows and inbox both
--    directions, clears pending trip tags between the pair, cancels pending
--    email invites between the pair, inserts user_block idempotently.
--    Unblock intentionally restores nothing (plan Q2).
-- 5. AFTER UPDATE trigger on user_countries creating country_visited events
--    on wishlist -> visited transitions (covers PATCH and batch-upsert paths).
-- 6. fanout_existing_events_on_follow: apply visibility filters BEFORE the
--    50-row budget so events belonging to soft-deleted trips/entries or
--    non-visited countries cannot eat the backfill budget.
-- 7. One-time repairs: purge orphaned social_feed_inbox rows, re-run invite
--    processing for existing users with still-pending invites, and re-run
--    backfill_social_feed() to close historical country_visited gaps.
--
-- SECURITY DEFINER search_path audit (plan U2 item 8): every SECURITY DEFINER
-- function defined in migrations 0058-0086 carries SET search_path in its
-- final definition (verified across the full apply order); the remaining
-- CREATE-time omissions are main-side legacy functions whose search_path was
-- set via ALTER FUNCTION in 0053_set_function_search_paths.sql. No stragglers
-- to fix here.

--------------------------------------------------------------------------------
-- 1. FIX process_pending_invites_for_user
--------------------------------------------------------------------------------
-- Changes vs 0070:
--   * trip_tags.status gets 'pending' (lowercase) - 'PENDING' is not a valid
--     trip_tag_status enum label and raised 22P02, aborting the signup
--     transaction.
--   * A trip_tag invite whose trip is deleted or whose trip_id was nulled
--     (ON DELETE SET NULL) is a no-op and stays 'pending' - it is NOT marked
--     accepted (R9: no-op invites are not marked accepted).
--   * Each invite is processed in its own BEGIN/EXCEPTION sub-block so one
--     poisoned invite row (e.g. a blocked pair hitting
--     enforce_no_follow_when_blocked) cannot drop the rest.
--   * Invites older than 30 days are skipped entirely. This mirrors the
--     invite-code expiry window (settings.invite_expiration_days = 30,
--     enforced for signed codes in backend/app/core/invite_signer.py), so
--     email-match attribution cannot outlive code attribution (R9: expired
--     invites do not attribute).

CREATE OR REPLACE FUNCTION process_pending_invites_for_user(
  p_user_id UUID,
  p_email TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite RECORD;
  v_count INTEGER := 0;
  v_did_work BOOLEAN;
BEGIN
  -- Normalize email to lowercase for matching
  p_email := LOWER(TRIM(p_email));

  -- Find all pending, non-expired invites for this email
  FOR v_invite IN
    SELECT id, inviter_id, invite_type, trip_id
    FROM pending_invite
    WHERE LOWER(email) = p_email
      AND status = 'pending'
      -- Age cutoff mirrors the invite-code expiry window
      -- (settings.invite_expiration_days = 30)
      AND created_at > now() - interval '30 days'
  LOOP
    -- Per-invite exception handling: one bad invite must not drop the rest,
    -- and must never abort the caller (signup).
    BEGIN
      v_did_work := FALSE;

      IF v_invite.invite_type = 'follow' THEN
        -- Inviter follows the new user (the new user can follow back later)
        INSERT INTO user_follow (follower_id, following_id)
        VALUES (v_invite.inviter_id, p_user_id)
        ON CONFLICT (follower_id, following_id) DO NOTHING;
        v_did_work := TRUE;

      ELSIF v_invite.invite_type = 'trip_tag' THEN
        IF v_invite.trip_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM trip t
          WHERE t.id = v_invite.trip_id AND t.deleted_at IS NULL
        ) THEN
          -- Create trip tag with 'pending' status (requires user approval).
          -- NOTE: lowercase 'pending' - trip_tag_status enum labels are
          -- ('pending', 'approved', 'declined').
          INSERT INTO trip_tags (trip_id, tagged_user_id, initiated_by, status)
          SELECT
            v_invite.trip_id,
            p_user_id,
            t.user_id,  -- Trip owner initiated the tag
            'pending'
          FROM trip t
          WHERE t.id = v_invite.trip_id
            AND t.deleted_at IS NULL
          ON CONFLICT (trip_id, tagged_user_id) DO NOTHING;

          -- Also create follow relationship (inviter follows new user)
          INSERT INTO user_follow (follower_id, following_id)
          VALUES (v_invite.inviter_id, p_user_id)
          ON CONFLICT (follower_id, following_id) DO NOTHING;

          v_did_work := TRUE;
        END IF;
        -- Trip deleted or trip_id nulled: leave the invite 'pending';
        -- a no-op invite must not be marked accepted.
      END IF;

      IF v_did_work THEN
        UPDATE pending_invite
        SET status = 'accepted',
            accepted_at = NOW()
        WHERE id = v_invite.id;

        v_count := v_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'Skipping pending invite % for user % (%): %',
        v_invite.id, p_user_id, p_email, SQLERRM;
    END;
  END LOOP;

  RETURN v_count;
END;
$$;

--------------------------------------------------------------------------------
-- 2. FIX handle_new_user: signup is structurally un-abortable
--------------------------------------------------------------------------------
-- Same body as 0070 (the surviving definition: correct user_id column,
-- username handling, is_test detection, search_path), with the invite
-- processing wrapped in an exception handler that logs and continues.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_display_name TEXT;
  v_username TEXT;
  v_provided_username TEXT;
  v_invites_processed INTEGER;
BEGIN
  -- Get display name from metadata or email
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    CASE
      WHEN NEW.phone IS NOT NULL THEN 'User ' || RIGHT(NEW.phone, 4)
      WHEN NEW.email IS NOT NULL THEN split_part(NEW.email, '@', 1)
      ELSE 'User'
    END
  );

  -- Check if username was provided during signup
  v_provided_username := NEW.raw_user_meta_data->>'username';

  -- If username provided and valid, use it; otherwise generate one
  IF v_provided_username IS NOT NULL
     AND LENGTH(v_provided_username) >= 3
     AND LENGTH(v_provided_username) <= 30
     AND v_provided_username ~ '^[a-zA-Z0-9_]+$'
     AND NOT EXISTS (SELECT 1 FROM user_profile WHERE LOWER(username) = LOWER(v_provided_username))
  THEN
    v_username := v_provided_username;
  ELSE
    v_username := generate_username_from_name(v_display_name);
  END IF;

  INSERT INTO public.user_profile (
    user_id,
    display_name,
    username,
    is_test,
    tracking_preference
  )
  VALUES (
    NEW.id,
    v_display_name,
    v_username,
    COALESCE(NEW.email LIKE '%+test@%', false),
    'full_atlas'
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- Process any pending invites for this email.
  -- Wrapped in an exception handler so social data can NEVER abort signup:
  -- process_pending_invites_for_user already guards per-invite, but this
  -- outer handler also covers failures raised before/around the loop
  -- (e.g. the function being dropped, a schema drift on pending_invite).
  IF NEW.email IS NOT NULL THEN
    BEGIN
      v_invites_processed := process_pending_invites_for_user(NEW.id, NEW.email);
      IF v_invites_processed > 0 THEN
        RAISE LOG 'Processed % pending invite(s) for user % (%)',
          v_invites_processed, NEW.id, NEW.email;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'Invite processing failed for user % (%): %',
        NEW.id, NEW.email, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

--------------------------------------------------------------------------------
-- 3. UNFOLLOW CLEANUP: purge the unfollower's inbox rows for that author
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION remove_inbox_on_unfollow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM social_feed_inbox
  WHERE recipient_id = OLD.follower_id
    AND actor_id = OLD.following_id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_follow_remove_inbox ON user_follow;

CREATE TRIGGER trg_user_follow_remove_inbox
AFTER DELETE ON user_follow
FOR EACH ROW
EXECUTE FUNCTION remove_inbox_on_unfollow();

--------------------------------------------------------------------------------
-- 4. block_user_full RPC: block semantics live in SQL (plan KTD4)
--------------------------------------------------------------------------------
-- The caller is the blocker (auth.uid() from the JWT PostgREST forwards);
-- a JWT-scoped caller cannot block on someone else's behalf, and the
-- blocked side cannot bypass anything because every statement runs as the
-- function owner (SECURITY DEFINER), not under the caller's RLS.
-- Returns TRUE when a new block row was created, FALSE when the pair was
-- already blocked (cleanup still runs either way - idempotent).
-- Unblock intentionally restores nothing (plan Q2): purged follows, inbox
-- rows, tags, and invites stay gone.

CREATE OR REPLACE FUNCTION block_user_full(p_blocked_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocker_id UUID := auth.uid();
  v_blocker_email TEXT;
  v_blocked_email TEXT;
  v_inserted BOOLEAN := FALSE;
BEGIN
  IF v_blocker_id IS NULL THEN
    RAISE EXCEPTION 'block_user_full requires an authenticated caller';
  END IF;

  IF v_blocker_id = p_blocked_id THEN
    RAISE EXCEPTION 'Cannot block yourself';
  END IF;

  -- Idempotent insert - no check-then-insert race; the unique constraint
  -- (blocker_id, blocked_id) is the arbiter. FOUND is true only when the
  -- row was actually inserted.
  INSERT INTO user_block (blocker_id, blocked_id)
  VALUES (v_blocker_id, p_blocked_id)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;
  v_inserted := FOUND;

  -- Remove follows in both directions (fires trg_user_follow_remove_inbox,
  -- which purges the corresponding inbox rows as well).
  DELETE FROM user_follow
  WHERE (follower_id = v_blocker_id AND following_id = p_blocked_id)
     OR (follower_id = p_blocked_id AND following_id = v_blocker_id);

  -- Purge inbox rows in both directions explicitly: covers rows that
  -- outlived their follow (historical orphans) or arrived via a since-
  -- removed follow.
  DELETE FROM social_feed_inbox
  WHERE (recipient_id = v_blocker_id AND actor_id = p_blocked_id)
     OR (recipient_id = p_blocked_id AND actor_id = v_blocker_id);

  -- Clear pending trip tags between the pair (either may be the trip owner).
  -- Approved tags are consent already given and are left alone (Q3 handles
  -- withdrawal separately).
  DELETE FROM trip_tags tt
  USING trip t
  WHERE t.id = tt.trip_id
    AND tt.status = 'pending'
    AND (
      (tt.tagged_user_id = v_blocker_id AND t.user_id = p_blocked_id)
      OR (tt.tagged_user_id = p_blocked_id AND t.user_id = v_blocker_id)
    );

  -- Cancel pending email invites between the pair. Invites are email-keyed
  -- and survive account deletion, so an invite row does NOT imply a live
  -- auth.users row - resolve emails defensively and skip when absent.
  SELECT LOWER(u.email) INTO v_blocked_email
  FROM auth.users u WHERE u.id = p_blocked_id;
  SELECT LOWER(u.email) INTO v_blocker_email
  FROM auth.users u WHERE u.id = v_blocker_id;

  IF v_blocked_email IS NOT NULL THEN
    UPDATE pending_invite
    SET status = 'cancelled'
    WHERE inviter_id = v_blocker_id
      AND LOWER(email) = v_blocked_email
      AND status = 'pending';
  END IF;

  IF v_blocker_email IS NOT NULL THEN
    UPDATE pending_invite
    SET status = 'cancelled'
    WHERE inviter_id = p_blocked_id
      AND LOWER(email) = v_blocker_email
      AND status = 'pending';
  END IF;

  RETURN v_inserted;
END;
$$;

-- Only authenticated users (and the service role) may call it.
REVOKE ALL ON FUNCTION block_user_full(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION block_user_full(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION block_user_full(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION block_user_full(UUID) TO service_role;

--------------------------------------------------------------------------------
-- 5. country_visited EVENTS ON wishlist -> visited TRANSITIONS
--------------------------------------------------------------------------------
-- 0079 only creates country_visited events on INSERT; a row upserted as
-- 'wishlist' and later flipped to 'visited' (PATCH or batch upsert with
-- ON CONFLICT DO UPDATE) produced no event. Mirrors the entry-restore
-- pattern of 0082: ON CONFLICT DO NOTHING resolves against the partial
-- unique index idx_social_activity_event_country_unique(user_country_id),
-- so a revisit (visited -> wishlist -> visited) cannot duplicate - the
-- earlier event is removed by trg_user_countries_remove_event on the way
-- down and recreated exactly once on the way back up.
--
-- CAVEAT (matches backfill_social_feed): the event is stamped with the
-- user_countries row's created_at, so a long-wishlisted country lands deep
-- in followers' feeds rather than at the top. Accepted trade-off for
-- consistency with the INSERT trigger and the backfill.

CREATE OR REPLACE FUNCTION create_country_visit_event_on_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_activity_id UUID;
BEGIN
  IF NEW.status = 'visited' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO social_activity_event(actor_id, activity_type, user_country_id, created_at)
    VALUES (NEW.user_id, 'country_visited', NEW.id, NEW.created_at)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_activity_id;

    -- Fan out only if the insert actually happened
    IF v_activity_id IS NOT NULL THEN
      PERFORM fanout_activity_to_followers(v_activity_id, NEW.user_id, NEW.created_at);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_countries_visit_event ON user_countries;

CREATE TRIGGER trg_user_countries_visit_event
AFTER UPDATE ON user_countries
FOR EACH ROW
WHEN (NEW.status = 'visited' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION create_country_visit_event_on_update();

--------------------------------------------------------------------------------
-- 6. FIX fanout_existing_events_on_follow: budget counts only VISIBLE events
--------------------------------------------------------------------------------
-- soft_delete_trip stamps only the trip row (entries keep deleted_at NULL),
-- so entry events belonging to soft-deleted trips stay in
-- social_activity_event and are filtered at read time by the feed RPCs.
-- The original on-follow backfill applied LIMIT 50 BEFORE any visibility
-- check, so invisible events could consume the whole budget and a new
-- follower would see fewer (possibly zero) items. Filter first, then budget.

CREATE OR REPLACE FUNCTION fanout_existing_events_on_follow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- NOTE: backfill is limited to the 50 most recent VISIBLE events to avoid
  -- slow inserts when following users with extensive history.
  INSERT INTO social_feed_inbox(recipient_id, activity_id, actor_id, created_at)
  SELECT NEW.follower_id, sae.id, sae.actor_id, sae.created_at
  FROM social_activity_event sae
  LEFT JOIN entry e ON e.id = sae.entry_id
  LEFT JOIN trip t ON t.id = e.trip_id
  LEFT JOIN user_countries uc ON uc.id = sae.user_country_id
  WHERE sae.actor_id = NEW.following_id
    AND (sae.entry_id IS NULL OR (e.deleted_at IS NULL AND t.deleted_at IS NULL))
    AND (sae.user_country_id IS NULL OR uc.status = 'visited')
  ORDER BY sae.created_at DESC
  LIMIT 50
  ON CONFLICT (recipient_id, activity_id) DO NOTHING;

  RETURN NEW;
END;
$$;

--------------------------------------------------------------------------------
-- 7. ONE-TIME REPAIRS
--------------------------------------------------------------------------------

-- 7a. Purge orphaned inbox rows: a recipient/actor pair with no live follow
--     (past unfollows never cleaned up before the trigger in section 3) or
--     with a block in either direction.
DELETE FROM social_feed_inbox sfi
WHERE NOT EXISTS (
    SELECT 1 FROM user_follow uf
    WHERE uf.follower_id = sfi.recipient_id
      AND uf.following_id = sfi.actor_id
  )
  OR EXISTS (
    SELECT 1 FROM user_block ub
    WHERE (ub.blocker_id = sfi.recipient_id AND ub.blocked_id = sfi.actor_id)
       OR (ub.blocker_id = sfi.actor_id AND ub.blocked_id = sfi.recipient_id)
  );

-- 7b. Re-run invite processing for existing users whose email still matches
--     pending invites (signed up before their invite, or invite processing
--     aborted on the enum bug). Never touches invites already 'accepted';
--     the function's 30-day cutoff also applies here, so stale invites do
--     not attribute. Per-user exception guard mirrors signup semantics.
DO $$
DECLARE
  v_user RECORD;
BEGIN
  FOR v_user IN
    SELECT DISTINCT u.id, u.email
    FROM auth.users u
    JOIN pending_invite pi
      ON LOWER(pi.email) = LOWER(u.email)
    WHERE pi.status = 'pending'
      AND u.email IS NOT NULL
  LOOP
    BEGIN
      PERFORM process_pending_invites_for_user(v_user.id, v_user.email);
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'One-time invite reprocessing failed for user % (%): %',
        v_user.id, v_user.email, SQLERRM;
    END;
  END LOOP;
END
$$;

-- 7c. Close historical country_visited gaps (rows flipped wishlist->visited
--     before the section-5 trigger existed). backfill_social_feed() is
--     idempotent: event inserts resolve against the partial unique indexes
--     and inbox inserts against (recipient_id, activity_id). It already
--     filters non-visited user_countries rows and soft-deleted
--     trips/entries when creating events. Runs AFTER the orphan purge so
--     rows for live follows are repopulated. CAVEAT: backfilled events are
--     stamped with uc.created_at, so long-wishlisted countries land deep in
--     the feed rather than at the top - accepted, see section 5.
SELECT backfill_social_feed();
