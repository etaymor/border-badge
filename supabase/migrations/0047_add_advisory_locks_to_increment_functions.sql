-- Add advisory locks to increment functions to prevent lost updates under concurrency
--
-- Problem: Concurrent calls to increment_share_extension_usage or increment_photo_import_usage
-- could suffer lost updates due to read-modify-write race conditions.
--
-- Solution: Use pg_advisory_xact_lock with user_id hash before reading/updating the count,
-- matching the pattern used in update_subscription_if_newer.

-- Update increment_share_extension_usage with advisory lock
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
    FROM user_profile WHERE id = p_user_id;

    -- If period is from a previous month, reset the count
    IF current_period_start IS NULL OR current_period_start < current_month_start THEN
        UPDATE user_profile
        SET usage_share_extension_count = 1,
            usage_share_extension_period_start = NOW()
        WHERE id = p_user_id
        RETURNING usage_share_extension_count INTO new_count;
    ELSE
        -- Normal increment within the same month
        UPDATE user_profile
        SET usage_share_extension_count = COALESCE(usage_share_extension_count, 0) + 1
        WHERE id = p_user_id
        RETURNING usage_share_extension_count INTO new_count;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User profile not found for user %', p_user_id;
    END IF;

    RETURN new_count;
END;
$$;

-- Update increment_photo_import_usage with advisory lock
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
    WHERE id = p_user_id
    RETURNING usage_photo_import_count INTO new_count;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User profile not found for user %', p_user_id;
    END IF;

    RETURN new_count;
END;
$$;
