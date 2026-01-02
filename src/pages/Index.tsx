import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTradingLogs } from '@/hooks/useTradingLogs';
import { useLimitOrderTrading } from '@/hooks/useLimitOrderTrading';
import { useCoinScreening } from '@/hooks/useCoinScreening';
import { useTickerWebSocket } from '@/hooks/useTickerWebSocket';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useUserDataStream } from '@/hooks/useUserDataStream';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import DualChartPanel from '@/components/DualChartPanel';
import AutoTradingPanel from '@/components/AutoTradingPanel';
import ApiKeySetup from '@/components/ApiKeySetup';
import TradingSettingsPanel from '@/components/TradingSettingsPanel';
import SignalScannerPanel from '@/components/SignalScannerPanel';
import ScalpingRatingPanel from '@/components/ScalpingRatingPanel';
import WatchlistPanel from '@/components/WatchlistPanel';
import { Button } from '@/components/ui/button';


import { getScreeningLogs, ScreeningLog } from '@/components/ScreeningLogPanel';
import { LIMIT_ORDER_CONFIG } from '@/lib/limitOrderConfig';

const Index = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [hasApiKeys, setHasApiKeys] = useState<boolean | null>(null);
  const [checkingKeys, setCheckingKeys] = useState(true);
  const [balanceUSD, setBalanceUSD] = useState(0);
  const [krwRate, setKrwRate] = useState(1380);
  const [leverage, setLeverage] = useState(LIMIT_ORDER_CONFIG.LEVERAGE);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [majorCoinMode, setMajorCoinMode] = useState(true);
  const [screeningLogs, setScreeningLogs] = useState<ScreeningLog[]>([]);
  
  const [dtfxEnabled, setDtfxEnabled] = useState(false); // DTFX 차트 표시 토글
  const [stopLossUsdt, setStopLossUsdt] = useState(1.5); // 기본 1.5 USDT 손절 (한틱손절 방지)
  const [takeProfitUsdt, setTakeProfitUsdt] = useState(2.0); // 기본 2.0 USDT 익절
  
  // 미체결 주문 상태 (차트에 표시용)
  const [openOrders, setOpenOrders] = useState<{ orderId: number; price: number; side: 'BUY' | 'SELL'; origQty: number; executedQty: number; }[]>([]);
  
  // 잔고 퍼센트 매수 상태
  const [balancePercent, setBalancePercent] = useState<10 | 20 | 25 | 50 | 60 | 98>(98);

  // 스크리닝 로그 실시간 업데이트
  useEffect(() => {
    const interval = setInterval(() => {
      setScreeningLogs(getScreeningLogs());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { dailyStats, dbTradeLogs, logTrade, fetchDailyStats } = useTradingLogs();
  
  // Only connect WebSocket when user is authenticated and API keys are ready
  const shouldConnectWebSocket = !!user && hasApiKeys === true;
  const { tickers } = useTickerWebSocket(shouldConnectWebSocket);
  
  // 🚀 User Data Stream - 실시간 포지션/잔고 업데이트 (바이낸스 앱 수준 속도)
  const userDataStream = useUserDataStream();
  
  // 청산 후 즉시 잔고 갱신
  const handleTradeComplete = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
    fetchDailyStats();
  }, [fetchDailyStats]);
  
  // 초기 통계
  const initialStats = {
    trades: dailyStats.tradeCount,
    wins: dailyStats.winCount,
    losses: dailyStats.lossCount,
    totalPnL: dailyStats.totalPnL,
  };
  
  // 지정가 매매 훅 (실거래)
  const autoTrading = useLimitOrderTrading({
    balanceUSD,
    leverage,
    krwRate,
    viewingSymbol: selectedSymbol,
    onTradeComplete: handleTradeComplete,
    initialStats,
    logTrade,
    majorCoinMode,
    filterSettings: {
      stopLossUsdt,
      takeProfitUsdt,
    },
  });
  
  // 🔔 외부 청산 감지 (바이낸스 앱 등에서 직접 청산 시)
  const prevPositionSymbolRef = useRef<string | null>(null);
  
  useEffect(() => {
    if (!userDataStream.isConnected) return;
    
    const currentLocalPosition = autoTrading.state.currentPosition;
    const posSymbol = currentLocalPosition?.symbol;
    
    // 로컬에서 포지션 추적 중인 경우
    if (posSymbol) {
      prevPositionSymbolRef.current = posSymbol;
      
      // User Data Stream에서 해당 심볼 포지션 확인
      const streamPosition = userDataStream.getPosition(posSymbol);
      
      // 로컬엔 있는데 스트림에서 사라졌으면 → 외부 청산!
      if (!streamPosition && currentLocalPosition?.entryPhase === 'active') {
        console.log(`🚨 [외부 청산 감지] ${posSymbol} 포지션이 외부에서 청산됨!`);
        toast.warning(`📢 ${posSymbol} 외부 청산 감지`, {
          description: '바이낸스 앱 또는 다른 곳에서 포지션이 청산되었습니다.',
          duration: 5000,
        });
        
        // 내부 상태 초기화 (closePosition 호출 시 실제 청산 시도하므로 상태만 정리)
        handleTradeComplete();
      }
    }
    
    // 이전 포지션 심볼이 있고, 지금 로컬 포지션이 없는데 스트림에도 없으면 청산 완료
    if (prevPositionSymbolRef.current && !currentLocalPosition) {
      const prevSymbol = prevPositionSymbolRef.current;
      const streamPosition = userDataStream.getPosition(prevSymbol);
      
      if (!streamPosition) {
        prevPositionSymbolRef.current = null;
      }
    }
  }, [userDataStream.lastEventTime, userDataStream.isConnected, autoTrading.state.currentPosition, handleTradeComplete]);
  
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
  const { activeSignals, isScanning, isPaused, screenedSymbols, lastScanTime, passSignal: passSignalRaw, togglePause } = useCoinScreening(tickersForScreening, {}, majorCoinMode);
  
  // 핫코인 심볼 리스트 (DTFX 스캐너용) - 시그널 스캐너 필터 통과한 코인들만
  const hotCoinSymbols = useMemo(() => 
    screenedSymbols.map(s => s.symbol),
    [screenedSymbols]
  );
  
  // 패스 시 다음 시그널로 차트 전환
  const passSignal = () => {
    const nextSymbol = passSignalRaw();
    if (nextSymbol) {
      setSelectedSymbol(nextSymbol);
    }
  };

  // 시그널 감지 시 차트 종목만 변경 (자동 진입 없음)
  useEffect(() => {
    if (activeSignals.length === 0) return;
    if (autoTrading.state.currentPosition) return;

    // 가장 강한 시그널의 종목으로 차트 변경만
    const strongSignal = activeSignals.find(s => s.strength !== 'weak');
    if (strongSignal) {
      setSelectedSymbol(strongSignal.symbol);
    }
  }, [activeSignals, autoTrading.state.currentPosition]);
  
  // 포지션 보유 중일 때 해당 종목 차트 유지
  useEffect(() => {
    if (autoTrading.state.currentPosition) {
      setSelectedSymbol(autoTrading.state.currentPosition.symbol);
    }
  }, [autoTrading.state.currentPosition?.symbol]);
  // 현재 가격으로 TP/SL 체크
  useEffect(() => {
    const ticker = tickers.find(t => t.symbol === selectedSymbol);
    if (!ticker) return;
    
    // 포지션 있으면 TP/SL 체크
    if (autoTrading.state.currentPosition) {
      const position = autoTrading.state.currentPosition;
      const posTicker = tickers.find(t => t.symbol === position.symbol);
      if (posTicker) {
        autoTrading.checkTpSl(posTicker.price);
      }
    }
  }, [tickers, selectedSymbol, autoTrading.state.currentPosition, autoTrading.state.isEnabled]);

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
    autoTrading.closePosition();
  };
  
  // 진입 취소 핸들러
  const handleCancelEntry = () => {
    autoTrading.cancelEntry();
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
  
  // 현재 가격
  const currentAutoPrice = autoTrading.state.currentPosition
    ? tickers.find(t => t.symbol === autoTrading.state.currentPosition?.symbol)?.price || 0
    : 0;
    
  // 손절/익절 가격 계산 (USDT 손익 기준)
  const position = autoTrading.state.currentPosition;
  const calculateSlTpPrices = () => {
    if (!position) return { stopLossPrice: undefined, takeProfitPrice: undefined };
    
    const entryPrice = position.avgPrice;
    const qty = position.totalQuantity;
    const positionValueUsd = entryPrice * qty;
    
    // USDT 손익 → 가격 변동률 계산
    // 레버리지는 이미 qty에 반영됨 (balanceUSD * leverage / price = qty)
    // 따라서 가격 변동 = 손익USDT / 포지션명목가치
    const slPercent = (stopLossUsdt / positionValueUsd) * 100;
    const tpPercent = (takeProfitUsdt / positionValueUsd) * 100;
    
    let slPrice: number;
    let tpPrice: number;
    
    if (position.side === 'long') {
      slPrice = entryPrice * (1 - slPercent / 100);
      tpPrice = entryPrice * (1 + tpPercent / 100);
    } else {
      slPrice = entryPrice * (1 + slPercent / 100);
      tpPrice = entryPrice * (1 - tpPercent / 100);
    }
    
    return { stopLossPrice: slPrice, takeProfitPrice: tpPrice };
  };
  
  const { stopLossPrice, takeProfitPrice } = calculateSlTpPrices();

  return (
    <div className="h-screen bg-background p-1 overflow-hidden flex flex-col">

      {/* Main Content - iPad Mini 7 (768x1024) 최적화 */}
      <div className="flex-1 min-h-0 grid grid-cols-10 gap-1">
        {/* Left - Chart */}
        <div className="col-span-5 flex flex-col min-h-0">
          <DualChartPanel 
            symbol={selectedSymbol} 
            hasPosition={!!autoTrading.state.currentPosition}
            entryPrice={autoTrading.state.currentPosition?.avgPrice}
            stopLossPrice={stopLossPrice}
            takeProfitPrice={takeProfitPrice}
            positionSide={autoTrading.state.currentPosition?.side}
            onSelectSymbol={setSelectedSymbol}
            screeningLogs={screeningLogs}
            entryPoints={autoTrading.state.currentPosition?.entries?.map(e => ({
              price: e.price,
              quantity: e.quantity,
              timestamp: e.timestamp,
            })) || []}
            openOrders={openOrders}
            dtfxEnabled={dtfxEnabled}
          />
        </div>

        {/* Middle - Trading Panel */}
        <div className="col-span-3 flex flex-col min-h-0 overflow-auto gap-1">
          <AutoTradingPanel
            state={autoTrading.state}
            onToggle={autoTrading.toggleAutoTrading}
            onManualClose={handleManualClose}
            onCancelEntry={handleCancelEntry}
            onMarketEntry={autoTrading.manualMarketEntry}
            onLimitEntry={autoTrading.manualLimitEntry}
            currentPrice={currentAutoPrice}
            krwRate={krwRate}
            leverage={leverage}
            onLeverageChange={setLeverage}
            balancePercent={balancePercent}
            onBalancePercentChange={setBalancePercent}
            onSelectSymbol={setSelectedSymbol}
            onBalanceChange={handleBalanceChange}
            refreshTrigger={refreshTrigger}
            scanStatus={{
              isScanning,
              isPaused,
              tickersCount: tickersForScreening.length,
              screenedCount: screenedSymbols.length,
              signalsCount: activeSignals.length,
              lastScanTime,
            }}
            onPassSignal={passSignal}
            onTogglePause={togglePause}
            majorCoinMode={majorCoinMode}
            onToggleMajorCoinMode={() => setMajorCoinMode(prev => !prev)}
            onToggleAiAnalysis={autoTrading.toggleAiAnalysis}
            onAnalyzeAI={autoTrading.manualAnalyzeMarket}
            viewingSymbol={selectedSymbol}
            onOpenOrdersChange={setOpenOrders}
            onConfirmDTFXEntry={autoTrading.confirmDTFXEntry}
            onSkipDTFXSignal={autoTrading.skipDTFXSignal}
            userDataStream={userDataStream}
          />
        </div>

        {/* Right - Settings Panel */}
        <div className="col-span-2 flex flex-col min-h-0 overflow-y-auto gap-1 max-h-[calc(100vh-2rem)]">
          <SignalScannerPanel
            isEnabled={autoTrading.state.isEnabled}
            isProcessing={autoTrading.state.isProcessing}
            onToggle={autoTrading.toggleAutoTrading}
            leverage={leverage}
            onLeverageChange={setLeverage}
            balancePercent={balancePercent}
            onBalancePercentChange={setBalancePercent}
            majorCoinMode={majorCoinMode}
            onToggleMajorCoinMode={() => setMajorCoinMode(prev => !prev)}
            aiEnabled={autoTrading.state.aiEnabled}
            isAiAnalyzing={autoTrading.state.isAiAnalyzing}
            onToggleAiAnalysis={autoTrading.toggleAiAnalysis}
            krwRate={krwRate}
            refreshTrigger={refreshTrigger}
            currentSymbol={selectedSymbol}
          />
          <TradingSettingsPanel
            dtfxEnabled={dtfxEnabled}
            onToggleDtfx={setDtfxEnabled}
            stopLossUsdt={stopLossUsdt}
            onStopLossChange={setStopLossUsdt}
            takeProfitUsdt={takeProfitUsdt}
            onTakeProfitChange={setTakeProfitUsdt}
            isAutoTradingEnabled={autoTrading.state.isEnabled}
          />
          <ScalpingRatingPanel />
          <WatchlistPanel 
            currentSymbol={selectedSymbol}
            onSelectSymbol={setSelectedSymbol}
          />
        </div>
      </div>
    </div>
  );
};

export default Index;