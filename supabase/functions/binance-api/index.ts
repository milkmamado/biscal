import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// VPS Proxy Server (Fixed IP: 158.247.211.233)
const VPS_PROXY_URL = 'http://158.247.211.233:3000/api/binance';

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Get current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.error('Auth error:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body = await req.json();
    const { action, params = {}, testnet = false } = body;

    // Get user's API keys (based on testnet mode)
    const { data: apiKeys, error: keysError } = await supabase
      .from('user_api_keys')
      .select('api_key, api_secret')
      .eq('user_id', user.id)
      .eq('is_testnet', testnet)
      .single();

    if (keysError || !apiKeys) {
      console.log(`No ${testnet ? 'testnet' : 'mainnet'} API keys found for user:`, user.id);
      return new Response(
        JSON.stringify({ 
          error: testnet 
            ? 'Testnet API keys not configured. Please register testnet API keys first.' 
            : 'API keys not configured', 
          code: 'NO_API_KEYS' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { api_key: apiKey, api_secret: apiSecret } = apiKeys;

    console.log(`Binance API action: ${action} (${testnet ? 'TESTNET' : 'MAINNET'}) via VPS Proxy`, JSON.stringify(params));

    // Map action to endpoint
    let endpoint = '';
    let method = 'GET';

    switch (action) {
      case 'getAccountInfo':
        endpoint = '/fapi/v2/account';
        break;
      case 'getBalance':
        endpoint = '/fapi/v2/balance';
        break;
      case 'getPositions':
        endpoint = '/fapi/v2/positionRisk';
        break;
      case 'getOpenOrders':
        endpoint = '/fapi/v1/openOrders';
        break;
      case 'placeOrder':
        endpoint = '/fapi/v1/order';
        method = 'POST';
        break;
      case 'cancelOrder':
        endpoint = '/fapi/v1/order';
        method = 'DELETE';
        break;
      case 'cancelAllOrders':
        endpoint = '/fapi/v1/allOpenOrders';
        method = 'DELETE';
        break;
      case 'setLeverage':
        endpoint = '/fapi/v1/leverage';
        method = 'POST';
        break;
      case 'setMarginType':
        endpoint = '/fapi/v1/marginType';
        method = 'POST';
        break;
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    // Filter out null/undefined params to prevent Binance API errors
    const filteredParams = Object.fromEntries(
      Object.entries(params).filter(([_, value]) => value !== null && value !== undefined)
    );

    // Call VPS Proxy Server
    console.log(`Calling VPS Proxy: ${method} ${endpoint}`);
    
    const proxyResponse = await fetch(VPS_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apiKey,
        apiSecret,
        endpoint,
        method,
        params: filteredParams,
        testnet,
      }),
    });

    const data = await proxyResponse.json();

    if (data.error || data.code) {
      console.error('Binance API error via VPS:', data);
      return new Response(
        JSON.stringify({ error: data.msg || data.error || 'Binance API error', code: data.code }),
        { status: proxyResponse.status === 200 ? 400 : proxyResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Binance API success for ${action} via VPS Proxy`);
    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Edge function error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
