-- Migration: Process pending invites when new user signs up
-- Implements auto-follow for the invite flow: send invite → signup → auto-follow
--
-- This migration:
-- 1. Creates a function to process pending invites for a new user's email
-- 2. Updates handle_new_user trigger to call this function after profile creation
-- 3. Creates follow relationships from inviters to new user (inviter follows new user)
-- 4. Marks invites as 'accepted'

--------------------------------------------------------------------------------
-- FUNCTION: Process pending invites for a newly signed up user
--------------------------------------------------------------------------------

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
BEGIN
  -- Normalize email to lowercase for matching
  p_email := LOWER(TRIM(p_email));

  -- Find all pending invites for this email
  FOR v_invite IN
    SELECT id, inviter_id, invite_type, trip_id
    FROM pending_invite
    WHERE LOWER(email) = p_email
      AND status = 'pending'
  LOOP
    -- Process based on invite type
    IF v_invite.invite_type = 'follow' THEN
      -- Create mutual follow: inviter follows the new user
      -- (The new user can choose to follow back later)
      INSERT INTO user_follow (follower_id, following_id)
      VALUES (v_invite.inviter_id, p_user_id)
      ON CONFLICT (follower_id, following_id) DO NOTHING;

    ELSIF v_invite.invite_type = 'trip_tag' AND v_invite.trip_id IS NOT NULL THEN
      -- Create trip tag with 'pending' status (requires user approval)
      -- Get trip owner to set initiated_by
      INSERT INTO trip_tags (trip_id, tagged_user_id, initiated_by, status)
      SELECT
        v_invite.trip_id,
        p_user_id,
        t.user_id,  -- Trip owner initiated the tag
        'PENDING'
      FROM trip t
      WHERE t.id = v_invite.trip_id
        AND t.deleted_at IS NULL
      ON CONFLICT (trip_id, tagged_user_id) DO NOTHING;

      -- Also create follow relationship (inviter follows new user)
      INSERT INTO user_follow (follower_id, following_id)
      VALUES (v_invite.inviter_id, p_user_id)
      ON CONFLICT (follower_id, following_id) DO NOTHING;
    END IF;

    -- Mark invite as accepted
    UPDATE pending_invite
    SET status = 'accepted',
        accepted_at = NOW()
    WHERE id = v_invite.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

--------------------------------------------------------------------------------
-- UPDATE: handle_new_user trigger to process pending invites
--------------------------------------------------------------------------------

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

  -- Process any pending invites for this email
  -- This creates follow relationships and trip tags automatically
  IF NEW.email IS NOT NULL THEN
    v_invites_processed := process_pending_invites_for_user(NEW.id, NEW.email);
    -- Log for debugging (will appear in Supabase logs)
    IF v_invites_processed > 0 THEN
      RAISE LOG 'Processed % pending invite(s) for user % (%)',
        v_invites_processed, NEW.id, NEW.email;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

--------------------------------------------------------------------------------
-- GRANT: Allow the function to be called
--------------------------------------------------------------------------------

-- Grant execute on the function for authenticated users (for potential future use)
GRANT EXECUTE ON FUNCTION process_pending_invites_for_user(UUID, TEXT) TO authenticated;
