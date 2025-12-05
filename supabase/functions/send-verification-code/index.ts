import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VerificationRequest {
  email: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email }: VerificationRequest = await req.json();
    
    if (!email) {
      console.error("Missing email in request");
      return new Response(
        JSON.stringify({ error: "이메일이 필요합니다" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Generating verification code for: ${email}`);

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Delete any existing codes for this email
    await supabase
      .from("email_verification_codes")
      .delete()
      .eq("email", email);

    // Store the code
    const { error: insertError } = await supabase
      .from("email_verification_codes")
      .insert({
        email,
        code,
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      console.error("Failed to store verification code:", insertError);
      return new Response(
        JSON.stringify({ error: "인증 코드 저장 실패" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Sending verification code to: ${email}`);

    // Send email
    const emailResponse = await resend.emails.send({
      from: "BISCAL <onboarding@resend.dev>",
      to: [email],
      subject: "BISCAL 로그인 인증 코드",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #10b981; font-size: 28px; margin-bottom: 10px;">BISCAL</h1>
          <p style="color: #6b7280; font-size: 14px; margin-bottom: 30px;">Binance Futures Scalping Terminal</p>
          
          <p style="color: #374151; font-size: 16px;">로그인 인증 코드:</p>
          
          <div style="background: linear-gradient(135deg, #10b981, #06b6d4, #3b82f6); padding: 20px; border-radius: 12px; text-align: center; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: bold; color: white; letter-spacing: 8px;">${code}</span>
          </div>
          
          <p style="color: #9ca3af; font-size: 14px;">이 코드는 5분 후에 만료됩니다.</p>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 30px;">본인이 요청하지 않은 경우 이 이메일을 무시하세요.</p>
        </div>
      `,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, message: "인증 코드가 발송되었습니다" }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-verification-code function:", error);
    return new Response(
      JSON.stringify({ error: error.message || "인증 코드 발송 실패" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
