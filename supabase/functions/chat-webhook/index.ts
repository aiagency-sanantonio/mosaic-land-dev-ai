import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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

    if (!webhookUrl) {
      console.error('N8N_CHAT_WEBHOOK_URL is not configured');
      return new Response(
        JSON.stringify({ error: 'Chat webhook is not configured' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { threadId, userId, message, messages, chatHistory } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Create a pending job
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
        JSON.stringify({ error: 'Failed to create job' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Created chat job:', job.id);

    // Build the callback URL for N8N to post back to
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const callbackUrl = `${supabaseUrl}/functions/v1/chat-response-webhook`;

    // Fire-and-forget: send to N8N but don't await the response
    const n8nPayload = {
      ...body,
      job_id: job.id,
      callback_url: callbackUrl,
    };

    // Use EdgeRuntime.waitUntil if available, otherwise fire-and-forget via catch
    const n8nFetch = fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(n8nPayload),
    }).then(async (res) => {
      console.log('N8N responded with status:', res.status);
      if (!res.ok) {
        const text = await res.text().catch(() => 'no body');
        console.error('N8N error response:', text);
        // Mark job as failed if N8N returns error immediately
        await supabase.from('chat_jobs').update({
          status: 'failed',
          response_content: 'N8N returned an error. Please try again.',
          completed_at: new Date().toISOString(),
        }).eq('id', job.id);
      }
    }).catch(async (err) => {
      console.error('N8N fetch error:', err);
      await supabase.from('chat_jobs').update({
        status: 'failed',
        response_content: 'Failed to connect to the processing service.',
        completed_at: new Date().toISOString(),
      }).eq('id', job.id);
    });

    // Keep the function alive until N8N responds
    // But return the job_id to the frontend immediately via a race
    // Actually we need to wait for N8N since Deno will kill the process otherwise
    // Use a background approach: respond first, then wait
    
    // EdgeRuntime.waitUntil keeps the isolate alive after responding
    if (typeof (globalThis as any).EdgeRuntime !== 'undefined' && (globalThis as any).EdgeRuntime.waitUntil) {
      (globalThis as any).EdgeRuntime.waitUntil(n8nFetch);
    } else {
      // Fallback: just await it (function stays alive)
      await n8nFetch;
    }

    // Return job_id immediately to frontend
    return new Response(
      JSON.stringify({ job_id: job.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in chat-webhook:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
