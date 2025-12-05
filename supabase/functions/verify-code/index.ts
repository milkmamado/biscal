import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VerifyRequest {
  email: string;
  code: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, code }: VerifyRequest = await req.json();
    
    if (!email || !code) {
      console.error("Missing email or code in request");
      return new Response(
        JSON.stringify({ error: "이메일과 인증 코드가 필요합니다" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Verifying code for: ${email}`);

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the verification code
    const { data: verificationData, error: fetchError } = await supabase
      .from("email_verification_codes")
      .select("*")
      .eq("email", email)
      .eq("code", code)
      .eq("used", false)
      .gte("expires_at", new Date().toISOString())
      .maybeSingle();

    if (fetchError) {
      console.error("Failed to fetch verification code:", fetchError);
      return new Response(
        JSON.stringify({ error: "인증 코드 확인 실패" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!verificationData) {
      console.log("Invalid or expired code for:", email);
      return new Response(
        JSON.stringify({ error: "잘못된 인증 코드이거나 만료되었습니다", valid: false }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Mark code as used
    await supabase
      .from("email_verification_codes")
      .update({ used: true })
      .eq("id", verificationData.id);

    console.log("Code verified successfully for:", email);

    return new Response(
      JSON.stringify({ valid: true, message: "인증 성공" }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in verify-code function:", error);
    return new Response(
      JSON.stringify({ error: error.message || "인증 실패" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
