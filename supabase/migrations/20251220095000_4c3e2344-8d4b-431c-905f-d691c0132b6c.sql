-- daily_balance_snapshots 테이블에 is_testnet 컬럼 추가
ALTER TABLE public.daily_balance_snapshots 
ADD COLUMN is_testnet boolean NOT NULL DEFAULT false;

-- daily_trading_logs 테이블에 is_testnet 컬럼 추가
ALTER TABLE public.daily_trading_logs 
ADD COLUMN is_testnet boolean NOT NULL DEFAULT false;

-- 기존 유니크 제약조건 삭제 (user_id + snapshot_date)
ALTER TABLE public.daily_balance_snapshots 
DROP CONSTRAINT IF EXISTS daily_balance_snapshots_user_id_snapshot_date_key;

-- 새로운 유니크 제약조건 추가 (user_id + snapshot_date + is_testnet)
ALTER TABLE public.daily_balance_snapshots 
ADD CONSTRAINT daily_balance_snapshots_user_id_date_testnet_key 
UNIQUE (user_id, snapshot_date, is_testnet);