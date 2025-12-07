-- Migration: Add service role update policy for media_files
-- Allows backend service to update thumbnail_path after processing

CREATE POLICY "Service role can update media"
  ON media_files
  FOR UPDATE
  TO service_role
  WITH CHECK (true);
