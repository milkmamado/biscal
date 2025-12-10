import { useEffect, useState, useCallback } from 'react';
import { SymbolInfo, formatPrice, formatVolume } from '@/lib/binance';
import { useTickerWebSocket } from '@/hooks/useTickerWebSocket';
import { useBollingerSignals, BBSignal } from '@/hooks/useBollingerSignals';
import { cn } from '@/lib/utils';
import { Flame, RefreshCw, TrendingUp, TrendingDown, BarChart3, ArrowUpCircle, ArrowDownCircle, Search, Wifi, WifiOff, Activity } from 'lucide-react';

type SortMode = 'hot' | 'volume' | 'gainers' | 'losers' | 'bb';

interface HotCoinListProps {
  onSelectSymbol: (symbol: string) => void;
  selectedSymbol: string;
}

const HotCoinList = ({ onSelectSymbol, selectedSymbol }: HotCoinListProps) => {
  const { tickers, isConnected } = useTickerWebSocket();
  const [coins, setCoins] = useState<SymbolInfo[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('hot');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Get symbols for BB scanning (top 30 by volume)
  const symbolsForBB = tickers
    .filter(c => c.price >= 0.1 && c.volume >= 50_000_000)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 30)
    .map(c => c.symbol);
  
  const { signals: bbSignals, isLoading: bbLoading } = useBollingerSignals(symbolsForBB);

  // Sort and filter coins based on mode and search
  useEffect(() => {
    // 스캘핑 적합 코인 필터링 (해외 전문가 기준)
    let filtered = tickers.filter(c => 
      c.price >= 0.1 && c.volume >= 50_000_000
    );
    
    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(c => 
        c.symbol.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    // Apply sorting
    switch (sortMode) {
      case 'hot':
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
      case 'bb':
        // BB mode uses separate signal list
        break;
    }
    
    setCoins(filtered.slice(0, 15));
  }, [tickers, sortMode, searchQuery]);

  const tabs: { mode: SortMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'hot', label: '변동', icon: <Flame className="w-3 h-3" /> },
    { mode: 'volume', label: '거래량', icon: <BarChart3 className="w-3 h-3" /> },
    { mode: 'gainers', label: '상승', icon: <ArrowUpCircle className="w-3 h-3" /> },
    { mode: 'bb', label: 'BB', icon: <Activity className="w-3 h-3" /> },
  ];

  if (tickers.length === 0) {
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
        {sortMode === 'bb' ? (
          // BB Signal List
          bbLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2" />
              BB 신호 스캔 중...
            </div>
          ) : bbSignals.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              BB 터치 신호 없음
            </div>
          ) : (
            bbSignals.map((signal, index) => {
              const isSelected = signal.symbol === selectedSymbol;
              const isUpper = signal.touchType === 'upper';
              
              return (
                <button
                  key={signal.symbol}
                  onClick={() => onSelectSymbol(signal.symbol)}
                  className={cn(
                    "w-full px-3 py-2 text-left transition-all hover:bg-secondary/50 flex items-center gap-2",
                    isSelected && "bg-primary/10 border-l-2 border-l-primary"
                  )}
                >
                  {/* Touch Type Indicator */}
                  <div className={cn(
                    "w-6 h-6 rounded flex items-center justify-center text-xs font-bold",
                    isUpper 
                      ? "bg-red-500/20 text-red-400" 
                      : "bg-green-500/20 text-green-400"
                  )}>
                    {isUpper ? '▲' : '▼'}
                  </div>

                  {/* Symbol & Band Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-semibold text-xs truncate">
                        {signal.symbol.replace('USDT', '')}
                      </span>
                      <span className={cn(
                        "text-[9px] px-1 rounded",
                        isUpper ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"
                      )}>
                        {isUpper ? '상단' : '하단'}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">
                      3분봉 BB {isUpper ? '저항' : '지지'}
                    </p>
                  </div>

                  {/* Price & Change */}
                  <div className="text-right">
                    <p className="font-mono text-xs font-medium">
                      ${formatPrice(signal.price)}
                    </p>
                    <div className={cn(
                      "flex items-center justify-end gap-0.5 text-[10px] font-medium",
                      signal.priceChangePercent >= 0 ? "text-positive" : "text-negative"
                    )}>
                      {signal.priceChangePercent >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                      <span>{signal.priceChangePercent >= 0 ? '+' : ''}{signal.priceChangePercent.toFixed(2)}%</span>
                    </div>
                  </div>
                </button>
              );
            })
          )
        ) : (
          // Regular Coin List
          coins.length === 0 ? (
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
          )
        )}
      </div>

      {/* Note */}
      <div className="px-3 py-1.5 bg-secondary/30 border-t border-border">
        <p className="text-[10px] text-muted-foreground text-center">
          {sortMode === 'bb' ? (
            <>BB 터치 {bbSignals.length}개 · 3분봉 · 30초 갱신</>
          ) : (
            <>스캘핑 적합 {tickers.filter(c => c.price >= 0.1 && c.volume >= 50_000_000).length}개 · $0.1↑ · $50M↑</>
          )}
        </p>
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
    }, 60000); // 1분마다 업데이트
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

// 현재 시간대에 따른 세션 정보 반환
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
