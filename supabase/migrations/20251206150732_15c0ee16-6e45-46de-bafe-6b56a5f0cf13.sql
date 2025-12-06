-- Create daily trading logs table
CREATE TABLE public.daily_trading_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  trade_date DATE NOT NULL DEFAULT CURRENT_DATE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL, -- 'long' or 'short'
  entry_price DECIMAL(20, 8) NOT NULL,
  exit_price DECIMAL(20, 8) NOT NULL,
  quantity DECIMAL(20, 8) NOT NULL,
  leverage INTEGER NOT NULL DEFAULT 1,
  pnl_usd DECIMAL(20, 8) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.daily_trading_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies - users can only see/modify their own logs
CREATE POLICY "Users can view their own trading logs"
ON public.daily_trading_logs
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own trading logs"
ON public.daily_trading_logs
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own trading logs"
ON public.daily_trading_logs
FOR DELETE
USING (auth.uid() = user_id);

-- Create index for faster daily queries
CREATE INDEX idx_daily_trading_logs_user_date ON public.daily_trading_logs(user_id, trade_date);