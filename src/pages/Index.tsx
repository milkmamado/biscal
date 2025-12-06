import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import HotCoinList from '@/components/HotCoinList';
import OrderPanel8282 from '@/components/OrderPanel8282';
import CoinHeader from '@/components/CoinHeader';
import DualChartPanel from '@/components/DualChartPanel';
import ApiKeySetup from '@/components/ApiKeySetup';
import { Button } from '@/components/ui/button';
import { LogOut, FlaskConical, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TradeStats {
  realizedPnL: number;
  tradeCount: number;
  winCount: number;
}

interface Position {
  type: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  leverage: number;
}

const Index = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [currentPosition, setCurrentPosition] = useState<Position | null>(null);
  const [currentPnL, setCurrentPnL] = useState(0);
  const [tradeStats, setTradeStats] = useState<TradeStats>({
    realizedPnL: 0,
    tradeCount: 0,
    winCount: 0
  });
  const [hasApiKeys, setHasApiKeys] = useState<boolean | null>(null);
  const [checkingKeys, setCheckingKeys] = useState(true);
  const [isTestnetMode, setIsTestnetMode] = useState(() => {
    return localStorage.getItem('binance_testnet_mode') === 'true';
  });

  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();

  // Check if user has API keys configured
  useEffect(() => {
    const checkApiKeys = async () => {
      if (!user) return;
      
      try {
        const { data, error } = await supabase
          .from('user_api_keys')
          .select('id, is_testnet')
          .eq('user_id', user.id);
        
        // Check if user has the appropriate keys for current mode
        const hasKeys = data?.some(key => key.is_testnet === isTestnetMode);
        setHasApiKeys(hasKeys ?? false);
      } catch (e) {
        setHasApiKeys(false);
      } finally {
        setCheckingKeys(false);
      }
    };

    if (user) {
      checkApiKeys();
    }
  }, [user, isTestnetMode]);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  const handlePositionChange = useCallback((position: Position | null) => {
    setCurrentPosition(position);
  }, []);

  const handlePnLChange = useCallback((pnl: number) => {
    setCurrentPnL(pnl);
  }, []);

  const handleTradeClose = useCallback((pnl: number) => {
    setTradeStats(prev => ({
      realizedPnL: prev.realizedPnL + pnl,
      tradeCount: prev.tradeCount + 1,
      winCount: pnl >= 0 ? prev.winCount + 1 : prev.winCount
    }));
  }, []);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const handleApiKeyComplete = () => {
    setHasApiKeys(true);
  };

  const toggleMode = () => {
    const newMode = !isTestnetMode;
    setIsTestnetMode(newMode);
    localStorage.setItem('binance_testnet_mode', newMode.toString());
    // Reset stats when switching modes
    setTradeStats({ realizedPnL: 0, tradeCount: 0, winCount: 0 });
    setCurrentPosition(null);
    setCurrentPnL(0);
    // Re-check API keys for new mode
    setCheckingKeys(true);
    setHasApiKeys(null);
  };

  if (loading || checkingKeys) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">로딩중...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Show API key setup if not configured
  if (hasApiKeys === false) {
    return <ApiKeySetup onComplete={handleApiKeyComplete} />;
  }

  return (
    <div className="min-h-screen bg-background p-2">
      {/* Testnet Mode Indicator */}
      {isTestnetMode && (
        <div className="fixed top-0 left-0 right-0 bg-orange-600 text-white text-center py-1 text-xs font-bold z-50">
          <FlaskConical className="inline h-3 w-3 mr-1" />
          테스트넷 모드 (모의 거래)
        </div>
      )}
      
      {/* Main Content */}
      <div className={cn("max-w-[1920px] mx-auto", isTestnetMode && "mt-6")}>
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
                unrealizedPnL={currentPnL}
                realizedPnL={tradeStats.realizedPnL}
                tradeCount={tradeStats.tradeCount}
                winCount={tradeStats.winCount}
                hasPosition={!!currentPosition}
                testnet={isTestnetMode}
              />
            </div>
          </div>

          {/* Right - Order Panel 8282 Style */}
          <div className="col-span-12 lg:col-span-4 xl:col-span-4 flex flex-col gap-2">
            <OrderPanel8282 
              symbol={selectedSymbol} 
              onPositionChange={handlePositionChange}
              onPnLChange={handlePnLChange}
              onTradeClose={handleTradeClose}
              testnet={isTestnetMode}
            />
            
            {/* Mode Toggle & Logout */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={toggleMode}
                className={cn(
                  "flex-1 border",
                  isTestnetMode 
                    ? "border-orange-500 text-orange-400 hover:bg-orange-500/10" 
                    : "border-primary text-primary hover:bg-primary/10"
                )}
              >
                {isTestnetMode ? (
                  <>
                    <Zap className="h-4 w-4 mr-1" />
                    실거래로 전환
                  </>
                ) : (
                  <>
                    <FlaskConical className="h-4 w-4 mr-1" />
                    테스트넷으로 전환
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                className="text-muted-foreground hover:text-foreground border border-border"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
