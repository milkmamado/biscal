import { useMemo } from 'react';
import { useTickerWebSocket } from '@/hooks/useTickerWebSocket';
import { formatPrice, formatVolume } from '@/lib/binance';
import { cn } from '@/lib/utils';

interface CoinHeaderProps {
  symbol: string;
}

const CoinHeader = ({ symbol }: CoinHeaderProps) => {
  const { tickers } = useTickerWebSocket();
  
  const ticker = useMemo(() => {
    return tickers.find(t => t.symbol === symbol);
  }, [tickers, symbol]);

  if (!ticker) {
    return (
      <div className="bg-card rounded border border-border px-3 py-1.5 flex items-center">
        <h2 className="text-sm font-bold">
          {symbol.replace('USDT', '')}
          <span className="text-muted-foreground font-normal text-xs">/USDT</span>
        </h2>
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
          "text-lg font-bold font-mono",
          isPositive ? "text-positive" : "text-negative"
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
