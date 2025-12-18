import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTradingLogs } from '@/hooks/useTradingLogs';
import { useAutoTrading } from '@/hooks/useAutoTrading';
import { useBollingerSignals } from '@/hooks/useBollingerSignals';
import { useTickerWebSocket } from '@/hooks/useTickerWebSocket';
import { supabase } from '@/integrations/supabase/client';
import DualChartPanel from '@/components/DualChartPanel';
import AutoTradingPanel from '@/components/AutoTradingPanel';
import ApiKeySetup from '@/components/ApiKeySetup';

const Index = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [hasApiKeys, setHasApiKeys] = useState<boolean | null>(null);
  const [checkingKeys, setCheckingKeys] = useState(true);
  const [balanceUSD, setBalanceUSD] = useState(0);
  const [krwRate, setKrwRate] = useState(1380);
  const [leverage, setLeverage] = useState(10);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { dailyStats } = useTradingLogs();
  const { tickers } = useTickerWebSocket();
  
  // 청산 후 즉시 잔고 갱신
  const handleTradeComplete = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);
  
  // 자동매매 훅
  const autoTrading = useAutoTrading({
    balanceUSD,
    leverage,
    krwRate,
    onTradeComplete: handleTradeComplete,
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
    
    // 포지션 보유 중이거나 대기 중이면 새 시그널 무시
    if (autoTrading.state.currentPosition) return;
    if (autoTrading.state.pendingSignal) return;
    
    // 새로운 시그널만 처리
    const currentSignalKeys = new Set(bbSignals.map(s => `${s.symbol}-${s.touchType}`));
    
    for (const signal of bbSignals) {
      const signalKey = `${signal.symbol}-${signal.touchType}`;
      
      // 이미 처리한 시그널이면 무시
      if (prevSignalsRef.current.has(signalKey)) continue;
      
      // 자동매매 진입 실행
      autoTrading.handleSignal(signal.symbol, signal.touchType, signal.price);
      
      // 진입한 종목으로 차트 전환
      setSelectedSymbol(signal.symbol);
      break; // 한 번에 하나만 처리
    }
    
    prevSignalsRef.current = currentSignalKeys;
  }, [bbSignals, autoTrading.state.isEnabled, autoTrading.state.currentPosition, autoTrading.state.pendingSignal]);
  
  // 포지션 보유 중이거나 대기 중일 때 해당 종목 차트 유지
  useEffect(() => {
    if (autoTrading.state.currentPosition) {
      setSelectedSymbol(autoTrading.state.currentPosition.symbol);
    } else if (autoTrading.state.pendingSignal) {
      setSelectedSymbol(autoTrading.state.pendingSignal.symbol);
    }
  }, [autoTrading.state.currentPosition?.symbol, autoTrading.state.pendingSignal?.symbol]);
  
  // 현재 가격으로 TP 체크
  useEffect(() => {
    if (!autoTrading.state.currentPosition) return;
    
    const position = autoTrading.state.currentPosition;
    const ticker = tickers.find(t => t.symbol === position.symbol);
    if (!ticker) return;
    
    // state에 저장된 동적 TP 값 사용
    const tpPercent = autoTrading.state.tpPercent;
    
    autoTrading.checkTpSl(ticker.price, tpPercent, 0); // slPercent는 봉 기준이라 미사용
  }, [tickers, autoTrading.state.currentPosition, autoTrading.state.tpPercent]);

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
        const { data } = await supabase
          .from('user_api_keys')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_testnet', false);
        
        setHasApiKeys(data && data.length > 0);
      } catch {
        setHasApiKeys(false);
      } finally {
        setCheckingKeys(false);
      }
    };

    checkApiKeys();
  }, [user]);
  
  const handleBalanceChange = useCallback((balance: number) => {
    setBalanceUSD(balance);
  }, []);

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
        <div className="grid grid-cols-12 gap-2 items-stretch">
          {/* Left - Auto Trading Panel */}
          <div className="col-span-12 lg:col-span-4 xl:col-span-3 flex">
            <AutoTradingPanel
              state={autoTrading.state}
              onToggle={autoTrading.toggleAutoTrading}
              onManualClose={handleManualClose}
              currentPrice={currentAutoPrice}
              krwRate={krwRate}
              leverage={leverage}
              onLeverageChange={setLeverage}
              onSelectSymbol={setSelectedSymbol}
            />
          </div>

          {/* Center - Chart */}
          <div className="col-span-12 lg:col-span-8 xl:col-span-9">
            <DualChartPanel 
              symbol={selectedSymbol} 
              tradeCount={dailyStats.tradeCount}
              winCount={dailyStats.winCount}
              hasPosition={!!autoTrading.state.currentPosition}
              entryPrice={autoTrading.state.currentPosition?.entryPrice}
              onSelectSymbol={setSelectedSymbol}
              onBalanceChange={handleBalanceChange}
              refreshTrigger={refreshTrigger}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
