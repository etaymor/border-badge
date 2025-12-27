// process-signup-invites Edge Function
// Processes pending invites when a new user signs up
// This function should be triggered as a database webhook on auth.users INSERT

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface WebhookPayload {
  type: 'INSERT';
  table: 'users';
  schema: 'auth';
  record: {
    id: string;
    email: string;
  };
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const payload = (await req.json()) as WebhookPayload;

    // Only process INSERT events
    if (payload.type !== 'INSERT') {
      return new Response(
        JSON.stringify({ status: 'ignored', reason: 'not an insert' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { id: newUserId, email } = payload.record;

    if (!newUserId || !email) {
      return new Response(
        JSON.stringify({ error: 'Missing user id or email' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create admin client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find pending invites for this email
    const { data: pendingInvites, error: fetchError } = await supabase
      .from('pending_invite')
      .select('id, inviter_id, invite_type, trip_id')
      .eq('email', email.toLowerCase())
      .eq('status', 'pending');

    if (fetchError) {
      console.error('Error fetching pending invites:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch pending invites' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!pendingInvites || pendingInvites.length === 0) {
      return new Response(
        JSON.stringify({ status: 'no_pending_invites' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const processedInvites: string[] = [];
    const errors: string[] = [];

    for (const invite of pendingInvites) {
      try {
        if (invite.invite_type === 'follow') {
          // Create follow relationship: new user follows the inviter
          const { error: followError } = await supabase
            .from('user_follow')
            .insert({
              follower_id: newUserId,
              following_id: invite.inviter_id,
            });

          if (followError && !followError.message.includes('duplicate')) {
            throw followError;
          }

          // Also create reverse follow: inviter follows the new user
          const { error: reverseFollowError } = await supabase
            .from('user_follow')
            .insert({
              follower_id: invite.inviter_id,
              following_id: newUserId,
            });

          if (reverseFollowError && !reverseFollowError.message.includes('duplicate')) {
            // Log but don't fail - one-way follow is still useful
            console.warn('Failed to create reverse follow:', reverseFollowError);
          }
        } else if (invite.invite_type === 'trip_tag' && invite.trip_id) {
          // Create trip tag with approved status
          const { error: tagError } = await supabase
            .from('trip_tags')
            .insert({
              trip_id: invite.trip_id,
              tagged_user_id: newUserId,
              status: 'approved',
            });

          if (tagError && !tagError.message.includes('duplicate')) {
            throw tagError;
          }
        }

        // Update invite status to accepted
        const { error: updateError } = await supabase
          .from('pending_invite')
          .update({ status: 'accepted' })
          .eq('id', invite.id);

        if (updateError) {
          throw updateError;
        }

        processedInvites.push(invite.id);
      } catch (error) {
        console.error(`Error processing invite ${invite.id}:`, error);
        errors.push(invite.id);
      }
    }

    return new Response(
      JSON.stringify({
        status: 'processed',
        processed_count: processedInvites.length,
        error_count: errors.length,
        processed_invites: processedInvites,
        failed_invites: errors,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error processing signup invites:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
