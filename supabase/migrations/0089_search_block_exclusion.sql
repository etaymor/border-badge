-- Migration: Search/lookup block exclusion (plan U3, KTD4)
--
-- Moves the block filtering for user search and email lookup into SQL so
-- every caller inherits it (KTD4: block/consent semantics live in SQL).
-- The previous Python enforcement queried user_block with the caller's JWT,
-- and RLS hides "someone blocked me" rows from the blocked party, so the
-- blocked-by direction silently passed. These SECURITY DEFINER RPCs see both
-- directions.
--
-- 1. search_users_excluding_blocked: username-prefix search that excludes
--    the caller and any user with a block in either direction between them.
--    Called with the caller's JWT (auth.uid() identifies the caller).
-- 2. lookup_user_by_email_excluding_blocked: exact-email lookup that
--    excludes the requester themselves and blocked pairs in either
--    direction. Service-role only (joins auth.users), so the requester id
--    is an explicit parameter; mirrors 0067_lookup_user_by_email.

--------------------------------------------------------------------------------
-- 1. USER SEARCH WITH BLOCK ANTI-JOIN
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION search_users_excluding_blocked(
  p_query TEXT,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  username TEXT,
  avatar_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_pattern TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'search_users_excluding_blocked requires an authenticated caller';
  END IF;

  -- Treat the query as a literal prefix: escape LIKE wildcards so an
  -- underscore in a username matches only an underscore. (The API layer
  -- also pre-validates the query against the username charset.)
  v_pattern := replace(
    replace(
      replace(p_query, '\', '\\'),
      '%', '\%'
    ),
    '_', '\_'
  ) || '%';

  RETURN QUERY
  SELECT up.id, up.user_id, up.username, up.avatar_url
  FROM user_profile up
  WHERE up.username ILIKE v_pattern
    AND up.user_id <> v_caller
    -- Anti-join: exclude blocks in BOTH directions.
    AND NOT EXISTS (
      SELECT 1 FROM user_block ub
      WHERE (ub.blocker_id = v_caller AND ub.blocked_id = up.user_id)
         OR (ub.blocker_id = up.user_id AND ub.blocked_id = v_caller)
    )
  ORDER BY up.username
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
END;
$$;

-- Callable by authenticated users (auth.uid() gates the caller identity)
-- and the service role; never anon.
REVOKE ALL ON FUNCTION search_users_excluding_blocked(TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION search_users_excluding_blocked(TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION search_users_excluding_blocked(TEXT, INTEGER)
  TO authenticated;
GRANT EXECUTE ON FUNCTION search_users_excluding_blocked(TEXT, INTEGER)
  TO service_role;

--------------------------------------------------------------------------------
-- 2. EMAIL LOOKUP WITH BLOCK ANTI-JOIN
--------------------------------------------------------------------------------
-- Service-role only (it joins auth.users), so auth.uid() is unavailable and
-- the requester is passed explicitly. Returns zero rows when the match is
-- the requester themselves or when a block exists in either direction, so
-- the API cannot distinguish (and cannot leak) "blocked" from "not found".

CREATE OR REPLACE FUNCTION lookup_user_by_email_excluding_blocked(
  email_to_lookup TEXT,
  p_requester_id UUID
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  RETURN QUERY
  SELECT up.id, up.user_id, up.username, up.display_name, up.avatar_url
  FROM auth.users au
  INNER JOIN public.user_profile up ON up.user_id = au.id
  WHERE LOWER(au.email) = LOWER(email_to_lookup)
    AND up.user_id <> p_requester_id
    -- Anti-join: exclude blocks in BOTH directions.
    AND NOT EXISTS (
      SELECT 1 FROM public.user_block ub
      WHERE (ub.blocker_id = p_requester_id AND ub.blocked_id = up.user_id)
         OR (ub.blocker_id = up.user_id AND ub.blocked_id = p_requester_id)
    )
  LIMIT 1;
END;
$$;

-- Mirror lookup_user_by_email (0067): service role only, to prevent email
-- enumeration by anon or authenticated callers.
REVOKE ALL ON FUNCTION lookup_user_by_email_excluding_blocked(TEXT, UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION lookup_user_by_email_excluding_blocked(TEXT, UUID)
  FROM anon;
REVOKE ALL ON FUNCTION lookup_user_by_email_excluding_blocked(TEXT, UUID)
  FROM authenticated;
GRANT EXECUTE ON FUNCTION lookup_user_by_email_excluding_blocked(TEXT, UUID)
  TO service_role;
