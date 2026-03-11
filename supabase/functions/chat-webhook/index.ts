import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const webhookUrl = Deno.env.get('N8N_CHAT_WEBHOOK_URL');
    
    if (!webhookUrl) {
      console.error('N8N_CHAT_WEBHOOK_URL is not configured');
      return new Response(
        JSON.stringify({ 
          error: 'Chat webhook is not configured',
          response: 'I apologize, but the chat service is not configured yet. Please contact the administrator.'
        }),
        { 
          status: 200, // Return 200 so frontend can handle gracefully
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const body = await req.json();
    console.log('Forwarding chat message to N8N webhook');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600000); // 10 minutes

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error('N8N webhook returned error:', response.status);
      return new Response(
        JSON.stringify({ 
          response: 'I apologize, but I encountered an issue processing your request. Please try again.' 
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const data = await response.json();
    console.log('N8N webhook response received, data:', JSON.stringify(data));

    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in chat-webhook:', error);
    return new Response(
      JSON.stringify({ 
        response: 'I apologize, but I was unable to connect to the processing service. Please try again later.' 
      }),
      { 
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
