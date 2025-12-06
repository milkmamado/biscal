import { useState, useEffect } from 'react';
import TradingViewChart from './TradingViewChart';
import { cn } from '@/lib/utils';
import { useBinanceApi } from '@/hooks/useBinanceApi';
import { RefreshCw } from 'lucide-react';

interface DualChartPanelProps {
  symbol: string;
  unrealizedPnL?: number;
  realizedPnL?: number;
  tradeCount?: number;
  winCount?: number;
  hasPosition?: boolean;
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
  hasPosition = false
}: DualChartPanelProps) => {
  const [interval, setInterval] = useState('1');
  const [balanceUSD, setBalanceUSD] = useState<number>(0);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [krwRate, setKrwRate] = useState(1380);
  const { getBalances } = useBinanceApi();

  // Fetch real balance from Binance
  const fetchRealBalance = async () => {
    setBalanceLoading(true);
    try {
      const balances = await getBalances();
      const usdtBalance = balances?.find((b: any) => b.asset === 'USDT');
      if (usdtBalance) {
        const available = parseFloat(usdtBalance.availableBalance) || 0;
        setBalanceUSD(available);
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

  // Fetch balance on mount and every 30 seconds
  useEffect(() => {
    fetchRealBalance();
    const intervalId = window.setInterval(fetchRealBalance, 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  const formatKRW = (usd: number) => {
    const krw = usd * krwRate;
    return krw.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };

  const winRate = tradeCount > 0 ? ((winCount / tradeCount) * 100).toFixed(1) : '0.0';
  const totalPnL = unrealizedPnL + realizedPnL;
  const totalPnLPercent = balanceUSD > 0 ? ((totalPnL / balanceUSD) * 100).toFixed(2) : '0.00';

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
                {unrealizedPnL >= 0 ? '+' : ''}{unrealizedPnL.toFixed(2)}$
              </span>
            </div>
          )}
          
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-muted-foreground">실현손익</span>
            <span className={cn(
              "text-sm font-bold font-mono",
              realizedPnL >= 0 ? "text-red-400" : "text-blue-400"
            )}>
              {realizedPnL >= 0 ? '+' : ''}{realizedPnL.toFixed(2)}$
            </span>
          </div>
          
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-muted-foreground">당일 총손익</span>
            <div className="flex items-baseline gap-1">
              <span className={cn(
                "text-sm font-bold font-mono",
                totalPnL >= 0 ? "text-red-400" : "text-blue-400"
              )}>
                {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}$
              </span>
              <span className={cn(
                "text-[10px] font-bold font-mono",
                totalPnL >= 0 ? "text-red-400" : "text-blue-400"
              )}>
                ({totalPnL >= 0 ? '+' : ''}{totalPnLPercent}%)
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
        </div>
      </div>

      {/* Single Chart - Full Height */}
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
        <div className="flex-1 min-h-0">
          <TradingViewChart symbol={symbol} interval={interval} height={700} />
        </div>
      </div>
    </div>
  );
};

export default DualChartPanel;
