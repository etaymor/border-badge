-- Fix update_subscription_if_newer: remove broken session_user guard
--
-- Migration 0050 added `IF session_user != 'service_role'` inside the function.
-- When called via PostgREST with the service role key, session_user resolves to
-- 'authenticator' (PostgREST's connection role), not 'service_role'. This caused
-- every webhook and /subscriptions/verify call to fail with "Permission denied",
-- silently leaving all users with subscription_status = 'free'.
--
-- The correct access control is the REVOKE/GRANT permissions already applied in
-- migration 0050 (lines 67-71). PostgREST respects these grants, so the in-function
-- check is both redundant and broken. This migration removes it.

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

-- Re-apply permissions: only service_role can execute this function.
-- This is the correct way to restrict access via PostgREST.
DO $perms$
BEGIN
  REVOKE ALL ON FUNCTION update_subscription_if_newer FROM PUBLIC;
  REVOKE ALL ON FUNCTION update_subscription_if_newer FROM authenticated;
  GRANT EXECUTE ON FUNCTION update_subscription_if_newer TO service_role;
END;
$perms$;
