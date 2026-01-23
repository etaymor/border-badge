-- Migration: Add is_system check to soft_delete_trip RPC
-- Defense-in-depth: RLS already prevents system trip deletion, but the RPC
-- should also explicitly validate this for consistency and clarity.

-- Replace the soft_delete_trip function with one that checks is_system
CREATE OR REPLACE FUNCTION soft_delete_trip(p_trip_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE trip
  SET deleted_at = now()
  WHERE id = p_trip_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL
    AND is_system = false;  -- Defense-in-depth: prevent system trip deletion
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
