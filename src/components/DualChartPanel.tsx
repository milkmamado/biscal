import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useBinanceApi, BinancePosition } from '@/hooks/useBinanceApi';
import { RefreshCw } from 'lucide-react';
import SimpleChart from './SimpleChart';
import { fetchKlines } from '@/lib/binance';

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
  tpPrice?: number | null;
  slPrice?: number | null;
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
  tpPrice,
  slPrice,
  onSelectSymbol
}: DualChartPanelProps) => {
  const [interval, setInterval] = useState('1');
  const [balanceUSD, setBalanceUSD] = useState<number>(0);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [krwRate, setKrwRate] = useState(1380);
  const [positions, setPositions] = useState<BinancePosition[]>([]);
  const [priceRange, setPriceRange] = useState<{ high: number; low: number }>({ high: 0, low: 0 });
  const { getBalances, getPositions } = useBinanceApi();

  // Fetch price range for chart overlay positioning
  const fetchPriceRange = async (currentInterval: string) => {
    try {
      // Map TradingView interval to Binance interval
      const intervalMap: Record<string, string> = {
        '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m',
        '60': '1h', '240': '4h', 'D': '1d'
      };
      const binanceInterval = intervalMap[currentInterval] || '1m';
      const klines = await fetchKlines(symbol, binanceInterval, 100);
      
      if (klines.length > 0) {
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        const high = Math.max(...highs);
        const low = Math.min(...lows);
        // Add 10% padding for better visibility
        const padding = (high - low) * 0.10;
        setPriceRange({ high: high + padding, low: low - padding });
      }
    } catch (error) {
      console.error('Failed to fetch price range:', error);
    }
  };

  // Fetch price range when symbol or interval changes
  useEffect(() => {
    // Reset price range immediately when interval changes
    setPriceRange({ high: 0, low: 0 });
    
    // Fetch new price range
    fetchPriceRange(interval);
    
    const intervalId = window.setInterval(() => {
      fetchPriceRange(interval);
    }, 5000);
    
    return () => window.clearInterval(intervalId);
  }, [symbol, interval]);

  // Calculate Y position for a price (0% = top, 100% = bottom)
  const getPriceYPosition = (price: number): string => {
    if (priceRange.high <= priceRange.low || !price) return '50%';
    const range = priceRange.high - priceRange.low;
    const percent = ((priceRange.high - price) / range) * 100;
    // Clamp between 5% and 95% to keep labels visible
    return `${Math.max(5, Math.min(95, percent))}%`;
  };

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

  // Fetch balance and positions on mount and every 10 seconds
  useEffect(() => {
    fetchRealBalance();
    fetchPositions();
    const intervalId = window.setInterval(() => {
      fetchRealBalance();
      fetchPositions();
    }, 10000);
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
          <SimpleChart symbol={symbol} interval={interval} height={500} />
          
          {/* Price Labels Overlay (no lines) */}
          {(openOrders.length > 0 || entryPrice || tpPrice || slPrice) && priceRange.high > priceRange.low && (
            <>
              {/* Take Profit Label */}
              {tpPrice && tpPrice > 0 && (
                <div 
                  className="absolute right-1 z-20 pointer-events-none"
                  style={{ top: getPriceYPosition(tpPrice) }}
                >
                  <div className="bg-emerald-600 text-white text-[9px] px-1.5 py-0.5 rounded font-bold shadow-lg -translate-y-1/2">
                    익절
                  </div>
                </div>
              )}
              
              {/* Entry Price Label */}
              {entryPrice && entryPrice > 0 && (
                <div 
                  className="absolute right-1 z-20 pointer-events-none"
                  style={{ top: getPriceYPosition(entryPrice) }}
                >
                  <div className="bg-yellow-600 text-white text-[9px] px-1.5 py-0.5 rounded font-bold shadow-lg -translate-y-1/2">
                    진입
                  </div>
                </div>
              )}
              
              {/* Stop Loss Label */}
              {slPrice && slPrice > 0 && (
                <div 
                  className="absolute right-1 z-20 pointer-events-none"
                  style={{ top: getPriceYPosition(slPrice) }}
                >
                  <div className="bg-red-600 text-white text-[9px] px-1.5 py-0.5 rounded font-bold shadow-lg -translate-y-1/2">
                    손절
                  </div>
                </div>
              )}
              
              {/* Pending Order Labels */}
              {openOrders.map((order) => (
                <div 
                  key={order.orderId}
                  className="absolute right-1 z-20 pointer-events-none"
                  style={{ top: getPriceYPosition(order.price) }}
                >
                  <div className={cn(
                    "text-white text-[9px] px-1.5 py-0.5 rounded font-bold shadow-lg -translate-y-1/2",
                    order.side === 'BUY' ? "bg-red-600" : "bg-blue-600"
                  )}>
                    {order.side === 'BUY' ? '롱' : '숏'}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DualChartPanel;
