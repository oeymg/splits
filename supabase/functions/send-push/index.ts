import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

type PushRequest = {
  phone: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { requests } = await req.json();
    if (!Array.isArray(requests) || requests.length === 0) {
      throw new Error('requests array is required');
    }

    const phones = [...new Set(requests.map((entry: PushRequest) => entry.phone))];
    const { data, error } = await supabase
      .from('device_tokens')
      .select('phone, expo_push_token')
      .in('phone', phones);

    if (error) throw error;

    const tokensByPhone = new Map<string, string[]>();
    for (const row of data ?? []) {
      const list = tokensByPhone.get(row.phone) ?? [];
      list.push(row.expo_push_token);
      tokensByPhone.set(row.phone, list);
    }

    const messages = requests.flatMap((entry: PushRequest) => {
      const tokens = tokensByPhone.get(entry.phone) ?? [];
      return tokens.map((token) => ({
        to: token,
        title: entry.title,
        body: entry.body,
        data: entry.data ?? {}
      }));
    });

    if (messages.length === 0) {
      return new Response(JSON.stringify({ ok: true, delivered: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const expoResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(messages)
    });

    if (!expoResponse.ok) {
      const message = await expoResponse.text();
      throw new Error(`Expo push error: ${message}`);
    }

    const expoJson = await expoResponse.json();

    return new Response(JSON.stringify({ ok: true, delivered: messages.length, expo: expoJson }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
