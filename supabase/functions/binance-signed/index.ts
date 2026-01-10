import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Hex(secret: string, payload: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return toHex(sig);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { action, params = {}, testnet = false } = body ?? {};

    if (action !== "placeOrder") {
      return new Response(JSON.stringify({ error: "Unsupported action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read user's Binance keys (RLS should allow user to read their own row)
    const { data: keyRow, error: keyError } = await supabase
      .from("user_api_keys")
      .select("api_key, api_secret, is_testnet")
      .eq("user_id", user.id)
      .eq("is_testnet", false)
      .maybeSingle();

    if (keyError || !keyRow?.api_key || !keyRow?.api_secret) {
      return new Response(JSON.stringify({ error: "API keys not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = (testnet || keyRow.is_testnet)
      ? "https://testnet.binancefuture.com"
      : "https://fapi.binance.com";

    // Filter null/undefined
    const filteredParams: Record<string, any> = Object.fromEntries(
      Object.entries(params).filter(([_, v]) => v !== null && v !== undefined),
    );

    const timestamp = Date.now();
    const recvWindow = 5000;

    const qs = new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(filteredParams).map(([k, v]) => [k, String(v)]),
      ),
      timestamp: String(timestamp),
      recvWindow: String(recvWindow),
    });

    const queryString = qs.toString();
    const signature = await hmacSha256Hex(keyRow.api_secret, queryString);
    const bodyString = `${queryString}&signature=${signature}`;

    const res = await fetch(`${baseUrl}/fapi/v1/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-MBX-APIKEY": keyRow.api_key,
      },
      body: bodyString,
    });

    const text = await res.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }

    if (!res.ok || (data?.code && data.code < 0) || data?.error) {
      return new Response(
        JSON.stringify({
          error: data?.msg || data?.error || "Binance API error",
          code: data?.code,
          raw: data,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
