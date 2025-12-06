-- Phase 6: Create media storage bucket and policies
-- Sets up Supabase Storage for user media uploads

--------------------------------------------------------------------------------
-- CREATE STORAGE BUCKET
--------------------------------------------------------------------------------

-- Create the media bucket if it doesn't exist
-- Note: This uses Supabase's storage schema
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

--------------------------------------------------------------------------------
-- STORAGE POLICIES
--------------------------------------------------------------------------------

-- Policy: Users can upload files to their own folder
-- File path format: {user_id}/{file_id}.{ext}
CREATE POLICY "Users can upload to their own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Anyone can read files (public bucket)
CREATE POLICY "Public read access for media"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'media');

-- Policy: Users can update their own files
CREATE POLICY "Users can update their own files"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Policy: Users can delete their own files
CREATE POLICY "Users can delete their own files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
