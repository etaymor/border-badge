-- U16: make the photo-import entitlement real and tamper-proof.
--
-- =========================================================================
-- DEPLOY ORDER -- REQUIRED
-- =========================================================================
-- APPLY THIS MIGRATION BEFORE DEPLOYING THE BACKEND THAT DEPENDS ON IT.
--
-- The backend selects `usage_photo_import_trip_id` /
-- `usage_photo_import_cluster_allowance` and calls the three-argument
-- `increment_photo_import_usage`. It is written to DEGRADE if they are absent
-- (it falls back to the pre-U16 column set, leaves the free-tier gate
-- unenforced, and skips the server-side charge), but that degradation is a
-- safety net for a bad deploy, not the intended state: while it is active,
-- free-tier photo imports are NOT metered. Apply this first, confirm
-- PostgREST has reloaded its schema cache, then deploy.
--
-- Run it in a LOW-TRAFFIC WINDOW: section 6 drops and recreates
-- `increment_photo_import_usage`, and between the DROP and PostgREST picking
-- up the new signature that RPC 404s. The `NOTIFY pgrst, 'reload schema'` at
-- the end shortens that window but does not remove it.
--
-- EMERGENCY DISABLE (does not require a code deploy):
--   -- rollback: ALTER TABLE user_profile DISABLE TRIGGER trg_reject_client_subscription_writes;
-- That reopens the client-writable counter hole, so treat it as a stopgap.
--
-- DO NOT DROP THE NEW COLUMNS while the backend is deployed: it selects them
-- by name. Roll the backend back first; the columns are additive and harmless
-- if simply left in place.
-- =========================================================================
--
-- Four things happen here:
--
-- 1. `user_profile.usage_photo_import_trip_id` records WHICH trip consumed a
--    user's free photo import. The counter alone cannot tell "this user spent
--    their import" from "this user is still finishing the import they spent",
--    so the exemption that keeps that one trip completable (R17) has to live
--    beside the charge, server-side, where it survives a reinstall or a device
--    change.
--
-- 2. `user_profile.usage_photo_import_cluster_allowance` BOUNDS that
--    exemption. Recording the trip alone made it an unbounded replay key: the
--    caller supplies the trip id on every request, so a free user who spent
--    their import on trip A could pass trip A forever. The charge now buys a
--    finite amount of matching work, measured in clusters, which every later
--    request for that trip draws down.
--
-- 3. `increment_photo_import_usage` learns about the trip, verifies the caller
--    OWNS it, stops double-charging for it (re-entering the recorded trip
--    returns the current count instead of spending a second import), and
--    maintains the allowance.
--
-- 4. The subscription and usage columns stop being client-writable. They were
--    updatable by any client holding its own token, which would let a user
--    reset the very counter the endpoint now enforces. A BEFORE UPDATE trigger
--    rejects changes to them unless the write comes from the service role or
--    from one of the trusted SECURITY DEFINER functions, which announce
--    themselves with a transaction-local flag. Those functions remain the only
--    write path.
--
-- NOT APPLIED by this change -- file only.

-- Never wedge behind a lock on the hot `trip` / `user_profile` tables: fail
-- fast and let the operator retry instead of queueing every writer behind us.
SET lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- 1. Record the trip that consumed the import, and what it bought
-- ---------------------------------------------------------------------------
-- Columns are added WITHOUT the foreign key: an inline REFERENCES makes this
-- statement an ADD CONSTRAINT that takes SHARE ROW EXCLUSIVE on `trip` and
-- validates the whole table under it. Section 1b splits that apart.

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS usage_photo_import_trip_id UUID;

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS usage_photo_import_cluster_allowance INTEGER;

COMMENT ON COLUMN user_profile.usage_photo_import_trip_id IS
  'Trip that consumed the free photo import. Server-side twin of the device '
  'marker: lets the user finish that one trip after the counter is spent (R17).';

COMMENT ON COLUMN user_profile.usage_photo_import_cluster_allowance IS
  'Remaining clusters the consumed photo import still pays for. Bounds the R17 '
  'exemption so a spent import cannot be replayed indefinitely.';

-- ---------------------------------------------------------------------------
-- 1b. The foreign key, added without a long lock
-- ---------------------------------------------------------------------------
-- NOT VALID takes the lock only long enough to record the constraint (new rows
-- are checked from that moment on); VALIDATE CONSTRAINT then scans with a
-- weaker SHARE UPDATE EXCLUSIVE lock that does not block writers.
--
-- ON DELETE SET NULL is kept deliberately: without it, hard-deleting a trip
-- that some profile recorded would fail outright. The guard trigger in section
-- 3 exempts exactly that referential null-out.

DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_profile_usage_photo_import_trip_id_fkey'
      AND conrelid = 'user_profile'::regclass
  ) THEN
    ALTER TABLE user_profile
      ADD CONSTRAINT user_profile_usage_photo_import_trip_id_fkey
      FOREIGN KEY (usage_photo_import_trip_id)
      REFERENCES trip(id) ON DELETE SET NULL
      NOT VALID;
  END IF;
END;
$fk$;

ALTER TABLE user_profile
  VALIDATE CONSTRAINT user_profile_usage_photo_import_trip_id_fkey;

-- Without this, every trip delete sequentially scans `user_profile` to find
-- referencing rows. Partial: only a handful of profiles ever hold a value.
CREATE INDEX IF NOT EXISTS idx_user_profile_usage_photo_import_trip_id
  ON user_profile (usage_photo_import_trip_id)
  WHERE usage_photo_import_trip_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. How trusted writers announce themselves
-- ---------------------------------------------------------------------------
-- The guard below cannot use `current_user`: inside a SECURITY DEFINER
-- function `current_user` is the function OWNER, so every trusted function
-- would look like a superuser and so would anything they call. And it cannot
-- use `session_user` either -- migration 0056 established that PostgREST's
-- connection role is 'authenticator', never 'service_role'.
--
-- So each trusted function announces itself INLINE, immediately before its own
-- UPDATE, with `PERFORM set_config('app.subscription_write', 'on', true)`. The
-- `true` scopes the setting to the current transaction, so the permission
-- cannot leak into a later statement on the same connection. There is
-- deliberately no shared helper function to call: a standalone
-- `begin_trusted_subscription_write()` would be a PostgREST-reachable
-- guard-bypass primitive whose only protection is that PostgREST happens to
-- give each request its own transaction. An earlier draft of this migration
-- created one and never called it; drop it if it was ever applied.

DROP FUNCTION IF EXISTS begin_trusted_subscription_write();

-- ---------------------------------------------------------------------------
-- 3. The guard trigger
-- ---------------------------------------------------------------------------
-- Deliberately SECURITY INVOKER (the default): a SECURITY DEFINER guard would
-- run as its owner and lose the ability to tell callers apart at all.

CREATE OR REPLACE FUNCTION reject_client_subscription_writes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_claims TEXT;
    v_role TEXT;
    v_other_guarded_changed BOOLEAN;
BEGIN
    -- A trusted SECURITY DEFINER function is mid-write.
    IF COALESCE(current_setting('app.subscription_write', true), '') = 'on' THEN
        RETURN NEW;
    END IF;

    v_claims := NULLIF(current_setting('request.jwt.claims', true), '');
    IF v_claims IS NOT NULL THEN
        BEGIN
            v_role := v_claims::jsonb ->> 'role';
        EXCEPTION WHEN OTHERS THEN
            v_role := NULL;
        END;
    END IF;

    -- Service-role API traffic (webhooks, backend admin operations).
    IF v_role = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Direct database access with no request context at all: migrations, the
    -- SQL editor, support scripts. Not reachable through PostgREST, which
    -- always sets request.jwt.claims for an authenticated request.
    IF v_claims IS NULL AND current_user IN ('postgres', 'supabase_admin') THEN
        RETURN NEW;
    END IF;

    v_other_guarded_changed := (
        (NEW.subscription_status IS DISTINCT FROM OLD.subscription_status)
        OR (NEW.subscription_plan IS DISTINCT FROM OLD.subscription_plan)
        OR (NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at)
        OR (NEW.subscription_last_verified_at
            IS DISTINCT FROM OLD.subscription_last_verified_at)
        OR (NEW.revenuecat_customer_id IS DISTINCT FROM OLD.revenuecat_customer_id)
        OR (NEW.last_webhook_timestamp_ms IS DISTINCT FROM OLD.last_webhook_timestamp_ms)
        OR (NEW.last_webhook_event_id IS DISTINCT FROM OLD.last_webhook_event_id)
        OR (NEW.usage_share_extension_count
            IS DISTINCT FROM OLD.usage_share_extension_count)
        OR (NEW.usage_share_extension_period_start
            IS DISTINCT FROM OLD.usage_share_extension_period_start)
        OR (NEW.usage_photo_import_count IS DISTINCT FROM OLD.usage_photo_import_count)
        OR (NEW.usage_photo_import_cluster_allowance
            IS DISTINCT FROM OLD.usage_photo_import_cluster_allowance)
    );

    -- Referential null-out. `ON DELETE SET NULL` makes the RI trigger issue an
    -- UPDATE on this table; that UPDATE sets no `app.subscription_write` flag,
    -- and under a PostgREST request `request.jwt.claims` IS present, so none of
    -- the exemptions above match and deleting a trip would abort with 42501.
    -- Allow exactly that transition -- the FK column moving to NULL with every
    -- other guarded column untouched. A client can reach the same shape by
    -- PATCHing the column to NULL, which only DESTROYS its own R17 exemption
    -- (the counter is unchanged, so nothing is regained).
    IF OLD.usage_photo_import_trip_id IS NOT NULL
        AND NEW.usage_photo_import_trip_id IS NULL
        AND NOT v_other_guarded_changed THEN
        RETURN NEW;
    END IF;

    IF v_other_guarded_changed
        OR (NEW.usage_photo_import_trip_id
            IS DISTINCT FROM OLD.usage_photo_import_trip_id)
    THEN
        RAISE EXCEPTION
            'Subscription and usage columns are server-managed and cannot be '
            'updated by a client'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_client_subscription_writes ON user_profile;
CREATE TRIGGER trg_reject_client_subscription_writes
    BEFORE UPDATE ON user_profile
    FOR EACH ROW
    EXECUTE FUNCTION reject_client_subscription_writes();

-- ---------------------------------------------------------------------------
-- 4. The only write path: the increment RPCs (now trusted writers)
-- ---------------------------------------------------------------------------

-- Photo import: records the consuming trip, verifies the caller owns it,
-- refuses to charge twice for it, and meters the exemption it grants.
-- Dropped rather than replaced so the new default-valued parameters do not
-- leave several overloads for PostgREST to choose between (see migration 0046).
DROP FUNCTION IF EXISTS increment_photo_import_usage(UUID);
DROP FUNCTION IF EXISTS increment_photo_import_usage(UUID, UUID);
DROP FUNCTION IF EXISTS increment_photo_import_usage(UUID, UUID, INTEGER);

CREATE FUNCTION increment_photo_import_usage(
    p_user_id UUID,
    p_trip_id UUID DEFAULT NULL,
    p_clusters INTEGER DEFAULT 0
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    new_count INTEGER;
    caller_id UUID;
    caller_claims TEXT;
    caller_role TEXT;
    current_count INTEGER;
    current_trip_id UUID;
    owned_trip_id UUID;
    -- Keep in sync with PHOTO_IMPORT_CLUSTER_ALLOWANCE in
    -- backend/app/api/subscriptions.py. A large import is 50-100 clusters
    -- (a very large multi-city one, 200-300), so this leaves room to retry
    -- failed clusters and to re-run the same trip after adding photos -- the
    -- entire point of R17 -- while keeping the exemption FINITE.
    allowance_grant CONSTANT INTEGER := 500;
    spend INTEGER := GREATEST(COALESCE(p_clusters, 0), 0);
BEGIN
    caller_id := auth.uid();
    caller_claims := NULLIF(current_setting('request.jwt.claims', true), '');
    IF caller_claims IS NOT NULL THEN
        BEGIN
            caller_role := caller_claims::jsonb ->> 'role';
        EXCEPTION WHEN OTHERS THEN
            caller_role := NULL;
        END;
    END IF;

    -- Authorization check: a user may only increment their own usage. The
    -- backend also charges this itself with the service role -- the counter
    -- must not depend on a client choosing to report its own usage -- so
    -- service-role callers are admitted for any p_user_id.
    IF caller_role IS DISTINCT FROM 'service_role'
        AND (caller_id IS NULL OR caller_id != p_user_id) THEN
        RAISE EXCEPTION 'Unauthorized: can only increment your own usage';
    END IF;

    -- Acquire advisory lock for this user to prevent concurrent increment races
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

    SELECT COALESCE(usage_photo_import_count, 0), usage_photo_import_trip_id
    INTO current_count, current_trip_id
    FROM user_profile WHERE user_id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User profile not found for user %', p_user_id;
    END IF;

    -- Ownership, checked HERE and not left to the foreign key. auth.uid() alone
    -- said nothing about p_trip_id, so the caller fully controlled the value
    -- that becomes their permanent exemption key -- including another user's
    -- trip id. A trip that is not the caller's live trip is recorded as NULL
    -- rather than raising: the FK would otherwise turn a stale or bogus id into
    -- a 23503 that rolls the whole increment back (and the client's grandfather
    -- pass marks itself run anyway), so degrading is strictly safer than
    -- aborting.
    IF p_trip_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM trip
        WHERE id = p_trip_id
          AND user_id = p_user_id
          AND deleted_at IS NULL
    ) THEN
        owned_trip_id := p_trip_id;
    ELSE
        owned_trip_id := NULL;
    END IF;

    PERFORM set_config('app.subscription_write', 'on', true);

    -- Already charged for THIS trip: re-entry after a reinstall or on a second
    -- device must not spend a second import (R17). The count is untouched; only
    -- the finite allowance that charge bought is drawn down, so the exemption
    -- cannot be replayed forever.
    IF owned_trip_id IS NOT NULL AND current_trip_id IS NOT NULL
        AND current_trip_id = owned_trip_id THEN
        UPDATE user_profile
        SET usage_photo_import_cluster_allowance = GREATEST(
                COALESCE(usage_photo_import_cluster_allowance, 0) - spend, 0)
        WHERE user_id = p_user_id;
        RETURN current_count;
    END IF;

    UPDATE user_profile
    SET usage_photo_import_count = current_count + 1,
        -- First trip wins: the exemption belongs to the import that was paid
        -- for, not to whichever trip was opened most recently.
        usage_photo_import_trip_id = COALESCE(usage_photo_import_trip_id, owned_trip_id),
        usage_photo_import_cluster_allowance = CASE
            WHEN usage_photo_import_trip_id IS NULL AND owned_trip_id IS NOT NULL
                THEN GREATEST(allowance_grant - spend, 0)
            ELSE GREATEST(
                COALESCE(usage_photo_import_cluster_allowance, 0) - spend, 0)
        END
    WHERE user_id = p_user_id
    RETURNING usage_photo_import_count INTO new_count;

    RETURN new_count;
END;
$$;

DO $perms$
BEGIN
  REVOKE ALL ON FUNCTION increment_photo_import_usage(UUID, UUID, INTEGER)
    FROM PUBLIC;
  REVOKE ALL ON FUNCTION increment_photo_import_usage(UUID, UUID, INTEGER)
    FROM anon;
  GRANT EXECUTE ON FUNCTION increment_photo_import_usage(UUID, UUID, INTEGER)
    TO authenticated;
  GRANT EXECUTE ON FUNCTION increment_photo_import_usage(UUID, UUID, INTEGER)
    TO service_role;
END;
$perms$;

-- Share extension: unchanged behaviour, plus the trusted-writer flag so the
-- guard above does not reject its own write path.
CREATE OR REPLACE FUNCTION increment_share_extension_usage(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    new_count INTEGER;
    caller_id UUID;
    current_period_start TIMESTAMPTZ;
    current_month_start TIMESTAMPTZ;
BEGIN
    -- Authorization check: ensure caller owns the target row
    caller_id := auth.uid();
    IF caller_id IS NULL OR caller_id != p_user_id THEN
        RAISE EXCEPTION 'Unauthorized: can only increment your own usage';
    END IF;

    -- Acquire advisory lock for this user to prevent concurrent increment races
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

    -- Calculate start of current UTC month (as TIMESTAMPTZ for correct comparison)
    current_month_start := timezone('UTC', date_trunc('month', NOW() AT TIME ZONE 'UTC'));

    -- Get current period start
    SELECT usage_share_extension_period_start INTO current_period_start
    FROM user_profile WHERE user_id = p_user_id;

    PERFORM set_config('app.subscription_write', 'on', true);

    -- If period is from a previous month, reset the count
    IF current_period_start IS NULL OR current_period_start < current_month_start THEN
        UPDATE user_profile
        SET usage_share_extension_count = 1,
            usage_share_extension_period_start = NOW()
        WHERE user_id = p_user_id
        RETURNING usage_share_extension_count INTO new_count;
    ELSE
        -- Normal increment within the same month
        UPDATE user_profile
        SET usage_share_extension_count = COALESCE(usage_share_extension_count, 0) + 1
        WHERE user_id = p_user_id
        RETURNING usage_share_extension_count INTO new_count;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User profile not found for user %', p_user_id;
    END IF;

    RETURN new_count;
END;
$$;

-- Subscription updates: service-role only (migration 0056), but flagged as a
-- trusted write so the guard can never strand the webhook path.
CREATE OR REPLACE FUNCTION update_subscription_if_newer(
    p_user_id UUID,
    p_status TEXT,
    p_plan TEXT,
    p_expires_at TIMESTAMPTZ,
    p_revenuecat_id TEXT,
    p_event_timestamp_ms BIGINT,
    p_event_id TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    current_timestamp_ms BIGINT;
BEGIN
    -- Access control is enforced by REVOKE/GRANT permissions (see below).
    -- Do NOT add a session_user check here — PostgREST's connection role
    -- is 'authenticator', not 'service_role', so such checks always fail.

    -- Acquire advisory lock for this user to prevent concurrent webhook races
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

    -- Get current event timestamp
    SELECT COALESCE(last_webhook_timestamp_ms, 0) INTO current_timestamp_ms
    FROM user_profile WHERE user_id = p_user_id;

    -- Skip if this event is older than the last processed event
    IF current_timestamp_ms >= p_event_timestamp_ms THEN
        RETURN jsonb_build_object('skipped', true, 'reason', 'older_event');
    END IF;

    PERFORM set_config('app.subscription_write', 'on', true);

    -- Update subscription
    UPDATE user_profile
    SET subscription_status = p_status,
        subscription_plan = p_plan,
        subscription_expires_at = p_expires_at,
        revenuecat_customer_id = p_revenuecat_id,
        last_webhook_timestamp_ms = p_event_timestamp_ms,
        last_webhook_event_id = p_event_id
    WHERE user_id = p_user_id;

    IF FOUND THEN
        RETURN jsonb_build_object('updated', true);
    ELSE
        RETURN jsonb_build_object('updated', false, 'reason', 'user_not_found');
    END IF;
END;
$$;

DO $perms$
BEGIN
  REVOKE ALL ON FUNCTION update_subscription_if_newer FROM PUBLIC;
  REVOKE ALL ON FUNCTION update_subscription_if_newer FROM authenticated;
  GRANT EXECUTE ON FUNCTION update_subscription_if_newer TO service_role;
END;
$perms$;

-- ---------------------------------------------------------------------------
-- 5. Close the PostgREST schema-cache window opened by the DROP+CREATE above
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
