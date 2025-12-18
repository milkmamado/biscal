import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTradingLogs } from '@/hooks/useTradingLogs';
import { useAutoTrading } from '@/hooks/useAutoTrading';
import { useBollingerSignals, BBSignal } from '@/hooks/useBollingerSignals';
import { useTickerWebSocket } from '@/hooks/useTickerWebSocket';
import { supabase } from '@/integrations/supabase/client';
import HotCoinList from '@/components/HotCoinList';
import DualChartPanel from '@/components/DualChartPanel';
import AutoTradingPanel from '@/components/AutoTradingPanel';
import ApiKeySetup from '@/components/ApiKeySetup';
import { toast } from 'sonner';

interface Position {
  type: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  leverage: number;
}

interface OpenOrder {
  orderId: number;
  price: number;
  side: 'BUY' | 'SELL';
  origQty: number;
}

interface TpSlPrices {
  tpPrice: number | null;
  slPrice: number | null;
}

interface OrderBook {
  bids: { price: number; quantity: number }[];
  asks: { price: number; quantity: number }[];
  lastUpdateId: number;
}

const Index = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [currentPosition, setCurrentPosition] = useState<Position | null>(null);
  const [currentPnL, setCurrentPnL] = useState(0);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [tpSlPrices, setTpSlPrices] = useState<TpSlPrices>({ tpPrice: null, slPrice: null });
  const [hasApiKeys, setHasApiKeys] = useState<boolean | null>(null);
  const [checkingKeys, setCheckingKeys] = useState(true);
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [orderBookConnected, setOrderBookConnected] = useState(false);
  const [dailyPnLKRW, setDailyPnLKRW] = useState(0);
  const [dailyProfitPercent, setDailyProfitPercent] = useState(0);
  const [balanceUSD, setBalanceUSD] = useState(0);
  const [krwRate, setKrwRate] = useState(1380);

  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { dailyStats, logTrade } = useTradingLogs();
  const { tickers } = useTickerWebSocket();
  
  // 자동매매 훅
  const autoTrading = useAutoTrading({
    balanceUSD,
    leverage: 10,
    krwRate,
  });
  
  // BB 시그널을 위한 티커 데이터 준비
  const tickersForBB = tickers
    .filter(c => c.price >= 0.01 && c.volume >= 50_000_000)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 30)
    .map(c => ({
      symbol: c.symbol,
      price: c.price,
      priceChangePercent: c.priceChangePercent,
      volume: c.volume,
      volatilityRange: c.volatilityRange
    }));
  
  const { signals: bbSignals } = useBollingerSignals(tickersForBB);
  
  // 이전 시그널 추적 (중복 진입 방지)
  const prevSignalsRef = useRef<Set<string>>(new Set());
  
  // BB 시그널 감지 시 자동매매 트리거
  useEffect(() => {
    if (!autoTrading.state.isEnabled) return;
    if (bbSignals.length === 0) return;
    
    // 새로운 시그널만 처리
    const currentSignalKeys = new Set(bbSignals.map(s => `${s.symbol}-${s.touchType}`));
    
    for (const signal of bbSignals) {
      const signalKey = `${signal.symbol}-${signal.touchType}`;
      
      // 이미 처리한 시그널이면 무시
      if (prevSignalsRef.current.has(signalKey)) continue;
      
      // 자동매매 진입 실행
      autoTrading.handleSignal(signal.symbol, signal.touchType, signal.price);
      break; // 한 번에 하나만 처리
    }
    
    prevSignalsRef.current = currentSignalKeys;
  }, [bbSignals, autoTrading.state.isEnabled]);
  
  // 현재 가격으로 TP/SL 체크
  useEffect(() => {
    if (!autoTrading.state.currentPosition) return;
    
    const position = autoTrading.state.currentPosition;
    const ticker = tickers.find(t => t.symbol === position.symbol);
    if (!ticker) return;
    
    // 동적 TP/SL 값 (state에 저장된 값 사용)
    const tpPercent = (autoTrading.state as any).tpPercent || 0.3;
    const slPercent = (autoTrading.state as any).slPercent || 0.5;
    
    autoTrading.checkTpSl(ticker.price, tpPercent, slPercent);
  }, [tickers, autoTrading.state.currentPosition]);

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

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [loading, user, navigate]);

  // Check if user has API keys configured
  useEffect(() => {
    const checkApiKeys = async () => {
      if (!user) {
        setCheckingKeys(false);
        setHasApiKeys(null);
        return;
      }
      
      try {
        const { data, error } = await supabase
          .from('user_api_keys')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_testnet', false);
        
        setHasApiKeys(data && data.length > 0);
      } catch (e) {
        setHasApiKeys(false);
      } finally {
        setCheckingKeys(false);
      }
    };

    checkApiKeys();
  }, [user]);

  const handlePositionChange = useCallback((position: Position | null) => {
    setCurrentPosition(position);
  }, []);

  const handlePnLChange = useCallback((pnl: number) => {
    setCurrentPnL(pnl);
  }, []);

  const handleOpenOrdersChange = useCallback((orders: OpenOrder[]) => {
    setOpenOrders(orders);
  }, []);

  const handleTpSlChange = useCallback((tpsl: TpSlPrices) => {
    setTpSlPrices(tpsl);
  }, []);

  const handleOrderBookChange = useCallback((ob: OrderBook | null, connected: boolean) => {
    setOrderBook(ob);
    setOrderBookConnected(connected);
  }, []);

  const handleDailyPnLChange = useCallback((pnl: number) => {
    setDailyPnLKRW(pnl);
  }, []);

  const handleDailyProfitPercentChange = useCallback((percent: number) => {
    setDailyProfitPercent(percent);
  }, []);
  
  const handleBalanceChange = useCallback((balance: number) => {
    setBalanceUSD(balance);
  }, []);

  const handleTradeClose = useCallback((trade: {
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    leverage: number;
    pnl: number;
  }) => {
    logTrade({
      symbol: trade.symbol,
      side: trade.side,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      quantity: trade.quantity,
      leverage: trade.leverage,
      pnlUsd: trade.pnl,
    });
  }, [logTrade]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const handleApiKeyComplete = () => {
    setHasApiKeys(true);
  };
  
  // 수동 청산 핸들러
  const handleManualClose = () => {
    if (!autoTrading.state.currentPosition) return;
    
    const position = autoTrading.state.currentPosition;
    const ticker = tickers.find(t => t.symbol === position.symbol);
    if (!ticker) return;
    
    autoTrading.closePosition('exit', ticker.price);
  };

  // Show loading
  if (loading || (user && checkingKeys)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">로딩중...</div>
      </div>
    );
  }

  // If logged in but no API keys, show setup
  if (user && hasApiKeys === false) {
    return <ApiKeySetup onComplete={handleApiKeyComplete} />;
  }
  
  // 현재 가격 (자동매매 포지션용)
  const currentAutoPrice = autoTrading.state.currentPosition
    ? tickers.find(t => t.symbol === autoTrading.state.currentPosition?.symbol)?.price || 0
    : 0;

  return (
    <div className="min-h-screen bg-background p-2">
      <div className="max-w-[1920px] mx-auto">
        <div className="grid grid-cols-12 gap-2">
          {/* Left - BB Signals & Auto Trading */}
          <div className="col-span-12 lg:col-span-3 xl:col-span-2 space-y-2">
            <AutoTradingPanel
              state={autoTrading.state}
              onToggle={autoTrading.toggleAutoTrading}
              onManualClose={handleManualClose}
              currentPrice={currentAutoPrice}
              krwRate={krwRate}
            />
            <HotCoinList
              onSelectSymbol={setSelectedSymbol}
              selectedSymbol={selectedSymbol}
              onSignOut={handleSignOut}
            />
          </div>

          {/* Center - Chart */}
          <div className="col-span-12 lg:col-span-9 xl:col-span-10">
            <DualChartPanel 
              symbol={selectedSymbol} 
              unrealizedPnL={currentPnL}
              realizedPnL={dailyStats.totalPnL}
              tradeCount={dailyStats.tradeCount}
              winCount={dailyStats.winCount}
              hasPosition={!!currentPosition || !!autoTrading.state.currentPosition}
              entryPrice={currentPosition?.entryPrice || autoTrading.state.currentPosition?.entryPrice}
              openOrders={openOrders}
              onSelectSymbol={setSelectedSymbol}
              orderBook={orderBook}
              orderBookConnected={orderBookConnected}
              onDailyPnLChange={handleDailyPnLChange}
              onDailyProfitPercentChange={handleDailyProfitPercentChange}
              onBalanceChange={handleBalanceChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
