-- Migration: Re-key push_token for multi-device support (plan U10; KTD11, R8)
--
-- Old model (0084, columns pruned in 0086): one row per user via a UNIQUE
-- constraint on user_id. Registering a second device silently replaced the
-- first, and a shared device could keep delivering one user's pushes after
-- another user signed in.
--
-- New model:
--   * One user holds MANY device tokens (one row per device).
--   * A device token belongs to AT MOST ONE user.
--
-- Constraint set (kept minimal on purpose):
--   * UNIQUE (token) is both the ownership rule and the upsert arbiter.
--     The backend registers with ON CONFLICT (token) DO UPDATE SET
--     user_id = excluded.user_id, ... -- a one-transaction ownership
--     transfer when a device is re-registered by a different account.
--     (Registration runs under the service role: the RLS UPDATE policy
--     only allows user_id = auth.uid(), so a JWT-scoped upsert could not
--     claim a token currently owned by another user. The backend still
--     binds user_id to the verified JWT identity.)
--   * A UNIQUE (user_id, token) constraint is NOT added: it is implied by
--     UNIQUE (token) (any duplicate of the pair duplicates the token) and
--     would only add write overhead.
--   * idx_push_token_user (non-unique, from 0084) stays: send paths now
--     fetch ALL tokens per user.
--
-- DEPLOY SEQUENCING (constraint-safe order -- do not reorder):
--   1. Dedupe existing rows, keeping the newest claim per token.
--   2. ADD the new UNIQUE (token) constraint.
--   3. Only THEN drop the old user_id unique constraint. The pre-U10
--      backend upserts with on_conflict=user_id; dropping that constraint
--      while it is still serving traffic breaks registration with 42P10
--      ("there is no unique or exclusion constraint matching the ON
--      CONFLICT specification"). Apply this migration in the same deploy
--      window as the backend that upserts on_conflict=token. The drop is
--      last inside this file so the whole dance commits atomically.

--------------------------------------------------------------------------------
-- 1) DEDUPE: keep the newest row per token
--------------------------------------------------------------------------------

-- The old UNIQUE (user_id) allowed the same token to appear under several
-- users (shared device passed between accounts). Only the most recent
-- claim survives; updated_at/created_at order with id as a deterministic
-- tie-break.
DELETE FROM push_token
WHERE id IN (
    SELECT id
    FROM (
        SELECT id,
               row_number() OVER (
                   PARTITION BY token
                   ORDER BY updated_at DESC, created_at DESC, id DESC
               ) AS rn
        FROM push_token
    ) ranked
    WHERE rn > 1
);

--------------------------------------------------------------------------------
-- 2) NEW CONSTRAINT: token ownership + upsert arbiter
--------------------------------------------------------------------------------

ALTER TABLE push_token
    ADD CONSTRAINT push_token_token_key UNIQUE (token);

-- The partial index from 0084 is redundant next to the unique constraint's
-- index (and its WHERE token IS NOT NULL predicate never filtered anything:
-- token is NOT NULL).
DROP INDEX IF EXISTS idx_push_token_token;

--------------------------------------------------------------------------------
-- 3) LAST: drop the one-row-per-user constraint (see sequencing note above)
--------------------------------------------------------------------------------

ALTER TABLE push_token
    DROP CONSTRAINT IF EXISTS push_token_user_id_key;

COMMENT ON TABLE push_token IS
    'Expo push tokens, one row per registered device. UNIQUE (token): a '
    'device token belongs to at most one user; registration upserts '
    'ON CONFLICT (token) to transfer ownership. A user may hold many rows '
    '(multi-device).';
