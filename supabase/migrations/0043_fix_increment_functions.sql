-- Fix increment functions to raise exception when user profile not found
-- Previously these functions would return NULL silently, making debugging difficult

CREATE OR REPLACE FUNCTION increment_share_extension_usage(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
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

    UPDATE user_profile
    SET usage_share_extension_count = COALESCE(usage_share_extension_count, 0) + 1
    WHERE id = p_user_id
    RETURNING usage_share_extension_count INTO new_count;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User profile not found for user %', p_user_id;
    END IF;

    RETURN new_count;
END;
$$;

CREATE OR REPLACE FUNCTION increment_photo_import_usage(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
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
