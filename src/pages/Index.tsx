import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
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
  const [screeningLogs, setScreeningLogs] = useState<ScreeningLog[]>([]);
  
  const [dtfxEnabled, setDtfxEnabled] = useState(false); // DTFX 차트 표시 토글
  const [takeProfitUsdt, setTakeProfitUsdt] = useState(2.0); // 기본 2.0 USDT 익절
  
  // 미체결 주문 상태 (차트에 표시용)
  const [openOrders, setOpenOrders] = useState<{ orderId: number; price: number; side: 'BUY' | 'SELL'; origQty: number; executedQty: number; }[]>([]);
  
  // 수동 손절가 상태 (차트에서 드래그로 설정)
  const [manualSlPrice, setManualSlPrice] = useState<number | null>(null);
  
  // 수동 익절가 상태 (차트에서 드래그로 설정)
  const [manualTpPrice, setManualTpPrice] = useState<number | null>(null);
  
  // 차트 TP 모드 (ON: 차트에서 직접 설정, OFF: USDT 기반 자동)
  const [chartTpEnabled, setChartTpEnabled] = useState(false);
  
  // 잔고 퍼센트 매수 상태
  const [balancePercent, setBalancePercent] = useState<10 | 20 | 25 | 50 | 60 | 98>(98);
  const [majorCoinMode, setMajorCoinMode] = useState(true); // 메이저/Altcoin 모드 토글

  // 스크리닝 로그 실시간 업데이트
  useEffect(() => {
    const interval = setInterval(() => {
      setScreeningLogs(getScreeningLogs());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  
  // Only connect WebSocket when user is authenticated and API keys are ready
  const shouldConnectWebSocket = !!user && hasApiKeys === true;
  const { tickers } = useTickerWebSocket(shouldConnectWebSocket);
  
  // 🚀 User Data Stream - 실시간 포지션/잔고 업데이트 (바이낸스 앱 수준 속도)
  const userDataStream = useUserDataStream();
  
  // 청산 후 즉시 잔고 갱신
  const handleTradeComplete = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);
  
  // 지정가 매매 훅 (실거래)
  const autoTrading = useLimitOrderTrading({
    balanceUSD,
    leverage,
    krwRate,
    viewingSymbol: selectedSymbol,
    onTradeComplete: handleTradeComplete,
    filterSettings: {
      takeProfitUsdt,
      chartTpEnabled, // 차트 TP 모드 활성화
      manualTpPrice, // 차트에서 설정한 익절가
      manualSlPrice, // 차트에서 설정한 손절가
    },
  });
  
  // 🔔 외부 청산 감지/정리는 매매 훅 내부(실제 포지션 조회)에서 처리함
  // - User Data Stream은 일시적으로 포지션이 비어 보이는 타이밍이 있어 오탐 가능

  // 자동매매 중 절전 방지
  useWakeLock(autoTrading.state.isEnabled);

  // 종목 스크리닝용 티커 데이터 준비 (메이저 코인만 전달)
  const tickersForScreening = tickers
    .filter(c => c.price >= 0.01 && c.volume >= 20_000_000)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 80)
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
  
  // 수동 손절가 변경 핸들러 (포지션 있을 때만 실제 주문 반영 + 방향별 유효성 검증)
  const handleManualSlPriceChange = useCallback((price: number | null) => {
    const position = autoTrading.state.currentPosition;
    const hasPos = !!position;
    
    // 포지션이 있을 때 방향별 유효성 검증
    if (hasPos && price !== null && position) {
      const entryPrice = position.avgPrice;
      
      // 롱포지션: SL은 진입가 아래만 허용
      if (position.side === 'long' && price >= entryPrice) {
        toast.error('⚠️ 롱 포지션은 진입가 아래에 손절을 설정하세요', {
          description: `진입가: $${entryPrice.toFixed(4)} | 클릭: $${price.toFixed(4)}`,
          duration: 2000,
        });
        return; // 설정 무시
      }
      
      // 숏포지션: SL은 진입가 위만 허용
      if (position.side === 'short' && price <= entryPrice) {
        toast.error('⚠️ 숏 포지션은 진입가 위에 손절을 설정하세요', {
          description: `진입가: $${entryPrice.toFixed(4)} | 클릭: $${price.toFixed(4)}`,
          duration: 2000,
        });
        return; // 설정 무시
      }
    }
    
    console.log(`🛡️ [ManualSL] 손절가 변경: ${price ? `$${price.toFixed(6)}` : 'null'} | 포지션: ${hasPos ? '있음' : '없음(연습)'}`);
    
    setManualSlPrice(price);
    // 토스트 알림만 (실제 청산은 checkTpSl에서 로컬 모니터링)
    if (hasPos) {
      autoTrading.setManualStopLoss(price);
    }
  }, [autoTrading.setManualStopLoss, autoTrading.state.currentPosition]);
  
  // 수동 익절가 변경 핸들러 (포지션 있을 때만 실제 주문 반영 + 방향별 유효성 검증)
  const handleManualTpPriceChange = useCallback((price: number | null) => {
    const position = autoTrading.state.currentPosition;
    const hasPos = !!position;
    
    // 포지션이 있을 때 방향별 유효성 검증
    if (hasPos && price !== null && position) {
      const entryPrice = position.avgPrice;
      
      // 롱포지션: TP는 진입가 위만 허용
      if (position.side === 'long' && price <= entryPrice) {
        toast.error('⚠️ 롱 포지션은 진입가 위에 익절을 설정하세요', {
          description: `진입가: $${entryPrice.toFixed(4)} | 클릭: $${price.toFixed(4)}`,
          duration: 2000,
        });
        return;
      }
      
      // 숏포지션: TP는 진입가 아래만 허용
      if (position.side === 'short' && price >= entryPrice) {
        toast.error('⚠️ 숏 포지션은 진입가 아래에 익절을 설정하세요', {
          description: `진입가: $${entryPrice.toFixed(4)} | 클릭: $${price.toFixed(4)}`,
          duration: 2000,
        });
        return;
      }
    }
    
    console.log(`🎯 [ManualTP] 익절가 변경: ${price ? `$${price.toFixed(6)}` : 'null'} | 포지션: ${hasPos ? '있음' : '없음(연습)'}`);
    
    setManualTpPrice(price);
    // 토스트 알림만 (실제 청산은 checkTpSl에서 로컬 모니터링)
    if (hasPos) {
      autoTrading.setManualTakeProfit(price);
    }
  }, [autoTrading.setManualTakeProfit, autoTrading.state.currentPosition]);
  
  // 포지션 청산 시 손절가/익절가 초기화 (포지션이 있다가 없어졌을 때만)
  const prevPositionRef = useRef(autoTrading.state.currentPosition);
  useEffect(() => {
    const hadPosition = prevPositionRef.current;
    const hasPosition = autoTrading.state.currentPosition;
    prevPositionRef.current = hasPosition;
    
    // 포지션이 있다가 없어졌을 때만 초기화
    if (hadPosition && !hasPosition) {
      if (manualSlPrice !== null) setManualSlPrice(null);
      if (manualTpPrice !== null) setManualTpPrice(null);
    }
  }, [autoTrading.state.currentPosition, manualSlPrice, manualTpPrice]);

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
    
  // 익절 가격 계산 (USDT 손익 기준) - 손절 기능 완전 제거
  const position = autoTrading.state.currentPosition;
  const calculateTpPrice = () => {
    if (!position) return undefined;
    
    const entryPrice = position.avgPrice;
    const qty = position.totalQuantity;
    const positionValueUsd = entryPrice * qty;
    
    // 익절은 USDT 기반
    const tpPercent = (takeProfitUsdt / positionValueUsd) * 100;
    if (position.side === 'long') {
      return entryPrice * (1 + tpPercent / 100);
    } else {
      return entryPrice * (1 - tpPercent / 100);
    }
  };
  
  const takeProfitPrice = calculateTpPrice();

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
            takeProfitPrice={!chartTpEnabled ? takeProfitPrice : undefined}
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
            manualSlPrice={manualSlPrice}
            onManualSlPriceChange={handleManualSlPriceChange}
            manualTpPrice={chartTpEnabled ? manualTpPrice : null}
            onManualTpPriceChange={chartTpEnabled ? handleManualTpPriceChange : undefined}
            chartTpEnabled={chartTpEnabled}
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
            aiEnabled={autoTrading.state.aiEnabled}
            isAiAnalyzing={autoTrading.state.isAiAnalyzing}
            onToggleAiAnalysis={autoTrading.toggleAiAnalysis}
            krwRate={krwRate}
            refreshTrigger={refreshTrigger}
            currentSymbol={selectedSymbol}
            majorCoinMode={majorCoinMode}
            onToggleMajorCoinMode={() => setMajorCoinMode(prev => !prev)}
          />
          <TradingSettingsPanel
            dtfxEnabled={dtfxEnabled}
            onToggleDtfx={setDtfxEnabled}
            takeProfitUsdt={takeProfitUsdt}
            onTakeProfitChange={setTakeProfitUsdt}
            isAutoTradingEnabled={autoTrading.state.isEnabled}
            chartTpEnabled={chartTpEnabled}
            onChartTpToggle={(enabled) => {
              setChartTpEnabled(enabled);
              // 차트 TP 모드 끄면 수동 TP도 초기화
              if (!enabled && manualTpPrice !== null) {
                setManualTpPrice(null);
                // 기존 TP 주문 취소 (null 전달하면 취소됨)
                autoTrading.setManualTakeProfit(null);
              }
            }}
            manualTpPrice={manualTpPrice}
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