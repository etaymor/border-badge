// send-invite-email Edge Function
// Sends invite emails via Resend API

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

interface InviteEmailRequest {
  email: string;
  inviter_name: string;
  invite_code: string;
  invite_type: 'follow' | 'trip_tag';
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const APP_URL = Deno.env.get('APP_URL') || 'https://borderbadge.app';

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

  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return new Response(
      JSON.stringify({ error: 'Email service not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { email, inviter_name, invite_code, invite_type } = (await req.json()) as InviteEmailRequest;

    if (!email || !inviter_name || !invite_code) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const inviteUrl = `${APP_URL}/invite?code=${encodeURIComponent(invite_code)}`;

    const subject = invite_type === 'trip_tag'
      ? `${inviter_name} tagged you in a trip on Border Badge`
      : `${inviter_name} wants to connect on Border Badge`;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #FBF9F3; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .card { background: white; border-radius: 16px; padding: 40px; text-align: center; }
    .logo { font-size: 32px; margin-bottom: 24px; }
    h1 { color: #1E3A5F; font-size: 24px; margin-bottom: 16px; }
    p { color: #6B7280; font-size: 16px; line-height: 1.6; }
    .button { display: inline-block; background: #1E3A5F; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 24px; }
    .footer { text-align: center; margin-top: 24px; color: #9CA3AF; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">🌍</div>
      <h1>${inviter_name} invited you!</h1>
      <p>
        ${invite_type === 'trip_tag'
          ? `${inviter_name} has tagged you in a trip on Border Badge. Join to see the adventure and share your own travel memories.`
          : `${inviter_name} wants to connect with you on Border Badge, the travel app where you can track countries you've visited and share your journeys.`
        }
      </p>
      <a href="${inviteUrl}" class="button">Accept Invitation</a>
    </div>
    <p class="footer">
      Border Badge - Track your travels, share your adventures
    </p>
  </div>
</body>
</html>
`;

    const textContent = `
${inviter_name} invited you!

${invite_type === 'trip_tag'
  ? `${inviter_name} has tagged you in a trip on Border Badge.`
  : `${inviter_name} wants to connect with you on Border Badge.`
}

Accept the invitation: ${inviteUrl}

Border Badge - Track your travels, share your adventures
`;

    // Send via Resend
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Border Badge <noreply@borderbadge.app>',
        to: [email],
        subject,
        html: htmlContent,
        text: textContent,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Resend API error:', result);
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: result }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ status: 'sent', message_id: result.id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error sending invite email:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
