-- Add is_testnet column to distinguish between mainnet and testnet API keys
ALTER TABLE public.user_api_keys 
ADD COLUMN IF NOT EXISTS is_testnet BOOLEAN NOT NULL DEFAULT false;

-- Create unique constraint for user_id + is_testnet combination
-- (one mainnet key and one testnet key per user)
ALTER TABLE public.user_api_keys
DROP CONSTRAINT IF EXISTS user_api_keys_user_id_testnet_unique;

ALTER TABLE public.user_api_keys
ADD CONSTRAINT user_api_keys_user_id_testnet_unique UNIQUE (user_id, is_testnet);