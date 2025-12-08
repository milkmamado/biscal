import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useBinanceApi, BinancePosition } from '@/hooks/useBinanceApi';
import { useAuth } from '@/hooks/useAuth';
import { RefreshCw } from 'lucide-react';
import TickChart from './TickChart';
import TradingRecordModal from './TradingRecordModal';
import { supabase } from '@/integrations/supabase/client';

interface OpenOrder {
  orderId: number;
  price: number;
  side: 'BUY' | 'SELL';
  origQty: number;
}

interface DualChartPanelProps {
  symbol: string;
  unrealizedPnL?: number;
  realizedPnL?: number;
  tradeCount?: number;
  winCount?: number;
  hasPosition?: boolean;
  entryPrice?: number;
  openOrders?: OpenOrder[];
  onSelectSymbol?: (symbol: string) => void;
}

const INTERVALS = [
  { label: '1분', value: '1' },
  { label: '3분', value: '3' },
  { label: '5분', value: '5' },
  { label: '15분', value: '15' },
  { label: '30분', value: '30' },
  { label: '1H', value: '60' },
  { label: '4H', value: '240' },
  { label: '일', value: 'D' },
];

const DualChartPanel = ({ 
  symbol, 
  unrealizedPnL = 0, 
  realizedPnL = 0,
  tradeCount = 0,
  winCount = 0,
  hasPosition = false,
  entryPrice,
  openOrders = [],
  onSelectSymbol
}: DualChartPanelProps) => {
  const [interval, setInterval] = useState('1');
  const [balanceUSD, setBalanceUSD] = useState<number>(0);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [krwRate, setKrwRate] = useState(1380);
  const [positions, setPositions] = useState<BinancePosition[]>([]);
  const [previousDayBalance, setPreviousDayBalance] = useState<number | null>(null);
  const { user } = useAuth();
  const { getBalances, getPositions, getIncomeHistory } = useBinanceApi();


  // Fetch positions
  const fetchPositions = async () => {
    try {
      const allPositions = await getPositions();
      const activePositions = allPositions.filter((p: BinancePosition) => 
        parseFloat(String(p.positionAmt)) !== 0
      );
      setPositions(activePositions);
    } catch (error) {
      console.error('Failed to fetch positions:', error);
    }
  };

  // Fetch real balance from Binance
  const fetchRealBalance = async () => {
    setBalanceLoading(true);
    try {
      const balances = await getBalances();
      const usdtBalance = balances?.find((b: any) => b.asset === 'USDT');
      if (usdtBalance) {
        const available = parseFloat(usdtBalance.availableBalance) || 0;
        setBalanceUSD(available);
        // Calculate previous day balance using income history
        if (previousDayBalance === null) {
          calculatePreviousDayBalance(available);
        }
      }
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    } finally {
      setBalanceLoading(false);
    }
  };

  // Fetch USD/KRW rate
  useEffect(() => {
    const fetchRate = async () => {
      try {
        const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=KRW');
        const data = await res.json();
        if (data.rates?.KRW) {
          setKrwRate(Math.round(data.rates.KRW));
        }
      } catch (error) {
        console.error('Failed to fetch exchange rate:', error);
      }
    };
    fetchRate();
  }, []);

  // Get today's midnight timestamp in Korean timezone
  const getTodayMidnightKST = () => {
    const now = new Date();
    const koreaOffset = 9 * 60; // UTC+9
    const utcOffset = now.getTimezoneOffset();
    const koreaTime = new Date(now.getTime() + (koreaOffset + utcOffset) * 60 * 1000);
    // Set to midnight
    koreaTime.setHours(0, 0, 0, 0);
    // Convert back to UTC timestamp
    return koreaTime.getTime() - (koreaOffset + utcOffset) * 60 * 1000;
  };

  // Get today's date in YYYY-MM-DD format (Korean timezone)
  const getTodayDate = () => {
    const now = new Date();
    const koreaOffset = 9 * 60;
    const utcOffset = now.getTimezoneOffset();
    const koreaTime = new Date(now.getTime() + (koreaOffset + utcOffset) * 60 * 1000);
    return koreaTime.toISOString().split('T')[0];
  };

  // Calculate previous day's closing balance using income history
  const calculatePreviousDayBalance = async (currentBalance: number) => {
    try {
      const todayMidnight = getTodayMidnightKST();
      const now = Date.now();
      
      console.log(`Fetching income history from ${new Date(todayMidnight).toISOString()} to ${new Date(now).toISOString()}`);
      
      // Get all income since today's midnight
      const incomeHistory = await getIncomeHistory(todayMidnight, now);
      
      if (!incomeHistory || !Array.isArray(incomeHistory)) {
        console.log('No income history returned');
        return;
      }
      
      // Sum all income (realized PnL, funding fees, commissions, etc.)
      const totalIncomeSinceMidnight = incomeHistory.reduce((sum: number, item: any) => {
        return sum + parseFloat(item.income || 0);
      }, 0);
      
      console.log(`Income since midnight: $${totalIncomeSinceMidnight.toFixed(4)} (${incomeHistory.length} transactions)`);
      
      // Previous day balance = current balance - all income since midnight
      const calculatedPrevBalance = currentBalance - totalIncomeSinceMidnight;
      console.log(`Calculated previous day balance: $${calculatedPrevBalance.toFixed(4)}`);
      
      setPreviousDayBalance(calculatedPrevBalance);
      
      // Save today's current balance for future reference
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const today = getTodayDate();
        await supabase
          .from('daily_balance_snapshots')
          .upsert({
            user_id: user.id,
            snapshot_date: today,
            closing_balance_usd: currentBalance,
          }, {
            onConflict: 'user_id,snapshot_date'
          });
      }
    } catch (error) {
      console.error('Failed to calculate previous day balance:', error);
    }
  };

  // Fetch balance and positions on mount and every 10 seconds (only if logged in)
  useEffect(() => {
    if (!user) return; // Skip API calls if not logged in
    
    fetchRealBalance();
    fetchPositions();
    const intervalId = window.setInterval(() => {
      fetchRealBalance();
      fetchPositions();
    }, 10000);
    return () => window.clearInterval(intervalId);
  }, [user]);

  const formatKRW = (usd: number) => {
    const krw = usd * krwRate;
    return krw.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };

  const winRate = tradeCount > 0 ? ((winCount / tradeCount) * 100).toFixed(1) : '0.0';
  
  // Calculate daily P&L based on previous day's balance (real P&L)
  const dailyPnL = previousDayBalance !== null 
    ? balanceUSD - previousDayBalance + unrealizedPnL
    : realizedPnL + unrealizedPnL; // Fallback to old method if no previous balance
  const baseBalance = previousDayBalance !== null ? previousDayBalance : balanceUSD;
  const dailyPnLPercent = baseBalance > 0 ? (dailyPnL / baseBalance) * 100 : 0;
  const dailyPnLPercentStr = dailyPnLPercent.toFixed(2);
  
  // Daily target achievement (3% target)
  const DAILY_TARGET_PERCENT = 3;
  const achievementRate = DAILY_TARGET_PERCENT > 0 ? (dailyPnLPercent / DAILY_TARGET_PERCENT) * 100 : 0;
  const achievementRateStr = achievementRate.toFixed(0);

  return (
    <div className="flex flex-col gap-1 h-full">
      {/* Balance Panel - Top */}
      <div className="bg-card border border-border rounded px-3 py-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">잔고</span>
              <button
                onClick={fetchRealBalance}
                className="p-0.5 hover:bg-secondary rounded"
                title="잔고 새로고침"
              >
                <RefreshCw className={cn("w-2.5 h-2.5 text-muted-foreground", balanceLoading && "animate-spin")} />
              </button>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-sm font-bold font-mono text-foreground">
                {balanceLoading ? '...' : `$${balanceUSD.toFixed(2)}`}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                (₩{formatKRW(balanceUSD)})
              </span>
            </div>
          </div>
          
          {hasPosition && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-muted-foreground">미실현</span>
              <span className={cn(
                "text-sm font-bold font-mono",
                unrealizedPnL >= 0 ? "text-red-400" : "text-blue-400"
              )}>
                {unrealizedPnL >= 0 ? '+' : ''}₩{formatKRW(unrealizedPnL)}
              </span>
            </div>
          )}
          
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-muted-foreground">실현손익</span>
            <span className={cn(
              "text-sm font-bold font-mono",
              realizedPnL >= 0 ? "text-red-400" : "text-blue-400"
            )}>
              {realizedPnL >= 0 ? '+' : ''}₩{formatKRW(realizedPnL)}
            </span>
          </div>
          
          {/* Daily Achievement Rate (3% target) */}
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-muted-foreground">달성률</span>
            <div className="flex items-baseline gap-0.5">
              <span className={cn(
                "text-sm font-bold font-mono",
                achievementRate >= 100 ? "text-green-400" : 
                achievementRate >= 50 ? "text-yellow-400" : 
                achievementRate >= 0 ? "text-orange-400" : "text-blue-400"
              )}>
                {achievementRateStr}%
              </span>
              <span className="text-[8px] text-muted-foreground">/3%</span>
            </div>
          </div>
          
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">당일 총손익</span>
              {previousDayBalance !== null && (
                <span className="text-[8px] text-muted-foreground/70">(전일대비)</span>
              )}
            </div>
            <div className="flex items-baseline gap-1">
              <span className={cn(
                "text-sm font-bold font-mono",
                dailyPnL >= 0 ? "text-red-400" : "text-blue-400"
              )}>
                {dailyPnL >= 0 ? '+' : ''}₩{formatKRW(dailyPnL)}
              </span>
              <span className={cn(
                "text-[10px] font-bold font-mono",
                dailyPnL >= 0 ? "text-red-400" : "text-blue-400"
              )}>
                ({dailyPnL >= 0 ? '+' : ''}{dailyPnLPercentStr}%)
              </span>
            </div>
          </div>
        </div>
        
        <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-[10px]">
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground">
              거래: <span className="text-foreground font-mono">{tradeCount}회</span>
            </span>
            <span className="text-muted-foreground">
              승: <span className="text-red-400 font-mono">{winCount}</span>
            </span>
            <span className="text-muted-foreground">
              패: <span className="text-blue-400 font-mono">{tradeCount - winCount}</span>
            </span>
          </div>
          <span className={cn(
            "font-bold",
            tradeCount === 0 ? "text-muted-foreground" : parseFloat(winRate) >= 50 ? "text-red-400" : "text-blue-400"
          )}>
            승률 {winRate}%
          </span>
          <TradingRecordModal krwRate={krwRate} />
        </div>
        
        {/* Active Positions */}
        {positions.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-muted-foreground mr-1">보유:</span>
              {positions.map((pos) => {
                const pnl = parseFloat(String(pos.unRealizedProfit)) || 0;
                const isLong = parseFloat(String(pos.positionAmt)) > 0;
                const displaySymbol = pos.symbol.replace('USDT', '');
                return (
                  <button
                    key={pos.symbol}
                    onClick={() => onSelectSymbol?.(pos.symbol)}
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors border",
                      pos.symbol === symbol 
                        ? "bg-primary/20 border-primary" 
                        : "bg-secondary/50 border-border hover:bg-secondary",
                      isLong ? "text-red-400" : "text-blue-400"
                    )}
                  >
                    {displaySymbol}
                    <span className={cn(
                      "ml-1",
                      pnl >= 0 ? "text-red-400" : "text-blue-400"
                    )}>
                      {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Chart Area */}
      <div className="bg-card border border-border rounded overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="px-2 py-1 bg-secondary/50 border-b border-border flex items-center gap-0.5 flex-wrap shrink-0">
          {INTERVALS.map((int) => (
            <button
              key={int.value}
              onClick={() => setInterval(int.value)}
              className={cn(
                "px-1.5 py-0.5 text-[10px] rounded transition-colors",
                interval === int.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary hover:bg-secondary/80"
              )}
            >
              {int.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 relative" style={{ minHeight: '400px' }}>
          <TickChart symbol={symbol} height={450} />
        </div>
      </div>
    </div>
  );
};

export default DualChartPanel;
