import { useEffect, useState, useCallback } from 'react';
import { fetchAll24hTickers, SymbolInfo, formatPrice, formatVolume } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { Flame, RefreshCw, TrendingUp, TrendingDown, BarChart3, ArrowUpCircle, ArrowDownCircle, Search } from 'lucide-react';

type SortMode = 'hot' | 'volume' | 'gainers' | 'losers';

interface HotCoinListProps {
  onSelectSymbol: (symbol: string) => void;
  selectedSymbol: string;
}

const HotCoinList = ({ onSelectSymbol, selectedSymbol }: HotCoinListProps) => {
  const [coins, setCoins] = useState<SymbolInfo[]>([]);
  const [allCoins, setAllCoins] = useState<SymbolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('hot');
  const [searchQuery, setSearchQuery] = useState('');

  const loadCoins = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    
    try {
      const tickers = await fetchAll24hTickers();
      setAllCoins(tickers);
    } catch (error) {
      console.error('Failed to load coins:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Sort and filter coins based on mode and search
  useEffect(() => {
    // Filter out halted coins (0 volume) and apply search
    let filtered = allCoins.filter(c => c.volume > 10000); // 거래량 $10,000 이상만
    
    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(c => 
        c.symbol.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    // Apply sorting
    switch (sortMode) {
      case 'hot':
        // Hot = composite score (volume + volatility)
        filtered.sort((a, b) => b.hotScore - a.hotScore);
        break;
      case 'volume':
        filtered.sort((a, b) => b.volume - a.volume);
        break;
      case 'gainers':
        filtered.sort((a, b) => b.priceChangePercent - a.priceChangePercent);
        break;
      case 'losers':
        filtered.sort((a, b) => a.priceChangePercent - b.priceChangePercent);
        break;
    }
    
    setCoins(filtered.slice(0, 15));
  }, [allCoins, sortMode, searchQuery]);

  useEffect(() => {
    loadCoins();
    const interval = setInterval(() => loadCoins(), 30000); // 30초마다 갱신
    return () => clearInterval(interval);
  }, [loadCoins]);

  const tabs: { mode: SortMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'hot', label: '변동', icon: <Flame className="w-3 h-3" /> },
    { mode: 'volume', label: '거래량', icon: <BarChart3 className="w-3 h-3" /> },
    { mode: 'gainers', label: '상승', icon: <ArrowUpCircle className="w-3 h-3" /> },
    { mode: 'losers', label: '하락', icon: <ArrowDownCircle className="w-3 h-3" /> },
  ];

  if (loading) {
    return (
      <div className="bg-card rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Flame className="w-5 h-5 text-orange-500" />
          <h3 className="text-sm font-semibold">선물</h3>
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
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-500" />
          <h3 className="text-sm font-semibold">선물 목록</h3>
        </div>
        <button
          onClick={() => loadCoins(true)}
          disabled={refreshing}
          className="p-1.5 hover:bg-secondary rounded-md transition-colors"
        >
          <RefreshCw className={cn("w-3.5 h-3.5 text-muted-foreground", refreshing && "animate-spin")} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="코인 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-secondary/50 border border-border rounded pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Sort Tabs */}
      <div className="px-2 py-1.5 border-b border-border bg-secondary/20 flex gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.mode}
            onClick={() => setSortMode(tab.mode)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-colors",
              sortMode === tab.mode
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary"
            )}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Coin List */}
      <div className="divide-y divide-border/50 max-h-[calc(100vh-350px)] overflow-y-auto">
        {coins.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            검색 결과가 없습니다
          </div>
        ) : (
          coins.map((coin, index) => {
            const isSelected = coin.symbol === selectedSymbol;
            const isPositive = coin.priceChangePercent >= 0;
            
            return (
              <button
                key={coin.symbol}
                onClick={() => onSelectSymbol(coin.symbol)}
                className={cn(
                  "w-full px-3 py-2 text-left transition-all hover:bg-secondary/50 flex items-center gap-2",
                  isSelected && "bg-primary/10 border-l-2 border-l-primary"
                )}
              >
                {/* Rank */}
                <div className={cn(
                  "w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold",
                  index < 3 ? "bg-orange-500/20 text-orange-500" : "bg-secondary text-muted-foreground"
                )}>
                  {index + 1}
                </div>

                {/* Symbol & Volume */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-xs truncate">
                      {coin.symbol.replace('USDT', '')}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">
                    ${formatVolume(coin.volume)}
                  </p>
                </div>

                {/* Price & Change */}
                <div className="text-right">
                  <p className="font-mono text-xs font-medium">
                    ${formatPrice(coin.price)}
                  </p>
                  <div className={cn(
                    "flex items-center justify-end gap-0.5 text-[10px] font-medium",
                    isPositive ? "text-positive" : "text-negative"
                  )}>
                    {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                    <span>{isPositive ? '+' : ''}{coin.priceChangePercent.toFixed(2)}%</span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Note */}
      <div className="px-3 py-1.5 bg-secondary/30 border-t border-border">
        <p className="text-[10px] text-muted-foreground text-center">
          {allCoins.filter(c => c.volume > 10000).length}개 활성 코인 · 30초마다 갱신
        </p>
      </div>
    </div>
  );
};

export default HotCoinList;
