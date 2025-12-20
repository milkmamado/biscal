import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTradingLogs } from '@/hooks/useTradingLogs';
import { useAutoTrading } from '@/hooks/useAutoTrading';
import { useCoinScreening } from '@/hooks/useCoinScreening';
import { useTickerWebSocket } from '@/hooks/useTickerWebSocket';
import { useWakeLock } from '@/hooks/useWakeLock';
import { supabase } from '@/integrations/supabase/client';
import DualChartPanel from '@/components/DualChartPanel';
import AutoTradingPanel from '@/components/AutoTradingPanel';
import PaperApiKeySetup from '@/components/PaperApiKeySetup';
import { Button } from '@/components/ui/button';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';

const PaperTrading = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [hasApiKeys, setHasApiKeys] = useState<boolean | null>(null);
  const [checkingKeys, setCheckingKeys] = useState(true);
  const [balanceUSD, setBalanceUSD] = useState(0);
  const [krwRate, setKrwRate] = useState(1380);
  const [leverage, setLeverage] = useState(10);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { dailyStats, logTrade, fetchDailyStats } = useTradingLogs({ isTestnet: true });
  
  // Only connect WebSocket when user is authenticated and API keys are ready
  const shouldConnectWebSocket = !!user && hasApiKeys === true;
  const { tickers } = useTickerWebSocket(shouldConnectWebSocket);
  
  // 청산 후 즉시 잔고 갱신
  const handleTradeComplete = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
    fetchDailyStats();
  }, [fetchDailyStats]);
  
  // 초기 통계를 dailyStats에서 가져옴
  const initialStats = {
    trades: dailyStats.tradeCount,
    wins: dailyStats.winCount,
    losses: dailyStats.lossCount,
    totalPnL: dailyStats.totalPnL,
  };
  
  // 자동매매 훅 (테스트넷 모드)
  const autoTrading = useAutoTrading({
    balanceUSD,
    leverage,
    krwRate,
    onTradeComplete: handleTradeComplete,
    initialStats,
    logTrade,
    isTestnet: true, // 테스트넷 모드 활성화
  });
  
  // 자동매매 중 절전 방지
  useWakeLock(autoTrading.state.isEnabled);

  // 종목 스크리닝용 티커 데이터 준비
  const tickersForScreening = tickers
    .filter(c => c.price >= 0.01 && c.volume >= 50_000_000)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 50)
    .map(c => ({
      symbol: c.symbol,
      price: c.price,
      priceChangePercent: c.priceChangePercent,
      volume: c.volume,
      volatilityRange: c.volatilityRange
    }));
  
  // 기술적 분석 기반 종목 스크리닝
  const { activeSignals, isScanning, screenedSymbols, lastScanTime } = useCoinScreening(tickersForScreening);

  // 이전 시그널 추적
  const prevSignalsRef = useRef<Map<string, number>>(new Map());
  const justEnabledRef = useRef(false);
  
  // 자동매매 켜질 때 초기화
  useEffect(() => {
    if (autoTrading.state.isEnabled) {
      justEnabledRef.current = true;
      prevSignalsRef.current = new Map();

      const timer = setTimeout(() => {
        justEnabledRef.current = false;
      }, 2000);
      return () => clearTimeout(timer);
    }

    prevSignalsRef.current = new Map();
  }, [autoTrading.state.isEnabled]);
  
  // 기술적 분석 시그널 감지 시 자동매매 트리거
  useEffect(() => {
    if (!autoTrading.state.isEnabled) return;
    if (justEnabledRef.current) return;
    if (activeSignals.length === 0) return;

    if (autoTrading.state.currentPosition) return;
    if (autoTrading.state.pendingSignal) return;

    const now = Date.now();
    const retryCooldownMs = 2 * 60 * 1000;

    for (const signal of activeSignals) {
      const signalKey = `${signal.symbol}-${signal.direction}`;

      if (signal.strength === 'weak') continue;

      const lastAttempt = prevSignalsRef.current.get(signalKey);
      if (lastAttempt && now - lastAttempt < retryCooldownMs) continue;

      console.log(`🔥 [PaperTrading] Signal: ${signal.symbol} ${signal.direction} (${signal.strength})`);

      prevSignalsRef.current.set(signalKey, now);

      autoTrading.handleTechnicalSignal(
        signal.symbol,
        signal.direction,
        signal.price,
        signal.strength,
        signal.reasons,
        signal.indicators
      );

      setSelectedSymbol(signal.symbol);
      break;
    }
  }, [activeSignals, autoTrading.state.isEnabled, autoTrading.state.currentPosition, autoTrading.state.pendingSignal]);
  
  // 포지션 보유 중일 때 해당 종목 차트 유지
  useEffect(() => {
    if (autoTrading.state.currentPosition) {
      setSelectedSymbol(autoTrading.state.currentPosition.symbol);
    } else if (autoTrading.state.pendingSignal) {
      setSelectedSymbol(autoTrading.state.pendingSignal.symbol);
    }
  }, [autoTrading.state.currentPosition?.symbol, autoTrading.state.pendingSignal?.symbol]);
  
  // 현재 가격으로 TP/SL 체크
  useEffect(() => {
    if (!autoTrading.state.currentPosition) return;
    
    const position = autoTrading.state.currentPosition;
    const ticker = tickers.find(t => t.symbol === position.symbol);
    if (!ticker) return;
    
    autoTrading.checkTpSl(ticker.price, 0.3, 0.5);
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

  // Check if user has testnet API keys configured
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
          .eq('is_testnet', true); // 테스트넷 키 체크
        
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

  // If logged in but no testnet API keys, show setup
  if (user && hasApiKeys === false) {
    return <PaperApiKeySetup onComplete={handleApiKeyComplete} />;
  }
  
  // 현재 가격
  const currentAutoPrice = autoTrading.state.currentPosition
    ? tickers.find(t => t.symbol === autoTrading.state.currentPosition?.symbol)?.price || 0
    : 0;
    
  // 손절/익절 예정 가격 계산
  const position = autoTrading.state.currentPosition;
  const stopLossPrice = position ? (
    position.takeProfitState?.breakEvenActivated
      ? (position.side === 'long'
          ? position.entryPrice * (1 + 0.0002)
          : position.entryPrice * (1 - 0.0002))
      : (position.side === 'long'
          ? position.entryPrice * (1 - 0.0025)
          : position.entryPrice * (1 + 0.0025))
  ) : undefined;
  
  const takeProfitPrice = position ? (
    position.side === 'long'
      ? position.entryPrice * (1 + 0.0025)
      : position.entryPrice * (1 - 0.0025)
  ) : undefined;

  return (
    <div className="h-screen bg-background p-1 overflow-hidden flex flex-col">
      {/* Paper Trading Header */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-border/50 mb-1">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/auth')}
            className="gap-1 h-7 px-2"
          >
            <ArrowLeft className="h-3 w-3" />
            나가기
          </Button>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-500/20 border border-amber-500/50">
            <FlaskConical className="h-3.5 w-3.5 text-amber-400" />
            <span className="text-xs font-bold text-amber-400">EXERCISE ROOM</span>
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground">
          테스트넷 모의투자 • 가상 자금으로 연습
        </div>
      </div>

      {/* Main Content - Same as Index */}
      <div className="flex-1 min-h-0 grid grid-cols-12 gap-1">
        {/* Left - Chart */}
        <div className="col-span-8 flex flex-col min-h-0">
          <DualChartPanel 
            symbol={selectedSymbol} 
            hasPosition={!!autoTrading.state.currentPosition}
            entryPrice={autoTrading.state.currentPosition?.entryPrice}
            stopLossPrice={stopLossPrice}
            takeProfitPrice={takeProfitPrice}
            positionSide={autoTrading.state.currentPosition?.side}
            onSelectSymbol={setSelectedSymbol}
          />
        </div>

        {/* Right - System Trading Panel */}
        <div className="col-span-4 flex flex-col min-h-0 overflow-auto gap-1">
          <AutoTradingPanel
            state={autoTrading.state}
            onToggle={autoTrading.toggleAutoTrading}
            onManualClose={handleManualClose}
            onSkipSignal={autoTrading.skipSignal}
            onSwapSignal={autoTrading.swapSignalDirection}
            onToggleLossProtection={autoTrading.toggleLossProtection}
            onClearCooldown={autoTrading.clearCooldown}
            currentPrice={currentAutoPrice}
            krwRate={krwRate}
            leverage={leverage}
            onLeverageChange={setLeverage}
            onSelectSymbol={setSelectedSymbol}
            onBalanceChange={handleBalanceChange}
            refreshTrigger={refreshTrigger}
            scanStatus={{
              isScanning,
              tickersCount: tickersForScreening.length,
              screenedCount: screenedSymbols.length,
              signalsCount: activeSignals.length,
              lastScanTime,
            }}
            isTestnet={true}
          />
        </div>
      </div>
    </div>
  );
};

export default PaperTrading;
