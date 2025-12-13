-- Drop overly permissive policies on email_verification_codes
DROP POLICY IF EXISTS "Allow insert for verification codes" ON public.email_verification_codes;
DROP POLICY IF EXISTS "Allow select for verification codes" ON public.email_verification_codes;
DROP POLICY IF EXISTS "Allow update for verification codes" ON public.email_verification_codes;

-- Create restrictive policies - only service role (edge functions) can access
-- No public access at all - edge functions use service_role key which bypasses RLS
-- This effectively blocks all client-side access while allowing edge functions to work

CREATE POLICY "Service role only - no public access"
ON public.email_verification_codes
FOR ALL
USING (false)
WITH CHECK (false);