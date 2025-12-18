import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTradingLogs } from '@/hooks/useTradingLogs';
import { supabase } from '@/integrations/supabase/client';
import HotCoinList from '@/components/HotCoinList';
import OrderPanel8282 from '@/components/OrderPanel8282';
import CoinHeader from '@/components/CoinHeader';
import DualChartPanel from '@/components/DualChartPanel';
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
  const [tradingEndedUntil, setTradingEndedUntil] = useState<number | null>(null);

  // 매매종료 상태 체크 (localStorage에서 복원)
  useEffect(() => {
    const stored = localStorage.getItem('tradingEndedUntil');
    if (stored) {
      const until = parseInt(stored, 10);
      if (until > Date.now()) {
        setTradingEndedUntil(until);
      } else {
        localStorage.removeItem('tradingEndedUntil');
      }
    }
  }, []);

  // 매매종료 버튼 클릭 핸들러
  const handleEndTrading = () => {
    // 다음 거래 가능 시간 계산 (09:00 또는 21:00 중 먼저 오는 시간)
    const now = new Date();
    const koreaOffset = 9 * 60; // UTC+9
    const utcOffset = now.getTimezoneOffset();
    const koreaTime = new Date(now.getTime() + (koreaOffset + utcOffset) * 60 * 1000);
    
    const currentHour = koreaTime.getHours();
    let nextTradingTime = new Date(koreaTime);
    
    // 현재 시간 기준으로 다음 거래 시간 찾기
    if (currentHour < 9) {
      // 오전 9시 전이면 오늘 오전 9시
      nextTradingTime.setHours(9, 0, 0, 0);
    } else if (currentHour < 11) {
      // 오전 9-11시면 오늘 밤 9시
      nextTradingTime.setHours(21, 0, 0, 0);
    } else if (currentHour < 21) {
      // 오전 11시 ~ 밤 9시면 오늘 밤 9시
      nextTradingTime.setHours(21, 0, 0, 0);
    } else if (currentHour < 23) {
      // 밤 9-11시면 내일 오전 9시
      nextTradingTime.setDate(nextTradingTime.getDate() + 1);
      nextTradingTime.setHours(9, 0, 0, 0);
    } else {
      // 밤 11시 이후면 내일 오전 9시
      nextTradingTime.setDate(nextTradingTime.getDate() + 1);
      nextTradingTime.setHours(9, 0, 0, 0);
    }
    
    // UTC timestamp로 변환
    const untilTimestamp = nextTradingTime.getTime() - (koreaOffset + utcOffset) * 60 * 1000;
    
    setTradingEndedUntil(untilTimestamp);
    localStorage.setItem('tradingEndedUntil', untilTimestamp.toString());
    
    const nextTimeStr = nextTradingTime.getHours() === 9 ? '오전 9시' : '밤 9시';
    toast.error(`매매 종료됨. ${nextTimeStr}까지 거래 불가`);
  };

  // 매매종료 상태를 dailyPnLKRW에 반영 (OrderPanel에서 거래 차단하도록)
  const effectiveDailyLoss = tradingEndedUntil && tradingEndedUntil > Date.now() 
    ? -999999999 // 거래 차단을 위해 큰 손실로 설정
    : dailyPnLKRW;

  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { dailyStats, logTrade } = useTradingLogs();

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [loading, user, navigate]);

  // Check if user has API keys configured (only if logged in)
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

  const handleTradeClose = useCallback((trade: {
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    leverage: number;
    pnl: number;
  }) => {
    // Log trade to database
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

  // Show loading only if checking keys for logged-in user
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

  return (
    <div className="min-h-screen bg-background p-2">
      {/* Main Content */}
      <div className="max-w-[1920px] mx-auto">
        <div className="grid grid-cols-12 gap-2">
          {/* Left - Hot Coin List */}
          <div className="col-span-12 lg:col-span-3 xl:col-span-2">
            <HotCoinList
              onSelectSymbol={setSelectedSymbol}
              selectedSymbol={selectedSymbol}
              onEndTrading={handleEndTrading}
              onSignOut={handleSignOut}
              tradingEndedUntil={tradingEndedUntil}
            />
          </div>

          {/* Center - Coin Info */}
          <div className="col-span-12 lg:col-span-5 xl:col-span-6">
            <CoinHeader symbol={selectedSymbol} onSelectSymbol={setSelectedSymbol} />
            
            {/* Dual Chart Area */}
            <div className="mt-2 h-[calc(100vh-80px)]">
              <DualChartPanel 
                symbol={selectedSymbol} 
                unrealizedPnL={currentPnL}
                realizedPnL={dailyStats.totalPnL}
                tradeCount={dailyStats.tradeCount}
                winCount={dailyStats.winCount}
                hasPosition={!!currentPosition}
                entryPrice={currentPosition?.entryPrice}
                openOrders={openOrders}
                onSelectSymbol={setSelectedSymbol}
                orderBook={orderBook}
                orderBookConnected={orderBookConnected}
                onDailyPnLChange={handleDailyPnLChange}
                onDailyProfitPercentChange={handleDailyProfitPercentChange}
              />
            </div>
          </div>

          {/* Right - Order Panel 8282 Style */}
          <div className="col-span-12 lg:col-span-4 xl:col-span-4">
            <OrderPanel8282 
              symbol={selectedSymbol} 
              onPositionChange={handlePositionChange}
              onPnLChange={handlePnLChange}
              onOpenOrdersChange={handleOpenOrdersChange}
              onTradeClose={handleTradeClose}
              onTpSlChange={handleTpSlChange}
              onOrderBookChange={handleOrderBookChange}
              dailyLossKRW={effectiveDailyLoss}
              dailyProfitPercent={dailyProfitPercent}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;