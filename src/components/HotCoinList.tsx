import { useEffect, useState, useCallback } from 'react';
import { fetchAll24hTickers, SymbolInfo, formatPrice, formatVolume } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { Flame, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';

interface HotCoinListProps {
  onSelectSymbol: (symbol: string) => void;
  selectedSymbol: string;
}

const HotCoinList = ({ onSelectSymbol, selectedSymbol }: HotCoinListProps) => {
  const [coins, setCoins] = useState<SymbolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadCoins = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    
    try {
      const tickers = await fetchAll24hTickers();
      
      // Calculate "hotness" score based on volume and price change
      const withScore = tickers.map(t => ({
        ...t,
        hotScore: (Math.abs(t.priceChangePercent) * 0.6) + (Math.log10(t.volume + 1) * 0.4)
      }));
      
      // Sort by hot score and take top 10
      const hotCoins = withScore
        .sort((a, b) => b.hotScore - a.hotScore)
        .slice(0, 10);

      setCoins(hotCoins);
    } catch (error) {
      console.error('Failed to load hot coins:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadCoins();
    const interval = setInterval(() => loadCoins(), 30000);
    return () => clearInterval(interval);
  }, [loadCoins]);

  if (loading) {
    return (
      <div className="bg-card rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Flame className="w-5 h-5 text-orange-500" />
          <h3 className="text-sm font-semibold">선물 HOT</h3>
        </div>
        <div className="p-2 space-y-1">
          {Array(10).fill(0).map((_, i) => (
            <div key={i} className="h-14 shimmer rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-orange-500" />
          <div>
            <h3 className="text-sm font-semibold">선물 HOT</h3>
            <p className="text-xs text-muted-foreground">인기 코인 TOP 10</p>
          </div>
        </div>
        <button
          onClick={() => loadCoins(true)}
          disabled={refreshing}
          className="p-2 hover:bg-secondary rounded-md transition-colors"
        >
          <RefreshCw className={cn("w-4 h-4 text-muted-foreground", refreshing && "animate-spin")} />
        </button>
      </div>

      {/* Coin List */}
      <div className="divide-y divide-border/50">
        {coins.map((coin, index) => {
          const isSelected = coin.symbol === selectedSymbol;
          const isPositive = coin.priceChangePercent >= 0;
          
          return (
            <button
              key={coin.symbol}
              onClick={() => onSelectSymbol(coin.symbol)}
              className={cn(
                "w-full px-3 py-2.5 text-left transition-all hover:bg-secondary/50 flex items-center gap-3",
                isSelected && "bg-primary/10 border-l-2 border-l-primary"
              )}
            >
              {/* Rank */}
              <div className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                index < 3 ? "bg-orange-500/20 text-orange-500" : "bg-secondary text-muted-foreground"
              )}>
                {index + 1}
              </div>

              {/* Symbol & Volume */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm truncate">
                    {coin.symbol.replace('USDT', '')}
                  </span>
                  <span className="text-xs text-muted-foreground">/USDT</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  ${formatVolume(coin.volume)}
                </p>
              </div>

              {/* Price & Change */}
              <div className="text-right">
                <p className="font-mono text-sm font-medium">
                  ${formatPrice(coin.price)}
                </p>
                <div className={cn(
                  "flex items-center justify-end gap-0.5 text-xs font-medium",
                  isPositive ? "text-positive" : "text-negative"
                )}>
                  {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  <span>{isPositive ? '+' : ''}{coin.priceChangePercent.toFixed(2)}%</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default HotCoinList;
