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
import { Button } from '@/components/ui/button';
import { LogOut, LogIn } from 'lucide-react';

const JOIN_CODE_KEY = 'biscal_joined';

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

const Index = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [currentPosition, setCurrentPosition] = useState<Position | null>(null);
  const [currentPnL, setCurrentPnL] = useState(0);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [tpSlPrices, setTpSlPrices] = useState<TpSlPrices>({ tpPrice: null, slPrice: null });
  const [hasApiKeys, setHasApiKeys] = useState<boolean | null>(null);
  const [checkingKeys, setCheckingKeys] = useState(true);

  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { dailyStats, logTrade } = useTradingLogs();

  // Check if user has joined with code
  const hasJoinCode = localStorage.getItem(JOIN_CODE_KEY) === 'true';

  // Redirect to auth if no join code
  useEffect(() => {
    if (!hasJoinCode) {
      navigate('/auth');
    }
  }, [hasJoinCode, navigate]);

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

  // Guest mode: not logged in, show view-only interface
  const isGuest = !user;

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
            />
          </div>

          {/* Center - Coin Info */}
          <div className="col-span-12 lg:col-span-5 xl:col-span-6">
            <CoinHeader symbol={selectedSymbol} />
            
            {/* Dual Chart Area */}
            <div className="mt-2 h-[calc(100vh-80px)]">
              <DualChartPanel 
                symbol={selectedSymbol} 
                unrealizedPnL={isGuest ? 0 : currentPnL}
                realizedPnL={isGuest ? 0 : dailyStats.totalPnL}
                tradeCount={isGuest ? 0 : dailyStats.tradeCount}
                winCount={isGuest ? 0 : dailyStats.winCount}
                hasPosition={isGuest ? false : !!currentPosition}
                entryPrice={isGuest ? undefined : currentPosition?.entryPrice}
                openOrders={isGuest ? [] : openOrders}
                tpPrice={isGuest ? null : tpSlPrices.tpPrice}
                slPrice={isGuest ? null : tpSlPrices.slPrice}
                onSelectSymbol={setSelectedSymbol}
              />
            </div>
          </div>

          {/* Right - Order Panel 8282 Style */}
          <div className="col-span-12 lg:col-span-4 xl:col-span-4 flex flex-col gap-2">
            <OrderPanel8282 
              symbol={selectedSymbol} 
              onPositionChange={handlePositionChange}
              onPnLChange={handlePnLChange}
              onOpenOrdersChange={handleOpenOrdersChange}
              onTradeClose={handleTradeClose}
              onTpSlChange={handleTpSlChange}
            />
            
            {/* Login/Logout */}
            <div className="flex justify-end">
              {isGuest ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/auth')}
                  className="text-muted-foreground hover:text-foreground border border-border"
                >
                  <LogIn className="h-4 w-4 mr-1" />
                  로그인
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleSignOut}
                  className="text-muted-foreground hover:text-foreground border border-border"
                >
                  <LogOut className="h-4 w-4 mr-1" />
                  로그아웃
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
