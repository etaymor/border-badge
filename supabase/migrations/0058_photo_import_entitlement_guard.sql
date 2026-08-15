-- U16: make the photo-import entitlement real and tamper-proof.
--
-- Three things happen here:
--
-- 1. `user_profile.usage_photo_import_trip_id` records WHICH trip consumed a
--    user's free photo import. The counter alone cannot tell "this user spent
--    their import" from "this user is still finishing the import they spent",
--    so the exemption that keeps that one trip completable (R17) has to live
--    beside the charge, server-side, where it survives a reinstall or a device
--    change.
--
-- 2. `increment_photo_import_usage` learns about that trip and stops
--    double-charging for it: re-entering the recorded trip returns the current
--    count instead of spending a second import.
--
-- 3. The subscription and usage columns stop being client-writable. They were
--    updatable by any client holding its own token, which would let a user
--    reset the very counter the endpoint now enforces. A BEFORE UPDATE trigger
--    rejects changes to them unless the write comes from the service role or
--    from one of the trusted SECURITY DEFINER functions, which announce
--    themselves with a transaction-local flag. Those functions remain the only
--    write path.
--
-- NOT APPLIED by this change -- file only.

-- ---------------------------------------------------------------------------
-- 1. Record the trip that consumed the import
-- ---------------------------------------------------------------------------

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS usage_photo_import_trip_id UUID
    REFERENCES trip(id) ON DELETE SET NULL;

COMMENT ON COLUMN user_profile.usage_photo_import_trip_id IS
  'Trip that consumed the free photo import. Server-side twin of the device '
  'marker: lets the user finish that one trip after the counter is spent (R17).';

-- ---------------------------------------------------------------------------
-- 2. Trusted-writer flag helper
-- ---------------------------------------------------------------------------
-- The guard below cannot use `current_user`: inside a SECURITY DEFINER
-- function `current_user` is the function OWNER, so every trusted function
-- would look like a superuser and so would anything they call. And it cannot
-- use `session_user` either -- migration 0056 established that PostgREST's
-- connection role is 'authenticator', never 'service_role'.
--
-- So trusted functions announce themselves explicitly with a transaction-local
-- GUC. `set_config(..., true)` is scoped to the current transaction, so the
-- permission cannot leak into a later statement on the same connection.

CREATE OR REPLACE FUNCTION begin_trusted_subscription_write()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    PERFORM set_config('app.subscription_write', 'on', true);
END;
$$;

DO $perms$
BEGIN
  REVOKE ALL ON FUNCTION begin_trusted_subscription_write FROM PUBLIC;
  REVOKE ALL ON FUNCTION begin_trusted_subscription_write FROM anon;
  REVOKE ALL ON FUNCTION begin_trusted_subscription_write FROM authenticated;
  GRANT EXECUTE ON FUNCTION begin_trusted_subscription_write TO service_role;
END;
$perms$;

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

    IF (NEW.subscription_status IS DISTINCT FROM OLD.subscription_status)
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

-- Photo import: records the consuming trip and refuses to charge twice for it.
-- Dropped rather than replaced so the new default-valued parameter does not
-- leave two overloads for PostgREST to choose between (see migration 0046).
DROP FUNCTION IF EXISTS increment_photo_import_usage(UUID);
DROP FUNCTION IF EXISTS increment_photo_import_usage(UUID, UUID);

CREATE FUNCTION increment_photo_import_usage(
    p_user_id UUID,
    p_trip_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    new_count INTEGER;
    caller_id UUID;
    current_count INTEGER;
    current_trip_id UUID;
BEGIN
    -- Authorization check: ensure caller owns the target row
    caller_id := auth.uid();
    IF caller_id IS NULL OR caller_id != p_user_id THEN
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

    -- Already charged for THIS trip: re-entry after a reinstall or on a second
    -- device must not spend a second import (R17).
    IF p_trip_id IS NOT NULL AND current_trip_id IS NOT NULL
        AND current_trip_id = p_trip_id THEN
        RETURN current_count;
    END IF;

    PERFORM set_config('app.subscription_write', 'on', true);

    UPDATE user_profile
    SET usage_photo_import_count = current_count + 1,
        -- First trip wins: the exemption belongs to the import that was paid
        -- for, not to whichever trip was opened most recently.
        usage_photo_import_trip_id = COALESCE(usage_photo_import_trip_id, p_trip_id)
    WHERE user_id = p_user_id
    RETURNING usage_photo_import_count INTO new_count;

    RETURN new_count;
END;
$$;

DO $perms$
BEGIN
  REVOKE ALL ON FUNCTION increment_photo_import_usage(UUID, UUID) FROM PUBLIC;
  REVOKE ALL ON FUNCTION increment_photo_import_usage(UUID, UUID) FROM anon;
  GRANT EXECUTE ON FUNCTION increment_photo_import_usage(UUID, UUID) TO authenticated;
  GRANT EXECUTE ON FUNCTION increment_photo_import_usage(UUID, UUID) TO service_role;
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
