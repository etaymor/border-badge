-- Migration: Add trigger to prevent trip tags when blocks exist
--
-- Security fix: the endpoints pre-check blocks before inserting into
-- trip_tags, but nothing at the database level prevented an insert from
-- racing a block commit -- leaving a tag that survives even after an
-- unblock. Mirrors 0085's enforce_no_follow_when_blocked trigger.

--------------------------------------------------------------------------------
-- TRIGGER FUNCTION: Prevent trip tags when blocks exist
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_trip_tag_when_blocked()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if either user has blocked the other (bidirectional).
    IF EXISTS (
        SELECT 1 FROM user_block
        WHERE (blocker_id = NEW.initiated_by AND blocked_id = NEW.tagged_user_id)
           OR (blocker_id = NEW.tagged_user_id AND blocked_id = NEW.initiated_by)
    ) THEN
        -- Default RAISE EXCEPTION errcode (P0001); the message includes
        -- 'blocked' so is_block_violation_error() classifies it.
        RAISE EXCEPTION 'Cannot tag a blocked user or a user who has blocked you';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public, pg_temp;

-- Drop existing trigger if it exists (for idempotency)
DROP TRIGGER IF EXISTS enforce_no_trip_tag_when_blocked ON trip_tags;

-- Create the trigger
CREATE TRIGGER enforce_no_trip_tag_when_blocked
    BEFORE INSERT ON trip_tags
    FOR EACH ROW
    EXECUTE FUNCTION prevent_trip_tag_when_blocked();

--------------------------------------------------------------------------------
-- CLEANUP: Remove any existing tags that violate the constraint
--------------------------------------------------------------------------------

DELETE FROM trip_tags tt
WHERE EXISTS (
    SELECT 1 FROM user_block ub
    WHERE (ub.blocker_id = tt.initiated_by AND ub.blocked_id = tt.tagged_user_id)
       OR (ub.blocker_id = tt.tagged_user_id AND ub.blocked_id = tt.initiated_by)
);

--------------------------------------------------------------------------------
-- COMMENTS
--------------------------------------------------------------------------------

COMMENT ON FUNCTION prevent_trip_tag_when_blocked() IS
    'Prevents creating trip tags when a block exists between the initiator and the tagged user. Enforces bidirectional check.';
