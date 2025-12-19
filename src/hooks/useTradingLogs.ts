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

export const useTradingLogs = () => {
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
        .eq('trade_date', today);

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
    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    console.log(`📤 [DB 전송 시작] ${timestamp} | ${trade.symbol} ${trade.side} | 진입: $${trade.entryPrice.toFixed(4)} → 청산: $${trade.exitPrice.toFixed(4)} | 수량: ${trade.quantity} | 레버리지: ${trade.leverage}x | PnL: $${trade.pnlUsd.toFixed(6)}`);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('❌ [DB 전송 실패] 사용자 인증 없음');
        return;
      }

      const today = getTodayDate();
      
      const insertData = {
        user_id: user.id,
        trade_date: today,
        symbol: trade.symbol,
        side: trade.side,
        entry_price: trade.entryPrice,
        exit_price: trade.exitPrice,
        quantity: trade.quantity,
        leverage: trade.leverage,
        pnl_usd: trade.pnlUsd,
      };
      
      console.log(`📋 [DB 전송 데이터]`, JSON.stringify(insertData));

      const { data, error } = await supabase
        .from('daily_trading_logs')
        .insert(insertData)
        .select();

      if (error) {
        console.error(`❌ [DB 전송 실패] ${timestamp} | ${trade.symbol}`, error);
        return;
      }

      console.log(`✅ [DB 저장 완료] ${timestamp} | ${trade.symbol} ${trade.side} | PnL: $${trade.pnlUsd.toFixed(6)} | ID: ${data?.[0]?.id || 'unknown'}`);

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
      console.error(`❌ [DB 전송 에러] ${timestamp} | ${trade.symbol}`, error);
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

  // Fetch stats on mount
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
