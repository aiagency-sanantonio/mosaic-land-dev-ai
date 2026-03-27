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
    const body = await req.json();
    const { threadId, userId, message, messages, chatHistory, uploaded_document } = body;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabase = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Create a pending job
    const { data: job, error: jobError } = await supabase
      .from('chat_jobs')
      .insert({
        thread_id: threadId,
        user_id: userId,
        status: 'pending',
        request_payload: { message, messages, chatHistory, ...(uploaded_document ? { uploaded_document } : {}) },
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

    // Build the callback URL for chat-response-webhook
    const callbackUrl = `${supabaseUrl}/functions/v1/chat-response-webhook`;

    // Build the chat-rag URL
    const chatRagUrl = `${supabaseUrl}/functions/v1/chat-rag`;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const ragPayload = {
      ...body,
      job_id: job.id,
      callback_url: callbackUrl,
    };

    // Fire-and-forget: send to chat-rag but don't block the response
    const ragFetch = fetch(chatRagUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${anonKey}`,
      },
      body: JSON.stringify(ragPayload),
    }).then(async (res) => {
      console.log('chat-rag responded with status:', res.status);
      if (!res.ok) {
        const text = await res.text().catch(() => 'no body');
        console.error('chat-rag error response:', text);
        await supabase.from('chat_jobs').update({
          status: 'failed',
          response_content: 'Processing service returned an error. Please try again.',
          completed_at: new Date().toISOString(),
        }).eq('id', job.id);
      }
    }).catch(async (err) => {
      console.error('chat-rag fetch error:', err);
      await supabase.from('chat_jobs').update({
        status: 'failed',
        response_content: 'Failed to connect to the processing service.',
        completed_at: new Date().toISOString(),
      }).eq('id', job.id);
    });

    // Keep the function alive until chat-rag responds
    if (typeof (globalThis as any).EdgeRuntime !== 'undefined' && (globalThis as any).EdgeRuntime.waitUntil) {
      (globalThis as any).EdgeRuntime.waitUntil(ragFetch);
    } else {
      await ragFetch;
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
