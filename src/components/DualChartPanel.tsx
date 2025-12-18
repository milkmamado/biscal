import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useBinanceApi, BinancePosition } from '@/hooks/useBinanceApi';
import { useAuth } from '@/hooks/useAuth';
import { RefreshCw } from 'lucide-react';
import TickChart from './TickChart';
import TradingRecordModal from './TradingRecordModal';
import { supabase } from '@/integrations/supabase/client';

interface DualChartPanelProps {
  symbol: string;
  tradeCount?: number;
  winCount?: number;
  hasPosition?: boolean;
  entryPrice?: number;
  onSelectSymbol?: (symbol: string) => void;
  onBalanceChange?: (balance: number) => void;
}

const INTERVALS = [
  { label: '1분', value: 60 },
  { label: '3분', value: 180 },
  { label: '5분', value: 300 },
  { label: '15분', value: 900 },
  { label: '30분', value: 1800 },
  { label: '1H', value: 3600 },
  { label: '4H', value: 14400 },
  { label: '일', value: 86400 },
];

const DualChartPanel = ({ 
  symbol, 
  tradeCount = 0,
  winCount = 0,
  hasPosition = false,
  entryPrice,
  onSelectSymbol,
  onBalanceChange,
}: DualChartPanelProps) => {
  const [interval, setInterval] = useState(60);
  const [balanceUSD, setBalanceUSD] = useState<number>(0);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [krwRate, setKrwRate] = useState(1380);
  const [positions, setPositions] = useState<BinancePosition[]>([]);
  const [previousDayBalance, setPreviousDayBalance] = useState<number | null>(null);
  const [todayRealizedPnL, setTodayRealizedPnL] = useState<number>(0);
  const [todayDeposits, setTodayDeposits] = useState<number>(0);
  const prevSymbolRef = useRef<string>(symbol);
  const { user } = useAuth();
  const { getBalances, getPositions, getIncomeHistory } = useBinanceApi();

  // 심볼 변경 시 차트 분봉 자동 전환 (3분 → 1분)
  useEffect(() => {
    if (prevSymbolRef.current !== symbol) {
      prevSymbolRef.current = symbol;
      setInterval(180);
      const timer = setTimeout(() => setInterval(60), 200);
      return () => clearTimeout(timer);
    }
  }, [symbol]);

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
        const totalBalance = parseFloat(usdtBalance.balance) || parseFloat(usdtBalance.crossWalletBalance) || 0;
        setBalanceUSD(totalBalance);
        onBalanceChange?.(totalBalance);
        fetchTodayRealizedPnL(totalBalance);
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
    const koreaOffset = 9 * 60;
    const utcOffset = now.getTimezoneOffset();
    const koreaTime = new Date(now.getTime() + (koreaOffset + utcOffset) * 60 * 1000);
    koreaTime.setHours(0, 0, 0, 0);
    return koreaTime.getTime() - (koreaOffset + utcOffset) * 60 * 1000;
  };

  // Get today's date in YYYY-MM-DD format (Korean timezone)
  const getTodayDate = () => {
    const now = new Date();
    const koreaOffset = 9 * 60;
    const utcOffset = now.getTimezoneOffset();
    const koreaTime = new Date(now.getTime() + (koreaOffset + utcOffset) * 60 * 1000);
    return `${koreaTime.getFullYear()}-${String(koreaTime.getMonth() + 1).padStart(2, '0')}-${String(koreaTime.getDate()).padStart(2, '0')}`;
  };

  // Fetch today's realized PnL from Binance Income History
  const fetchTodayRealizedPnL = async (currentBalance: number) => {
    try {
      const todayMidnight = getTodayMidnightKST();
      const now = Date.now();
      
      const incomeHistory = await getIncomeHistory(todayMidnight, now);
      
      if (!incomeHistory || !Array.isArray(incomeHistory)) return;
      
      // 입출금 (TRANSFER)
      const transferItems = incomeHistory.filter((item: any) => item.incomeType === 'TRANSFER');
      const deposits = transferItems
        .filter((item: any) => parseFloat(item.income || 0) > 0)
        .reduce((sum: number, item: any) => sum + parseFloat(item.income || 0), 0);
      const withdrawals = transferItems
        .filter((item: any) => parseFloat(item.income || 0) < 0)
        .reduce((sum: number, item: any) => sum + Math.abs(parseFloat(item.income || 0)), 0);
      
      // 바이낸스 Income History에서 오늘 실현손익 직접 가져오기
      const tradingIncomeTypes = ['REALIZED_PNL', 'COMMISSION', 'FUNDING_FEE'];
      const realizedFromBinance = incomeHistory
        .filter((item: any) => tradingIncomeTypes.includes(item.incomeType))
        .reduce((sum: number, item: any) => sum + parseFloat(item.income || 0), 0);
      
      setTodayDeposits(deposits);
      setTodayRealizedPnL(realizedFromBinance);
      
      // 시작잔고 = 현재잔고 - 실현손익 - 입금 + 출금
      const startBalance = currentBalance - realizedFromBinance - deposits + withdrawals;
      setPreviousDayBalance(startBalance);

      // 스냅샷 테이블 업데이트
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      await supabase
        .from('daily_balance_snapshots')
        .upsert({
          user_id: user.id,
          snapshot_date: getTodayDate(),
          closing_balance_usd: currentBalance,
          daily_income_usd: realizedFromBinance,
          deposit_usd: deposits,
          withdrawal_usd: withdrawals,
        }, {
          onConflict: 'user_id,snapshot_date'
        });
    } catch (error) {
      console.error('Failed to fetch realized PnL:', error);
    }
  };

  // Fetch balance and positions on mount and every 10 seconds
  useEffect(() => {
    if (!user) return;
    
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
  
  // Calculate daily P&L
  const dailyPnL = todayRealizedPnL;
  
  // Effective starting balance
  const effectiveStartingBalance = (previousDayBalance !== null ? Math.max(0, previousDayBalance) : 0) + todayDeposits;
  const baseBalance = effectiveStartingBalance > 0 ? effectiveStartingBalance : balanceUSD;
  const dailyPnLPercent = baseBalance > 0 ? (dailyPnL / baseBalance) * 100 : 0;
  const dailyPnLPercentStr = dailyPnLPercent.toFixed(2);

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
          
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-muted-foreground">실현손익</span>
            <span className={cn(
              "text-sm font-bold font-mono",
              todayRealizedPnL >= 0 ? "text-red-400" : "text-blue-400"
            )}>
              {todayRealizedPnL >= 0 ? '+' : ''}₩{formatKRW(todayRealizedPnL)}
            </span>
          </div>
          
          {/* Daily Profit Rate */}
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-muted-foreground">수익률</span>
            <span className={cn(
              "text-sm font-bold font-mono",
              dailyPnLPercent >= 5 ? "text-green-400" : 
              dailyPnLPercent >= 2.5 ? "text-yellow-400" : 
              dailyPnLPercent >= 0 ? "text-orange-400" : "text-blue-400"
            )}>
              {dailyPnL >= 0 ? '+' : ''}{dailyPnLPercentStr}%
            </span>
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
          <TickChart 
            symbol={symbol}
            height={450} 
            interval={interval}
            entryPrice={hasPosition ? entryPrice : undefined}
          />
        </div>
      </div>
    </div>
  );
};

export default DualChartPanel;
