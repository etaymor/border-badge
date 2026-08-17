-- Add service_role guard to update_subscription_if_newer
--
-- Defense-in-depth: While REVOKE/GRANT permissions restrict this function to
-- service_role only, add an explicit session_user check inside the function
-- to guard against potential permission misconfigurations.
--
-- Note: This function uses SECURITY DEFINER, so:
--   - current_user = function owner (postgres)
--   - session_user = original caller's role (should be service_role)

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
    -- Authorization check: ensure caller is service_role (webhooks/backend only)
    -- session_user gives the original caller's role in SECURITY DEFINER functions
    IF session_user != 'service_role' THEN
        RAISE EXCEPTION 'Permission denied: only service_role can invoke this function';
    END IF;

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

-- Re-apply permissions (CREATE OR REPLACE doesn't affect these, but be explicit)
-- Wrapped in DO block because remote migration runner cannot prepare multiple statements.
DO $perms$
BEGIN
  REVOKE ALL ON FUNCTION update_subscription_if_newer FROM PUBLIC;
  REVOKE ALL ON FUNCTION update_subscription_if_newer FROM authenticated;
  GRANT EXECUTE ON FUNCTION update_subscription_if_newer TO service_role;
END;
$perms$;
