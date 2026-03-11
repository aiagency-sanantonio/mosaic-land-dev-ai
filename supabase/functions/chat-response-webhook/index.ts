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
    console.log('chat-response-webhook received:', JSON.stringify(body));

    const jobId = body.job_id || body.jobId;
    const response = body.response || body.output || body.text || '';

    if (!jobId) {
      console.error('No job_id provided');
      return new Response(
        JSON.stringify({ error: 'job_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Update the chat_jobs row with the response
    const { data, error } = await supabase
      .from('chat_jobs')
      .update({
        status: 'completed',
        response_content: response,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .select()
      .single();

    if (error) {
      console.error('Failed to update chat_jobs:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to update job', details: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Job updated successfully:', jobId);

    // Also save the assistant message to the messages table
    if (data && response) {
      const { error: msgError } = await supabase
        .from('messages')
        .insert({
          thread_id: data.thread_id,
          user_id: data.user_id,
          role: 'assistant',
          content: response,
        });

      if (msgError) {
        console.error('Failed to insert assistant message:', msgError);
      } else {
        console.log('Assistant message saved for thread:', data.thread_id);
      }
    }

    return new Response(
      JSON.stringify({ success: true, job_id: jobId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in chat-response-webhook:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
