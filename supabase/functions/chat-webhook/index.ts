import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const webhookUrl = Deno.env.get('N8N_CHAT_WEBHOOK_URL');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!webhookUrl) {
      return new Response(
        JSON.stringify({ error: 'Chat webhook is not configured' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { threadId, userId, message, messages, chatHistory } = body;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Create a job record
    const { data: job, error: jobError } = await supabase
      .from('chat_jobs')
      .insert({
        thread_id: threadId,
        user_id: userId,
        status: 'pending',
        request_payload: { message, messages, chatHistory },
      })
      .select()
      .single();

    if (jobError || !job) {
      console.error('Failed to create chat job:', jobError);
      return new Response(
        JSON.stringify({ error: 'Failed to create chat job' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Created chat job:', job.id);

    // Build the callback URL for N8N to POST results back
    const callbackUrl = `${supabaseUrl}/functions/v1/chat-response-webhook`;

    // Fire-and-forget: send to N8N without awaiting
    const n8nPayload = {
      ...body,
      job_id: job.id,
      callback_url: callbackUrl,
    };

    // Use EdgeRuntime.waitUntil if available, otherwise just fire and forget
    const fetchPromise = fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(n8nPayload),
    }).then(async (res) => {
      console.log('N8N responded with status:', res.status);
      if (!res.ok) {
        // N8N failed — mark job as failed
        const errorText = await res.text().catch(() => 'Unknown error');
        console.error('N8N error response:', errorText);
        await supabase.from('chat_jobs').update({
          status: 'failed',
          response_content: 'The AI service encountered an error. Please try again.',
          completed_at: new Date().toISOString(),
        }).eq('id', job.id);
      }
    }).catch(async (err) => {
      console.error('N8N fetch error:', err);
      await supabase.from('chat_jobs').update({
        status: 'failed',
        response_content: 'Unable to reach the AI service. Please try again later.',
        completed_at: new Date().toISOString(),
      }).eq('id', job.id);
    });

    // Try to use waitUntil so the function can return immediately
    // but the fetch continues in the background
    try {
      (globalThis as any).EdgeRuntime?.waitUntil?.(fetchPromise);
    } catch {
      // If waitUntil isn't available, we still don't await — 
      // the fetch will run but may get killed when the function exits.
      // The callback webhook is the safety net.
    }

    // Return job_id immediately
    return new Response(
      JSON.stringify({ job_id: job.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in chat-webhook:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
