import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as hexEncode } from "https://deno.land/std@0.177.0/encoding/hex.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Production and Testnet base URLs
const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
const BINANCE_TESTNET_BASE = 'https://testnet.binancefuture.com';

// HMAC-SHA256 signature
async function createSignature(queryString: string, secretKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(queryString)
  );
  return new TextDecoder().decode(hexEncode(new Uint8Array(signature)));
}

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

    // Select base URL based on mode
    const baseUrl = testnet ? BINANCE_TESTNET_BASE : BINANCE_FUTURES_BASE;

    console.log(`Binance API action: ${action} (${testnet ? 'TESTNET' : 'MAINNET'})`, JSON.stringify(params));

    const timestamp = Date.now();
    let endpoint = '';
    let method = 'GET';
    let queryParams: Record<string, string> = { timestamp: timestamp.toString() };

    switch (action) {
      case 'getAccountInfo':
        endpoint = '/fapi/v2/account';
        break;

      case 'getBalance':
        endpoint = '/fapi/v2/balance';
        break;

      case 'getPositions':
        endpoint = '/fapi/v2/positionRisk';
        if (params.symbol) {
          queryParams.symbol = params.symbol;
        }
        break;

      case 'getOpenOrders':
        endpoint = '/fapi/v1/openOrders';
        if (params.symbol) {
          queryParams.symbol = params.symbol;
        }
        break;

      case 'placeOrder':
        endpoint = '/fapi/v1/order';
        method = 'POST';
        queryParams = {
          ...queryParams,
          symbol: params.symbol,
          side: params.side,
          type: params.type || 'MARKET',
          quantity: params.quantity.toString(),
        };
        if (params.type === 'LIMIT') {
          queryParams.price = params.price.toString();
          queryParams.timeInForce = params.timeInForce || 'GTC';
        }
        if (params.reduceOnly) {
          queryParams.reduceOnly = 'true';
        }
        break;

      case 'cancelOrder':
        endpoint = '/fapi/v1/order';
        method = 'DELETE';
        queryParams = {
          ...queryParams,
          symbol: params.symbol,
          orderId: params.orderId?.toString(),
        };
        break;

      case 'cancelAllOrders':
        endpoint = '/fapi/v1/allOpenOrders';
        method = 'DELETE';
        queryParams = {
          ...queryParams,
          symbol: params.symbol,
        };
        break;

      case 'setLeverage':
        endpoint = '/fapi/v1/leverage';
        method = 'POST';
        queryParams = {
          ...queryParams,
          symbol: params.symbol,
          leverage: params.leverage.toString(),
        };
        break;

      case 'setMarginType':
        endpoint = '/fapi/v1/marginType';
        method = 'POST';
        queryParams = {
          ...queryParams,
          symbol: params.symbol,
          marginType: params.marginType,
        };
        break;

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    // Build query string and signature
    const queryString = new URLSearchParams(queryParams).toString();
    const signature = await createSignature(queryString, apiSecret);
    const signedQuery = `${queryString}&signature=${signature}`;

    // Make request to Binance
    const url = `${baseUrl}${endpoint}?${signedQuery}`;
    console.log(`Calling Binance: ${method} ${endpoint} (${testnet ? 'TESTNET' : 'MAINNET'})`);

    const response = await fetch(url, {
      method,
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Binance API error:', data);
      return new Response(
        JSON.stringify({ error: data.msg || 'Binance API error', code: data.code }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Binance API success for ${action} (${testnet ? 'TESTNET' : 'MAINNET'})`);
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
