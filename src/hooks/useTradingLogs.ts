import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface TradingLog {
  id: string;
  user_id: string;
  trade_date: string;
  symbol: string;
  side: 'long' | 'short';
  entry_price: number;
  exit_price: number;
  quantity: number;
  leverage: number;
  pnl_usd: number;
  created_at: string;
}

interface DailyStats {
  totalPnL: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
}

// DB 로그를 TradingLogsPanel 형식으로 변환하기 위한 인터페이스
export interface DbTradeLog {
  id: string;
  timestamp: number;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnlUsd: number;
}

export const useTradingLogs = () => {
  const [dailyStats, setDailyStats] = useState<DailyStats>({
    totalPnL: 0,
    tradeCount: 0,
    winCount: 0,
    lossCount: 0,
    winRate: 0,
  });
  const [dbTradeLogs, setDbTradeLogs] = useState<DbTradeLog[]>([]);
  const [loading, setLoading] = useState(false);

  // Get today's date in YYYY-MM-DD format (Korean timezone KST, UTC+9)
  const getTodayDate = () => {
    const now = new Date();
    const koreaOffset = 9 * 60; // UTC+9
    const utcOffset = now.getTimezoneOffset();
    const koreaTime = new Date(now.getTime() + (koreaOffset + utcOffset) * 60 * 1000);
    const year = koreaTime.getFullYear();
    const month = String(koreaTime.getMonth() + 1).padStart(2, '0');
    const day = String(koreaTime.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Fetch today's trading logs
  const fetchDailyStats = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('[TradingLogs] No user, skipping fetch');
        setLoading(false);
        return;
      }

      const today = getTodayDate();
      console.log(`[TradingLogs] Fetching logs for ${today}`);
      
      const { data, error } = await supabase
        .from('daily_trading_logs')
        .select('*')
        .eq('user_id', user.id)
        .eq('trade_date', today)
        .eq('is_testnet', false);

      if (error) {
        console.error('Failed to fetch trading logs:', error);
        return;
      }

      console.log(`[TradingLogs] Fetched ${data?.length || 0} logs`);

      if (data && data.length > 0) {
        // ✅ DB에 저장된 pnl_usd는 이미 수수료 포함 '최종 손익'
        const totalPnL = data.reduce((sum, log: any) => sum + Number(log.pnl_usd), 0);
        const winCount = data.filter((log: any) => Number(log.pnl_usd) > 0).length;
        const lossCount = data.filter((log: any) => Number(log.pnl_usd) < 0).length;
        const tradeCount = data.length;
        const winRate = tradeCount > 0 ? (winCount / tradeCount) * 100 : 0;

        console.log(`[TradingLogs] Stats(db): ${tradeCount}trades, PnL: $${totalPnL.toFixed(2)}`);

        setDailyStats({
          totalPnL,
          tradeCount,
          winCount,
          lossCount,
          winRate,
        });

        // DB 로그를 UI용 형식으로 변환 (최신순 정렬)
        const convertedLogs: DbTradeLog[] = data
          .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .map((log: any) => ({
            id: log.id,
            timestamp: new Date(log.created_at).getTime(),
            symbol: log.symbol,
            side: log.side as 'long' | 'short',
            entryPrice: Number(log.entry_price),
            exitPrice: Number(log.exit_price),
            quantity: Number(log.quantity),
            pnlUsd: Number(log.pnl_usd),
          }));
        setDbTradeLogs(convertedLogs);
      } else {
        setDailyStats({
          totalPnL: 0,
          tradeCount: 0,
          winCount: 0,
          lossCount: 0,
          winRate: 0,
        });
        setDbTradeLogs([]);
      }
    } catch (error) {
      console.error('Error fetching daily stats:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Log a completed trade
  const logTrade = useCallback(async (trade: {
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    leverage: number;
    pnlUsd: number;
  }) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const today = getTodayDate();

      const { error } = await supabase
        .from('daily_trading_logs')
        .insert({
          user_id: user.id,
          trade_date: today,
          symbol: trade.symbol,
          side: trade.side,
          entry_price: trade.entryPrice,
          exit_price: trade.exitPrice,
          quantity: trade.quantity,
          leverage: trade.leverage,
          pnl_usd: trade.pnlUsd,
          is_testnet: false,
        });

      if (error) {
        console.error('Failed to log trade:', error);
        return;
      }

      // Update local stats immediately
      setDailyStats(prev => {
        const newTradeCount = prev.tradeCount + 1;
        const newWinCount = trade.pnlUsd > 0 ? prev.winCount + 1 : prev.winCount;
        const newLossCount = trade.pnlUsd < 0 ? prev.lossCount + 1 : prev.lossCount;
        return {
          totalPnL: prev.totalPnL + trade.pnlUsd,
          tradeCount: newTradeCount,
          winCount: newWinCount,
          lossCount: newLossCount,
          winRate: newTradeCount > 0 ? (newWinCount / newTradeCount) * 100 : 0,
        };
      });
    } catch (error) {
      console.error('Error logging trade:', error);
    }
  }, []);

  // Reset daily stats (for new day)
  const resetDailyStats = useCallback(() => {
    setDailyStats({
      totalPnL: 0,
      tradeCount: 0,
      winCount: 0,
      lossCount: 0,
      winRate: 0,
    });
  }, []);

  // Fetch stats on mount and when auth state changes
  useEffect(() => {
    // Initial fetch
    fetchDailyStats();
    
    // Listen for auth state changes to refetch when user logs in
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        console.log('[TradingLogs] Auth state changed, refetching...');
        fetchDailyStats();
      }
    });
    
    return () => {
      subscription.unsubscribe();
    };
  }, [fetchDailyStats]);

  return {
    dailyStats,
    dbTradeLogs,
    loading,
    logTrade,
    fetchDailyStats,
    resetDailyStats,
  };
};
