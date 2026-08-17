-- Migration: Add trigger to prevent follows when blocks exist
--
-- Security fix: TOCTOU race condition between block checks and follow insert.
-- This trigger enforces the constraint at the database level, preventing any
-- follow insertion when a block exists in either direction.

--------------------------------------------------------------------------------
-- TRIGGER FUNCTION: Prevent follows when blocks exist
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_follow_when_blocked()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if either user has blocked the other
    IF EXISTS (
        SELECT 1 FROM user_block
        WHERE (blocker_id = NEW.follower_id AND blocked_id = NEW.following_id)
           OR (blocker_id = NEW.following_id AND blocked_id = NEW.follower_id)
    ) THEN
        RAISE EXCEPTION 'Cannot follow a blocked user or a user who has blocked you'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public, pg_temp;

-- Drop existing trigger if it exists (for idempotency)
DROP TRIGGER IF EXISTS enforce_no_follow_when_blocked ON user_follow;

-- Create the trigger
CREATE TRIGGER enforce_no_follow_when_blocked
    BEFORE INSERT ON user_follow
    FOR EACH ROW
    EXECUTE FUNCTION prevent_follow_when_blocked();

--------------------------------------------------------------------------------
-- CLEANUP: Remove any existing follows that violate the constraint
--------------------------------------------------------------------------------

-- Delete follows where a block exists (data integrity cleanup)
DELETE FROM user_follow uf
WHERE EXISTS (
    SELECT 1 FROM user_block ub
    WHERE (ub.blocker_id = uf.follower_id AND ub.blocked_id = uf.following_id)
       OR (ub.blocker_id = uf.following_id AND ub.blocked_id = uf.follower_id)
);

--------------------------------------------------------------------------------
-- COMMENTS
--------------------------------------------------------------------------------

COMMENT ON FUNCTION prevent_follow_when_blocked() IS
    'Prevents creating follow relationships when a block exists between users. Enforces bidirectional check.';
