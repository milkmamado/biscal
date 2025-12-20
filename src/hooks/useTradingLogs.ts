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
  is_testnet: boolean;
}

interface DailyStats {
  totalPnL: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
}

interface UseTradingLogsOptions {
  isTestnet?: boolean;
}

export const useTradingLogs = (options: UseTradingLogsOptions = {}) => {
  const { isTestnet = false } = options;
  
  const [dailyStats, setDailyStats] = useState<DailyStats>({
    totalPnL: 0,
    tradeCount: 0,
    winCount: 0,
    lossCount: 0,
    winRate: 0,
  });
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
      if (!user) return;

      const today = getTodayDate();
      
      const { data, error } = await supabase
        .from('daily_trading_logs')
        .select('*')
        .eq('user_id', user.id)
        .eq('trade_date', today)
        .eq('is_testnet', isTestnet); // 테스트넷/실거래 구분

      if (error) {
        console.error('Failed to fetch trading logs:', error);
        return;
      }

      if (data && data.length > 0) {
        const totalPnL = data.reduce((sum, log) => sum + Number(log.pnl_usd), 0);
        const winCount = data.filter(log => Number(log.pnl_usd) > 0).length;
        const lossCount = data.filter(log => Number(log.pnl_usd) < 0).length;
        const tradeCount = data.length;
        const winRate = tradeCount > 0 ? (winCount / tradeCount) * 100 : 0;

        setDailyStats({
          totalPnL,
          tradeCount,
          winCount,
          lossCount,
          winRate,
        });
      } else {
        setDailyStats({
          totalPnL: 0,
          tradeCount: 0,
          winCount: 0,
          lossCount: 0,
          winRate: 0,
        });
      }
    } catch (error) {
      console.error('Error fetching daily stats:', error);
    } finally {
      setLoading(false);
    }
  }, [isTestnet]);

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
          is_testnet: isTestnet, // 테스트넷/실거래 구분
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
  }, [isTestnet]);

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

  // Fetch stats on mount and when isTestnet changes
  useEffect(() => {
    fetchDailyStats();
  }, [fetchDailyStats]);

  return {
    dailyStats,
    loading,
    logTrade,
    fetchDailyStats,
    resetDailyStats,
  };
};
