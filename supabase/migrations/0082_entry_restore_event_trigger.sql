-- Migration: Recreate social activity event when soft-deleted entry is restored
-- When an entry's deleted_at changes from non-NULL to NULL (restored),
-- we need to recreate the 'entry_added' event and fan out to followers.

--------------------------------------------------------------------------------
-- TRIGGER FUNCTION
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_entry_event_on_restore()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id UUID;
  v_activity_id UUID;
BEGIN
  -- Only fire when entry is being restored (deleted_at was set, now cleared)
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    -- Get the trip owner
    SELECT user_id INTO v_owner_id FROM trip WHERE id = NEW.trip_id;
    IF v_owner_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- Create the activity event
    INSERT INTO social_activity_event(actor_id, activity_type, entry_id, created_at)
    VALUES (v_owner_id, 'entry_added', NEW.id, NEW.created_at)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_activity_id;

    -- Fan out to followers (only if insert succeeded)
    IF v_activity_id IS NOT NULL THEN
      PERFORM fanout_activity_to_followers(v_activity_id, v_owner_id, NEW.created_at);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

--------------------------------------------------------------------------------
-- TRIGGER
--------------------------------------------------------------------------------

CREATE TRIGGER trg_entry_restore_event
AFTER UPDATE ON entry
FOR EACH ROW
WHEN (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
EXECUTE FUNCTION create_entry_event_on_restore();
