// send-push-notification Edge Function
// Sends push notifications via Expo Push API

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

interface PushNotificationRequest {
  tokens: string[];
  title: string;
  body: string;
  data?: {
    screen?: string;
    userId?: string;
    username?: string;
    tripId?: string;
  };
}

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  data?: Record<string, string>;
}

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
    const { tokens, title, body, data } = (await req.json()) as PushNotificationRequest;

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No push tokens provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!title || !body) {
      return new Response(
        JSON.stringify({ error: 'Title and body are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Build Expo push messages
    const messages: ExpoMessage[] = tokens
      .filter((token) => token.startsWith('ExponentPushToken['))
      .map((token) => ({
        to: token,
        title,
        body,
        sound: 'default' as const,
        data: data as Record<string, string> | undefined,
      }));

    if (messages.length === 0) {
      return new Response(
        JSON.stringify({ status: 'no_valid_tokens' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Send to Expo Push API
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(messages),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Expo Push API error:', result);
      return new Response(
        JSON.stringify({ error: 'Failed to send push notification', details: result }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Log any ticket errors for debugging
    if (result.data) {
      const errors = result.data.filter((ticket: { status: string }) => ticket.status === 'error');
      if (errors.length > 0) {
        console.warn('Some push notifications failed:', errors);
      }
    }

    return new Response(
      JSON.stringify({
        status: 'sent',
        sent_count: messages.length,
        tickets: result.data,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error sending push notification:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
