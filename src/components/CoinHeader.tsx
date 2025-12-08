import { useEffect, useState } from 'react';
import { fetch24hTicker, SymbolInfo, formatPrice, formatVolume } from '@/lib/binance';
import { cn } from '@/lib/utils';

interface CoinHeaderProps {
  symbol: string;
}

const CoinHeader = ({ symbol }: CoinHeaderProps) => {
  const [ticker, setTicker] = useState<SymbolInfo | null>(null);
  const [prevPrice, setPrevPrice] = useState<number>(0);
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    let mounted = true;
    
    const loadTicker = async () => {
      try {
        const data = await fetch24hTicker(symbol);
        if (!mounted) return;
        
        if (ticker && data.price !== ticker.price) {
          setPriceDirection(data.price > ticker.price ? 'up' : 'down');
          setPrevPrice(ticker.price);
          setTimeout(() => setPriceDirection(null), 500);
        }
        
        setTicker(data);
      } catch (error) {
        // Silently fail - will use cached data
      }
    };

    loadTicker();
    // 60초마다만 갱신 (429 에러 방지)
    const interval = setInterval(loadTicker, 60000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [symbol]);

  if (!ticker) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="h-12 shimmer rounded" />
      </div>
    );
  }

  const isPositive = ticker.priceChangePercent >= 0;

  return (
    <div className="bg-card rounded border border-border px-3 py-1.5 flex items-center justify-between">
      {/* Symbol & Price */}
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-bold">
          {symbol.replace('USDT', '')}
          <span className="text-muted-foreground font-normal text-xs">/USDT</span>
        </h2>
        
        <span className={cn(
          "text-lg font-bold font-mono transition-colors",
          priceDirection === 'up' && "text-positive price-pulse",
          priceDirection === 'down' && "text-negative price-pulse",
          !priceDirection && (isPositive ? "text-positive" : "text-negative")
        )}>
          ${formatPrice(ticker.price)}
        </span>
        
        <span className={cn(
          "text-xs font-mono font-medium",
          isPositive ? "text-positive" : "text-negative"
        )}>
          {isPositive ? '+' : ''}{ticker.priceChangePercent.toFixed(2)}%
        </span>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-1 text-xs">
        <span className="text-muted-foreground">거래량</span>
        <span className="font-mono">${formatVolume(ticker.volume)}</span>
      </div>
    </div>
  );
};

export default CoinHeader;
