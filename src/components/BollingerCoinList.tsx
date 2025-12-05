import { useEffect, useState, useCallback } from 'react';
import { 
  fetchAll24hTickers, 
  fetchKlines, 
  calculateBollingerBands, 
  SymbolInfo, 
  BollingerBands,
  formatPrice,
  formatVolume 
} from '@/lib/binance';
import { cn } from '@/lib/utils';
import { ArrowUp, ArrowDown, TrendingUp, RefreshCw, AlertTriangle } from 'lucide-react';

interface CoinWithBB extends SymbolInfo {
  bb: BollingerBands;
}

interface BollingerCoinListProps {
  onSelectSymbol: (symbol: string) => void;
  selectedSymbol: string;
}

const BollingerCoinList = ({ onSelectSymbol, selectedSymbol }: BollingerCoinListProps) => {
  const [coins, setCoins] = useState<CoinWithBB[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const loadCoins = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    
    try {
      // Fetch all tickers
      const tickers = await fetchAll24hTickers();
      
      // Sort by volume and take top 50 for performance
      const topTickers = tickers
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 50);

      // Fetch klines and calculate BB for each
      const coinsWithBB: CoinWithBB[] = [];
      
      // Process in batches to avoid rate limiting
      const batchSize = 10;
      for (let i = 0; i < topTickers.length; i += batchSize) {
        const batch = topTickers.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (ticker) => {
            try {
              const klines = await fetchKlines(ticker.symbol, '5m', 21);
              const bb = calculateBollingerBands(klines);
              return { ...ticker, bb };
            } catch {
              return null;
            }
          })
        );
        coinsWithBB.push(...results.filter((r): r is CoinWithBB => r !== null));
        
        // Small delay between batches
        if (i + batchSize < topTickers.length) {
          await new Promise(r => setTimeout(r, 100));
        }
      }

      // Filter coins above upper BB
      const aboveUpperBB = coinsWithBB
        .filter(coin => coin.bb.isAboveUpper)
        .sort((a, b) => {
          // Sort by how far above BB they are
          const aRatio = (a.bb.currentPrice - a.bb.upper) / a.bb.upper;
          const bRatio = (b.bb.currentPrice - b.bb.upper) / b.bb.upper;
          return bRatio - aRatio;
        });

      setCoins(aboveUpperBB);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Failed to load coins:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadCoins();
    const interval = setInterval(() => loadCoins(), 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [loadCoins]);

  if (loading) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold">BB 상단 돌파 코인</h3>
        </div>
        <div className="space-y-2">
          {Array(5).fill(0).map((_, i) => (
            <div key={i} className="h-16 shimmer rounded-lg" />
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
          <TrendingUp className="w-5 h-5 text-ask" />
          <div>
            <h3 className="text-sm font-semibold">BB 상단 돌파</h3>
            <p className="text-xs text-muted-foreground">5분봉 기준</p>
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

      {/* Last update time */}
      {lastUpdate && (
        <div className="px-4 py-2 bg-secondary/30 text-xs text-muted-foreground border-b border-border">
          마지막 업데이트: {lastUpdate.toLocaleTimeString('ko-KR')}
        </div>
      )}

      {/* Coin List */}
      {coins.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <AlertTriangle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            현재 BB 상단 돌파 코인이 없습니다
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            1분 후 자동으로 새로고침됩니다
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/50 max-h-[calc(100vh-300px)] overflow-y-auto">
          {coins.map((coin) => {
            const isSelected = coin.symbol === selectedSymbol;
            const bbExcess = ((coin.bb.currentPrice - coin.bb.upper) / coin.bb.upper * 100).toFixed(2);
            
            return (
              <button
                key={coin.symbol}
                onClick={() => onSelectSymbol(coin.symbol)}
                className={cn(
                  "w-full px-4 py-3 text-left transition-all hover:bg-secondary/50",
                  isSelected && "bg-primary/10 border-l-2 border-l-primary"
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">
                    {coin.symbol.replace('USDT', '')}
                    <span className="text-muted-foreground font-normal">/USDT</span>
                  </span>
                  <span className={cn(
                    "text-xs font-medium px-2 py-0.5 rounded",
                    coin.priceChangePercent >= 0 
                      ? "bg-positive/20 text-positive" 
                      : "bg-negative/20 text-negative"
                  )}>
                    {coin.priceChangePercent >= 0 ? '+' : ''}{coin.priceChangePercent.toFixed(2)}%
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm font-medium">
                    ${formatPrice(coin.price)}
                  </span>
                  <div className="flex items-center gap-1 text-xs text-ask">
                    <ArrowUp className="w-3 h-3" />
                    <span>BB +{bbExcess}%</span>
                  </div>
                </div>

                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>거래량: ${formatVolume(coin.volume)}</span>
                  <span>상단: ${formatPrice(coin.bb.upper)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-2 bg-secondary/30 border-t border-border">
        <p className="text-xs text-muted-foreground text-center">
          {coins.length}개 코인 발견 (상위 50개 거래량 기준)
        </p>
      </div>
    </div>
  );
};

export default BollingerCoinList;
