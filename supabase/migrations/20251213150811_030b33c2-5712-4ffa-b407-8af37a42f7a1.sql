-- Block UPDATE on daily_trading_logs (거래 기록 수정 방지)
CREATE POLICY "Users cannot update trading logs"
ON public.daily_trading_logs
FOR UPDATE
USING (false)
WITH CHECK (false);

-- Block DELETE on daily_balance_snapshots (잔고 스냅샷 삭제 방지)
CREATE POLICY "Users cannot delete balance snapshots"
ON public.daily_balance_snapshots
FOR DELETE
USING (false);