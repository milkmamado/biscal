import { useEffect, useState, useCallback } from 'react';
import { formatPrice } from '@/lib/binance';
import { useTickerWebSocket } from '@/hooks/useTickerWebSocket';
import { useBollingerSignals, BBSignal } from '@/hooks/useBollingerSignals';
import { cn } from '@/lib/utils';
import { RefreshCw, TrendingUp, TrendingDown, Search, Wifi, WifiOff, Activity, Star, X } from 'lucide-react';

interface HotCoinListProps {
  onSelectSymbol: (symbol: string) => void;
  selectedSymbol: string;
}

interface WatchlistItem {
  symbol: string;
  price: number;
  priceChangePercent: number;
  addedAt: number;
}

const WATCHLIST_KEY = 'bb_watchlist';

const HotCoinList = ({ onSelectSymbol, selectedSymbol }: HotCoinListProps) => {
  const { tickers, isConnected } = useTickerWebSocket();
  const [searchQuery, setSearchQuery] = useState('');
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  
  // Load watchlist from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(WATCHLIST_KEY);
    if (saved) {
      try {
        setWatchlist(JSON.parse(saved));
      } catch {
        setWatchlist([]);
      }
    }
  }, []);
  
  // Save watchlist to localStorage
  const saveWatchlist = useCallback((items: WatchlistItem[]) => {
    setWatchlist(items);
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(items));
  }, []);
  
  // Get tickers for BB scanning (filtered by criteria)
  const tickersForBB = tickers
    .filter(c => c.price >= 0.1 && c.volume >= 50_000_000)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 30)
    .map(c => ({
      symbol: c.symbol,
      price: c.price,
      priceChangePercent: c.priceChangePercent,
      volume: c.volume,
      volatilityRange: c.volatilityRange
    }));
  
  const { signals: bbSignals, isLoading: bbLoading } = useBollingerSignals(tickersForBB);
  
  // Auto-add BB signals to watchlist
  useEffect(() => {
    if (bbSignals.length === 0) return;
    
    const existingSymbols = new Set(watchlist.map(w => w.symbol));
    const newItems: WatchlistItem[] = [];
    
    bbSignals.forEach(signal => {
      if (!existingSymbols.has(signal.symbol)) {
        newItems.push({
          symbol: signal.symbol,
          price: signal.price,
          priceChangePercent: signal.priceChangePercent,
          addedAt: Date.now()
        });
      }
    });
    
    if (newItems.length > 0) {
      saveWatchlist([...newItems, ...watchlist]);
    }
  }, [bbSignals, watchlist, saveWatchlist]);
  
  // Update watchlist prices from tickers
  const tickerMap = new Map(tickers.map(t => [t.symbol, t]));
  const updatedWatchlist = watchlist.map(item => {
    const ticker = tickerMap.get(item.symbol);
    if (ticker) {
      return { ...item, price: ticker.price, priceChangePercent: ticker.priceChangePercent };
    }
    return item;
  });
  
  // Remove from watchlist
  const removeFromWatchlist = (symbol: string) => {
    saveWatchlist(watchlist.filter(w => w.symbol !== symbol));
  };
  
  // Filter signals by search query
  const filteredSignals = searchQuery 
    ? bbSignals.filter(s => s.symbol.toLowerCase().includes(searchQuery.toLowerCase()))
    : bbSignals;

  if (tickers.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold">BB 신호</h3>
        </div>
        <div className="p-2 space-y-1">
          {Array(6).fill(0).map((_, i) => (
            <div key={i} className="h-10 shimmer rounded" />
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
          <Activity className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">BB 신호</h3>
        </div>
        <div className="flex items-center gap-1">
          {isConnected ? (
            <Wifi className="w-3 h-3 text-green-500" />
          ) : (
            <WifiOff className="w-3 h-3 text-red-500" />
          )}
        </div>
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

      {/* BB Signal List - 절반 높이 */}
      <div className="h-[180px] divide-y divide-border/50 overflow-y-auto">
        {bbLoading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            <div className="text-center">
              <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2" />
              BB 스캔 중...
            </div>
          </div>
        ) : filteredSignals.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            {searchQuery ? '검색 결과 없음' : 'BB 터치 신호 없음'}
          </div>
        ) : (
          filteredSignals.map((signal) => {
            const isSelected = signal.symbol === selectedSymbol;
            
            return (
              <button
                key={signal.symbol}
                onClick={() => onSelectSymbol(signal.symbol)}
                className={cn(
                  "w-full px-3 py-1.5 text-left transition-all hover:bg-secondary/50 flex items-center gap-2",
                  isSelected && "bg-primary/10 border-l-2 border-l-primary"
                )}
              >
                <div className="bg-red-500/20 text-red-400 w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold">
                  ▲
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-xs">{signal.symbol.replace('USDT', '')}</span>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[10px]">${formatPrice(signal.price)}</p>
                  <div className={cn(
                    "text-[9px] font-medium",
                    signal.priceChangePercent >= 0 ? "text-positive" : "text-negative"
                  )}>
                    {signal.priceChangePercent >= 0 ? '+' : ''}{signal.priceChangePercent.toFixed(2)}%
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Watchlist Header */}
      <div className="px-3 py-1.5 border-y border-border bg-secondary/30 flex items-center gap-2">
        <Star className="w-3.5 h-3.5 text-yellow-500" />
        <span className="text-xs font-semibold">관심종목</span>
        <span className="text-[10px] text-muted-foreground">({updatedWatchlist.length})</span>
      </div>

      {/* Watchlist */}
      <div className="h-[180px] divide-y divide-border/50 overflow-y-auto">
        {updatedWatchlist.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            BB 신호 발생 시 자동 저장
          </div>
        ) : (
          updatedWatchlist.map((item) => {
            const isSelected = item.symbol === selectedSymbol;
            
            return (
              <div
                key={item.symbol}
                className={cn(
                  "w-full px-3 py-1.5 flex items-center gap-2",
                  isSelected && "bg-primary/10 border-l-2 border-l-primary"
                )}
              >
                <button
                  onClick={() => onSelectSymbol(item.symbol)}
                  className="flex-1 flex items-center gap-2 text-left hover:bg-secondary/50 transition-all"
                >
                  <Star className="w-4 h-4 text-yellow-500/50" />
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-xs">{item.symbol.replace('USDT', '')}</span>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[10px]">${formatPrice(item.price)}</p>
                    <div className={cn(
                      "text-[9px] font-medium",
                      item.priceChangePercent >= 0 ? "text-positive" : "text-negative"
                    )}>
                      {item.priceChangePercent >= 0 ? '+' : ''}{item.priceChangePercent.toFixed(2)}%
                    </div>
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromWatchlist(item.symbol);
                  }}
                  className="p-1 hover:bg-destructive/20 rounded transition-colors"
                >
                  <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Trading Session Indicator */}
      <TradingSessionIndicator />
    </div>
  );
};

// 시간대별 스캘핑 적합도 컴포넌트
const TradingSessionIndicator = () => {
  const [currentSession, setCurrentSession] = useState(getSessionInfo());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentSession(getSessionInfo());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={cn(
      "mx-2 mb-2 px-3 py-2 rounded border",
      currentSession.bgClass
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{currentSession.icon}</span>
          <div>
            <p className="text-xs font-semibold">{currentSession.session}</p>
            <p className="text-[10px] text-muted-foreground">{currentSession.time}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-muted-foreground">스캘핑</p>
          <p className={cn("text-xs font-bold", currentSession.textClass)}>
            {currentSession.difficulty}
          </p>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground">거래량:</span>
        <span className="text-[10px]">{currentSession.volume}</span>
        <span className="text-[10px] text-muted-foreground ml-2">변동성:</span>
        <span className="text-[10px]">{currentSession.volatility}</span>
      </div>
    </div>
  );
};

function getSessionInfo() {
  const now = new Date();
  const hour = now.getHours();

  if (hour >= 8 && hour < 12) {
    return {
      session: '아시아 피크',
      time: '08:00-12:00',
      volume: '보통',
      volatility: '보통',
      difficulty: '보통',
      icon: '⭐⭐⭐',
      bgClass: 'bg-yellow-500/10 border-yellow-500/30',
      textClass: 'text-yellow-400'
    };
  } else if (hour >= 12 && hour < 16) {
    return {
      session: '아시아 후반',
      time: '12:00-16:00',
      volume: '낮음',
      volatility: '낮음',
      difficulty: '어려움',
      icon: '⭐⭐',
      bgClass: 'bg-orange-500/10 border-orange-500/30',
      textClass: 'text-orange-400'
    };
  } else if (hour >= 16 && hour < 18) {
    return {
      session: '아시아-유럽 겹침',
      time: '16:00-18:00',
      volume: '높음',
      volatility: '높음',
      difficulty: '쉬움',
      icon: '⭐⭐⭐⭐',
      bgClass: 'bg-green-500/10 border-green-500/30',
      textClass: 'text-green-400'
    };
  } else if (hour >= 18 && hour < 22) {
    return {
      session: '유럽 단독',
      time: '18:00-22:00',
      volume: '보통',
      volatility: '보통',
      difficulty: '보통',
      icon: '⭐⭐⭐',
      bgClass: 'bg-yellow-500/10 border-yellow-500/30',
      textClass: 'text-yellow-400'
    };
  } else if (hour >= 22 || hour < 1) {
    return {
      session: '유럽-미국 겹침',
      time: '22:00-01:00',
      volume: '최고',
      volatility: '최고',
      difficulty: '최적',
      icon: '⭐⭐⭐⭐⭐',
      bgClass: 'bg-emerald-500/10 border-emerald-500/30',
      textClass: 'text-emerald-400'
    };
  } else if (hour >= 1 && hour < 4) {
    return {
      session: '미국 단독',
      time: '01:00-04:00',
      volume: '높음',
      volatility: '높음',
      difficulty: '쉬움',
      icon: '⭐⭐⭐⭐',
      bgClass: 'bg-green-500/10 border-green-500/30',
      textClass: 'text-green-400'
    };
  } else {
    return {
      session: '데드존',
      time: '04:00-08:00',
      volume: '최저',
      volatility: '최저',
      difficulty: '비추천',
      icon: '❌',
      bgClass: 'bg-red-500/10 border-red-500/30',
      textClass: 'text-red-400'
    };
  }
}

export default HotCoinList;
