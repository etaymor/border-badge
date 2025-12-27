-- Add missing DELETE policy for pending_invite table
CREATE POLICY "Users can delete their own invites"
  ON pending_invite FOR DELETE
  USING (inviter_id = auth.uid());
