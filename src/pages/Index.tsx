import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTradingLogs } from '@/hooks/useTradingLogs';
import { useAutoTrading } from '@/hooks/useAutoTrading';
import { useCoinScreening } from '@/hooks/useCoinScreening';
import { useTickerWebSocket } from '@/hooks/useTickerWebSocket';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useOrderBookWall } from '@/hooks/useOrderBookWall';
import { supabase } from '@/integrations/supabase/client';
import DualChartPanel from '@/components/DualChartPanel';
import AutoTradingPanel from '@/components/AutoTradingPanel';
import ApiKeySetup from '@/components/ApiKeySetup';
import { toast } from 'sonner';

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
  const { dailyStats, logTrade, fetchDailyStats } = useTradingLogs();
  const { tickers } = useTickerWebSocket();
  
  // 청산 후 즉시 잔고 갱신
  const handleTradeComplete = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
    fetchDailyStats(); // DB에서 당일 통계 다시 로드
  }, [fetchDailyStats]);
  
  // 초기 통계를 dailyStats에서 가져옴
  const initialStats = {
    trades: dailyStats.tradeCount,
    wins: dailyStats.winCount,
    losses: dailyStats.lossCount,
    totalPnL: dailyStats.totalPnL,
  };
  
  // 자동매매 훅
  const autoTrading = useAutoTrading({
    balanceUSD,
    leverage,
    krwRate,
    onTradeComplete: handleTradeComplete,
    initialStats,
    logTrade,
  });
  
  // 자동매매 중 절전 방지 (백그라운드 탭에서도 안정적 동작)
  useWakeLock(autoTrading.state.isEnabled);
  
  // 오더북 벽 분석 (100ms 실시간)
  const currentWallSymbol = autoTrading.state.pendingSignal?.symbol || autoTrading.state.currentPosition?.symbol || null;
  const { shouldBlockLongEntry, shouldBlockShortEntry } = useOrderBookWall(currentWallSymbol, autoTrading.state.isEnabled);

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
  const { activeSignals, isScanning } = useCoinScreening(tickersForScreening);
  
  // 이전 시그널 추적 (중복 진입 방지)
  const prevSignalsRef = useRef<Set<string>>(new Set());
  const justEnabledRef = useRef(false);
  
  // 자동매매 켜질 때 기존 시그널 무시하도록 처리
  useEffect(() => {
    if (autoTrading.state.isEnabled) {
      // 자동매매 켜지면 현재 시그널들을 "이미 본 것"으로 처리
      justEnabledRef.current = true;
      const currentSignalKeys = new Set(activeSignals.map(s => `${s.symbol}-${s.direction}`));
      prevSignalsRef.current = currentSignalKeys;
      
      // 2초 후부터 새 시그널 감지 시작
      const timer = setTimeout(() => {
        justEnabledRef.current = false;
      }, 2000);
      return () => clearTimeout(timer);
    } else {
      prevSignalsRef.current = new Set();
    }
  }, [autoTrading.state.isEnabled]);
  
  // 기술적 분석 시그널 감지 시 자동매매 트리거
  useEffect(() => {
    if (!autoTrading.state.isEnabled) return;
    if (justEnabledRef.current) return; // 방금 켜졌으면 대기
    if (activeSignals.length === 0) return;
    
    // 포지션 보유 중이거나 대기 중이면 새 시그널 무시
    if (autoTrading.state.currentPosition) return;
    if (autoTrading.state.pendingSignal) return;
    
    // 새로운 시그널만 처리
    const currentSignalKeys = new Set(activeSignals.map(s => `${s.symbol}-${s.direction}`));
    
    for (const signal of activeSignals) {
      const signalKey = `${signal.symbol}-${signal.direction}`;
      
      // 이미 처리한 시그널이면 무시
      if (prevSignalsRef.current.has(signalKey)) continue;
      
      // medium 이상만 처리
      if (signal.strength === 'weak') continue;
      
      // 🆕 오더북 벽 필터 체크
      if (signal.direction === 'long') {
        const blockCheck = shouldBlockLongEntry();
        if (blockCheck.blocked) {
          console.log(`🚫 오더북 벽으로 롱 진입 차단: ${blockCheck.reason}`);
          toast.warning(`🚫 ${signal.symbol} 롱 차단: ${blockCheck.reason}`);
          continue;
        }
      } else {
        const blockCheck = shouldBlockShortEntry();
        if (blockCheck.blocked) {
          console.log(`🚫 오더북 벽으로 숏 진입 차단: ${blockCheck.reason}`);
          toast.warning(`🚫 ${signal.symbol} 숏 차단: ${blockCheck.reason}`);
          continue;
        }
      }
      
      console.log(`🔥 Technical signal: ${signal.symbol} ${signal.direction} (${signal.strength})`, signal.reasons.slice(0, 3));
      
      // 자동매매 진입 실행 (새로운 기술적 분석 시그널 사용)
      autoTrading.handleTechnicalSignal(
        signal.symbol,
        signal.direction,
        signal.price,
        signal.strength,
        signal.reasons,
        signal.indicators
      );
      
      // 진입한 종목으로 차트 전환
      setSelectedSymbol(signal.symbol);
      break; // 한 번에 하나만 처리
    }
    
    prevSignalsRef.current = currentSignalKeys;
  }, [activeSignals, autoTrading.state.isEnabled, autoTrading.state.currentPosition, autoTrading.state.pendingSignal, shouldBlockLongEntry, shouldBlockShortEntry]);
  
  // 포지션 보유 중이거나 대기 중일 때 해당 종목 차트 유지
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
    
    // 3단계 익절 시스템 사용
    autoTrading.checkTpSl(ticker.price);
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
    
  // 손절/익절 예정 가격 계산
  const position = autoTrading.state.currentPosition;
  const stopLossPrice = position ? (
    position.side === 'long'
      ? position.entryPrice * (1 - (leverage >= 10 ? 0.004 : leverage >= 5 ? 0.006 : 0.01))  // 레버리지별 SL%
      : position.entryPrice * (1 + (leverage >= 10 ? 0.004 : leverage >= 5 ? 0.006 : 0.01))
  ) : undefined;
  
  const takeProfitPrice = position ? (
    position.side === 'long'
      ? position.entryPrice * (1 + 0.003)  // 1단계 익절 +0.3%
      : position.entryPrice * (1 - 0.003)
  ) : undefined;
  
  const takeProfit2Price = position ? (
    position.side === 'long'
      ? position.entryPrice * (1 + 0.008)  // 2단계 익절 +0.8%
      : position.entryPrice * (1 - 0.008)
  ) : undefined;
  
  const takeProfit3Price = position ? (
    position.side === 'long'
      ? position.entryPrice * (1 + 0.015)  // 3단계 익절 +1.5%
      : position.entryPrice * (1 - 0.015)
  ) : undefined;

  return (
    <div className="min-h-screen bg-background p-2">
      <div className="max-w-[1920px] mx-auto">
        <div className="grid grid-cols-12 gap-2 items-stretch">
          {/* Left - Chart */}
          <div className="col-span-12 lg:col-span-7 xl:col-span-8 order-2 lg:order-1">
            <DualChartPanel 
              symbol={selectedSymbol} 
              hasPosition={!!autoTrading.state.currentPosition}
              entryPrice={autoTrading.state.currentPosition?.entryPrice}
              stopLossPrice={stopLossPrice}
              takeProfitPrice={takeProfitPrice}
              takeProfit2Price={takeProfit2Price}
              takeProfit3Price={takeProfit3Price}
              positionSide={autoTrading.state.currentPosition?.side}
              onSelectSymbol={setSelectedSymbol}
            />
          </div>

          {/* Right - System Trading Panel */}
          <div className="col-span-12 lg:col-span-5 xl:col-span-4 order-1 lg:order-2 flex">
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
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
