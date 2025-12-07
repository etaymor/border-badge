-- Atomic soft-delete functions using SECURITY DEFINER
-- These functions provide atomic ownership verification + soft delete
-- to prevent race conditions and ensure consistent authorization

-- Soft delete a list (owner only)
-- Returns TRUE if the list was deleted, FALSE if not found or not authorized
CREATE OR REPLACE FUNCTION soft_delete_list(p_list_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE list
  SET deleted_at = now()
  WHERE id = p_list_id
    AND owner_id = auth.uid()
    AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Soft delete a trip (owner only)
-- Returns TRUE if the trip was deleted, FALSE if not found or not authorized
CREATE OR REPLACE FUNCTION soft_delete_trip(p_trip_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE trip
  SET deleted_at = now()
  WHERE id = p_trip_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Soft delete an entry (trip owner only)
-- Returns TRUE if the entry was deleted, FALSE if not found or not authorized
CREATE OR REPLACE FUNCTION soft_delete_entry(p_entry_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE entry
  SET deleted_at = now()
  WHERE id = p_entry_id
    AND trip_id IN (SELECT id FROM trip WHERE user_id = auth.uid())
    AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
