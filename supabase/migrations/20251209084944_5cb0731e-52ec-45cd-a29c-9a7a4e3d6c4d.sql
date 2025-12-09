-- Add daily_income_usd column to track actual trading income (excluding deposits/withdrawals)
ALTER TABLE public.daily_balance_snapshots
ADD COLUMN daily_income_usd numeric DEFAULT 0;

-- Add comment for clarity
COMMENT ON COLUMN public.daily_balance_snapshots.daily_income_usd IS 'Actual trading income from Binance Income History (excludes deposits/withdrawals)';