-- Create table for storing email verification codes
CREATE TABLE public.email_verification_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.email_verification_codes ENABLE ROW LEVEL SECURITY;

-- Allow insert without authentication (for login flow)
CREATE POLICY "Allow insert for verification codes"
ON public.email_verification_codes
FOR INSERT
WITH CHECK (true);

-- Allow select for verification
CREATE POLICY "Allow select for verification codes"
ON public.email_verification_codes
FOR SELECT
USING (true);

-- Allow update for marking as used
CREATE POLICY "Allow update for verification codes"
ON public.email_verification_codes
FOR UPDATE
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_email_verification_codes_email ON public.email_verification_codes(email);

-- Auto delete expired codes (cleanup function)
CREATE OR REPLACE FUNCTION public.cleanup_expired_verification_codes()
RETURNS void AS $$
BEGIN
  DELETE FROM public.email_verification_codes 
  WHERE expires_at < now() OR used = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;