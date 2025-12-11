-- Add deposit and withdrawal columns to daily_balance_snapshots
ALTER TABLE public.daily_balance_snapshots 
ADD COLUMN IF NOT EXISTS deposit_usd numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS withdrawal_usd numeric DEFAULT 0;

-- Add comment for clarity
COMMENT ON COLUMN public.daily_balance_snapshots.deposit_usd IS 'Total deposits for the day in USD';
COMMENT ON COLUMN public.daily_balance_snapshots.withdrawal_usd IS 'Total withdrawals for the day in USD';