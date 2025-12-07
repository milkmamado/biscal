-- Create table to store daily closing balances
CREATE TABLE public.daily_balance_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  snapshot_date date NOT NULL,
  closing_balance_usd numeric NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  
  UNIQUE(user_id, snapshot_date)
);

-- Enable Row Level Security
ALTER TABLE public.daily_balance_snapshots ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own balance snapshots" 
ON public.daily_balance_snapshots 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own balance snapshots" 
ON public.daily_balance_snapshots 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own balance snapshots" 
ON public.daily_balance_snapshots 
FOR UPDATE 
USING (auth.uid() = user_id);