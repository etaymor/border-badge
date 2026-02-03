-- Fix user_profile lookup in subscription functions
--
-- Bug: All subscription-related functions were using WHERE id = p_user_id
-- but 'id' is the auto-generated PK, not the auth user ID. The correct column
-- is 'user_id' which references auth.users(id).
--
-- Affected functions:
-- - increment_share_extension_usage
-- - increment_photo_import_usage
-- - update_subscription_if_newer

-- Fix increment_share_extension_usage
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
    -- Uses transaction-scoped lock that's automatically released at commit/rollback
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

    -- Calculate start of current UTC month (as TIMESTAMPTZ for correct comparison)
    current_month_start := timezone('UTC', date_trunc('month', NOW() AT TIME ZONE 'UTC'));

    -- Get current period start
    SELECT usage_share_extension_period_start INTO current_period_start
    FROM user_profile WHERE user_id = p_user_id;

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

-- Fix increment_photo_import_usage
CREATE OR REPLACE FUNCTION increment_photo_import_usage(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    new_count INTEGER;
    caller_id UUID;
BEGIN
    -- Authorization check: ensure caller owns the target row
    caller_id := auth.uid();
    IF caller_id IS NULL OR caller_id != p_user_id THEN
        RAISE EXCEPTION 'Unauthorized: can only increment your own usage';
    END IF;

    -- Acquire advisory lock for this user to prevent concurrent increment races
    -- Uses transaction-scoped lock that's automatically released at commit/rollback
    PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

    UPDATE user_profile
    SET usage_photo_import_count = COALESCE(usage_photo_import_count, 0) + 1
    WHERE user_id = p_user_id
    RETURNING usage_photo_import_count INTO new_count;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User profile not found for user %', p_user_id;
    END IF;

    RETURN new_count;
END;
$$;

-- Fix update_subscription_if_newer
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
