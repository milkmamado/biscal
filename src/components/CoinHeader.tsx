import { useEffect, useState } from 'react';
import { fetch24hTicker, SymbolInfo, formatPrice, formatVolume } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { ArrowUp, ArrowDown, Activity } from 'lucide-react';

interface CoinHeaderProps {
  symbol: string;
}

const CoinHeader = ({ symbol }: CoinHeaderProps) => {
  const [ticker, setTicker] = useState<SymbolInfo | null>(null);
  const [prevPrice, setPrevPrice] = useState<number>(0);
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const loadTicker = async () => {
      try {
        const data = await fetch24hTicker(symbol);
        
        if (ticker && data.price !== ticker.price) {
          setPriceDirection(data.price > ticker.price ? 'up' : 'down');
          setPrevPrice(ticker.price);
          setTimeout(() => setPriceDirection(null), 500);
        }
        
        setTicker(data);
      } catch (error) {
        console.error('Failed to fetch ticker:', error);
      }
    };

    loadTicker();
    const interval = setInterval(loadTicker, 1000);
    return () => clearInterval(interval);
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
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        {/* Symbol & Price */}
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-xl font-bold">
              {symbol.replace('USDT', '')}
              <span className="text-muted-foreground font-normal text-base ml-1">/USDT</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">바이낸스 무기한 선물</p>
          </div>
          
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-3xl font-bold font-mono transition-colors",
              priceDirection === 'up' && "text-positive price-pulse",
              priceDirection === 'down' && "text-negative price-pulse",
              !priceDirection && (isPositive ? "text-positive" : "text-negative")
            )}>
              ${formatPrice(ticker.price)}
            </span>
            
            {priceDirection && (
              <span className={cn(
                "animate-fade-in",
                priceDirection === 'up' ? "text-positive" : "text-negative"
              )}>
                {priceDirection === 'up' ? <ArrowUp className="w-5 h-5" /> : <ArrowDown className="w-5 h-5" />}
              </span>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6">
          {/* 24h Change */}
          <div className="text-right">
            <p className="text-xs text-muted-foreground mb-1">24시간 변동</p>
            <div className={cn(
              "flex items-center gap-1 justify-end font-mono font-medium",
              isPositive ? "text-positive" : "text-negative"
            )}>
              {isPositive ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
              <span>{isPositive ? '+' : ''}{ticker.priceChangePercent.toFixed(2)}%</span>
            </div>
            <p className={cn(
              "text-xs font-mono",
              isPositive ? "text-positive" : "text-negative"
            )}>
              {isPositive ? '+' : ''}{formatPrice(ticker.priceChange)}
            </p>
          </div>

          {/* Volume */}
          <div className="text-right">
            <p className="text-xs text-muted-foreground mb-1">24시간 거래량</p>
            <div className="flex items-center gap-1 justify-end">
              <Activity className="w-4 h-4 text-primary" />
              <span className="font-mono font-medium">${formatVolume(ticker.volume)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoinHeader;
