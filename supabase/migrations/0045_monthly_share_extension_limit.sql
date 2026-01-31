-- Add monthly reset support for share extension usage
-- Free users get 5 saves per month instead of 5 lifetime

-- Add period tracking column for share extension usage
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS usage_share_extension_period_start TIMESTAMPTZ DEFAULT NOW();

-- Update increment function to auto-reset on new calendar month (UTC)
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

    -- Calculate start of current UTC month
    current_month_start := date_trunc('month', NOW() AT TIME ZONE 'UTC');

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

-- Backfill: Set period_start for existing users who have used share extension
-- Their usage will reset on next increment in a new month
UPDATE user_profile
SET usage_share_extension_period_start = NOW()
WHERE usage_share_extension_count > 0 AND usage_share_extension_period_start IS NULL;
