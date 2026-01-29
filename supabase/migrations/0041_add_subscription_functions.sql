-- Subscription-related database functions
-- Provides atomic operations for usage tracking and webhook processing

-- SECURITY: Separate functions per column to prevent SQL injection
-- DO NOT use dynamic column names from user input

-- Atomic increment for share extension usage (with auth check)
CREATE OR REPLACE FUNCTION increment_share_extension_usage(p_user_id UUID)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    new_count integer;
    caller_id UUID;
BEGIN
    -- Authorization check: ensure caller owns the target row
    caller_id := auth.uid();
    IF caller_id IS NULL OR caller_id != p_user_id THEN
        RAISE EXCEPTION 'Unauthorized: can only increment your own usage';
    END IF;

    UPDATE user_profile
    SET usage_share_extension_count = COALESCE(usage_share_extension_count, 0) + 1
    WHERE id = p_user_id
    RETURNING usage_share_extension_count INTO new_count;
    RETURN new_count;
END;
$$;

-- Atomic increment for photo import usage (with auth check)
CREATE OR REPLACE FUNCTION increment_photo_import_usage(p_user_id UUID)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    new_count integer;
    caller_id UUID;
BEGIN
    -- Authorization check: ensure caller owns the target row
    caller_id := auth.uid();
    IF caller_id IS NULL OR caller_id != p_user_id THEN
        RAISE EXCEPTION 'Unauthorized: can only increment your own usage';
    END IF;

    UPDATE user_profile
    SET usage_photo_import_count = COALESCE(usage_photo_import_count, 0) + 1
    WHERE id = p_user_id
    RETURNING usage_photo_import_count INTO new_count;
    RETURN new_count;
END;
$$;

-- Atomic subscription update with ordering (for concurrent webhooks)
-- Uses advisory lock to prevent race conditions between concurrent webhook deliveries
-- SECURITY: Only callable by service role (webhook/backend service account)
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
    -- Acquire advisory lock for this user to prevent concurrent webhook races
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

    -- Get current event timestamp
    SELECT COALESCE(last_webhook_timestamp_ms, 0) INTO current_timestamp_ms
    FROM user_profile WHERE id = p_user_id;

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
    WHERE id = p_user_id;

    IF FOUND THEN
        RETURN jsonb_build_object('updated', true);
    ELSE
        RETURN jsonb_build_object('updated', false, 'reason', 'user_not_found');
    END IF;
END;
$$;

-- Grant execute permissions to authenticated users for usage functions
GRANT EXECUTE ON FUNCTION increment_share_extension_usage TO authenticated;
GRANT EXECUTE ON FUNCTION increment_photo_import_usage TO authenticated;

-- SECURITY: Restrict update_subscription_if_newer to service role only
-- Revoke from public and authenticated to ensure only service role can invoke
REVOKE ALL ON FUNCTION update_subscription_if_newer FROM PUBLIC;
REVOKE ALL ON FUNCTION update_subscription_if_newer FROM authenticated;
-- Service role has superuser privileges and can execute without explicit grant
