import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTradingLogs } from '@/hooks/useTradingLogs';
import { useLimitOrderTrading } from '@/hooks/useLimitOrderTrading';
import { useCoinScreening } from '@/hooks/useCoinScreening';
import { useTickerWebSocket } from '@/hooks/useTickerWebSocket';
import { useWakeLock } from '@/hooks/useWakeLock';
import { supabase } from '@/integrations/supabase/client';
import DualChartPanel from '@/components/DualChartPanel';
import AutoTradingPanel, { ScalpingIndicator } from '@/components/AutoTradingPanel';
import ApiKeySetup from '@/components/ApiKeySetup';
import TradingSettingsPanel from '@/components/TradingSettingsPanel';
import TradingLogsPanel from '@/components/TradingLogsPanel';
import { Button } from '@/components/ui/button';
import { FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
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
  
  // 트레이딩 설정 상태 (테스트넷과 동일)
  const [adxFilterEnabled, setAdxFilterEnabled] = useState(true);
  const [volumeFilterEnabled, setVolumeFilterEnabled] = useState(true);
  const [rsiFilterEnabled, setRsiFilterEnabled] = useState(true);
  const [macdFilterEnabled, setMacdFilterEnabled] = useState(true);
  const [bollingerFilterEnabled, setBollingerFilterEnabled] = useState(true);
  const [adxThreshold, setAdxThreshold] = useState(LIMIT_ORDER_CONFIG.SIGNAL.MIN_ADX);
  const [stopLossKrw, setStopLossKrw] = useState(10000);
  const [takeProfitKrw, setTakeProfitKrw] = useState(LIMIT_ORDER_CONFIG.TAKE_PROFIT.MIN_PROFIT_KRW);
  
  // 미체결 주문 상태 (차트에 표시용)
  const [openOrders, setOpenOrders] = useState<{ orderId: number; price: number; side: 'BUY' | 'SELL'; origQty: number; executedQty: number; }[]>([]);

  // 스크리닝 로그 실시간 업데이트
  useEffect(() => {
    const interval = setInterval(() => {
      setScreeningLogs(getScreeningLogs());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { dailyStats, dbTradeLogs, logTrade, fetchDailyStats } = useTradingLogs({ isTestnet: false });
  
  // Only connect WebSocket when user is authenticated and API keys are ready
  const shouldConnectWebSocket = !!user && hasApiKeys === true;
  const { tickers } = useTickerWebSocket(shouldConnectWebSocket, { isTestnet: false });
  
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
    onTradeComplete: handleTradeComplete,
    initialStats,
    logTrade,
    isTestnet: false,
    majorCoinMode,
    filterSettings: {
      adxEnabled: adxFilterEnabled,
      volumeEnabled: volumeFilterEnabled,
      rsiEnabled: rsiFilterEnabled,
      macdEnabled: macdFilterEnabled,
      bollingerEnabled: bollingerFilterEnabled,
      adxThreshold,
      stopLossKrw,
      takeProfitKrw,
    },
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
  const { activeSignals, isScanning, isPaused, screenedSymbols, lastScanTime, passSignal, togglePause } = useCoinScreening(tickersForScreening, {}, majorCoinMode);

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
  
  // 시그널 감지 시 차트 종목만 변경 (자동 진입은 수동으로)
  useEffect(() => {
    if (!autoTrading.state.isEnabled) return;
    if (justEnabledRef.current) return;
    if (activeSignals.length === 0) return;
    if (autoTrading.state.currentPosition) return;

    // 가장 강한 시그널의 종목으로 차트 변경
    const strongSignal = activeSignals.find(s => s.strength !== 'weak');
    if (strongSignal) {
      setSelectedSymbol(strongSignal.symbol);
    }
  }, [activeSignals, autoTrading.state.isEnabled, autoTrading.state.currentPosition]);
  
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
    
  // 손절/익절 가격 계산 (원화 기반)
  const position = autoTrading.state.currentPosition;
  const calculateSlTpPrices = () => {
    if (!position) return { stopLossPrice: undefined, takeProfitPrice: undefined };
    
    const entryPrice = position.avgPrice;
    const qty = position.totalQuantity;
    const positionValueUsd = entryPrice * qty;
    
    // 원화 손익을 USD로 변환
    const slUsd = stopLossKrw / krwRate;
    const tpUsd = takeProfitKrw / krwRate;
    
    // 손익 퍼센트 계산
    const slPercent = (slUsd / positionValueUsd) * 100;
    const tpPercent = (tpUsd / positionValueUsd) * 100;
    
    // 가격 계산
    let slPrice: number;
    let tpPrice: number;
    
    if (position.side === 'long') {
      slPrice = entryPrice * (1 - slPercent / 100 / leverage);
      tpPrice = entryPrice * (1 + tpPercent / 100 / leverage);
    } else {
      slPrice = entryPrice * (1 + slPercent / 100 / leverage);
      tpPrice = entryPrice * (1 - tpPercent / 100 / leverage);
    }
    
    return { stopLossPrice: slPrice, takeProfitPrice: tpPrice };
  };
  
  const { stopLossPrice, takeProfitPrice } = calculateSlTpPrices();

  return (
    <div className="h-screen bg-background p-1 overflow-hidden flex flex-col">
      {/* Real Trading Header */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-border/50 mb-1">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded bg-green-500/20 border border-green-500/50">
            <span className="text-sm font-bold text-green-400 tracking-wider">💰 實戰交易</span>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/paper-trading')}
          className="gap-1 h-7 px-2 border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
        >
          <FlaskConical className="h-3 w-3" />
          모의거래
        </Button>
      </div>

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
            isTestnet={false}
            majorCoinMode={majorCoinMode}
            onToggleMajorCoinMode={() => setMajorCoinMode(prev => !prev)}
            onToggleAiAnalysis={autoTrading.toggleAiAnalysis}
            viewingSymbol={selectedSymbol}
            onOpenOrdersChange={setOpenOrders}
          />
        </div>

        {/* Right - Settings Panel */}
        <div className="col-span-2 flex flex-col min-h-0 overflow-auto gap-1">
          <TradingSettingsPanel
            adxFilterEnabled={adxFilterEnabled}
            onToggleAdxFilter={setAdxFilterEnabled}
            volumeFilterEnabled={volumeFilterEnabled}
            onToggleVolumeFilter={setVolumeFilterEnabled}
            rsiFilterEnabled={rsiFilterEnabled}
            onToggleRsiFilter={setRsiFilterEnabled}
            macdFilterEnabled={macdFilterEnabled}
            onToggleMacdFilter={setMacdFilterEnabled}
            bollingerFilterEnabled={bollingerFilterEnabled}
            onToggleBollingerFilter={setBollingerFilterEnabled}
            adxThreshold={adxThreshold}
            onAdxThresholdChange={setAdxThreshold}
            stopLossKrw={stopLossKrw}
            onStopLossChange={setStopLossKrw}
            takeProfitKrw={takeProfitKrw}
            onTakeProfitChange={setTakeProfitKrw}
            isAutoTradingEnabled={autoTrading.state.isEnabled}
          />
          <TradingLogsPanel
            dbTradeLogs={dbTradeLogs}
            krwRate={krwRate}
            isEnabled={autoTrading.state.isEnabled}
            onSelectSymbol={setSelectedSymbol}
          />
          <ScalpingIndicator 
            statusMessage={autoTrading.state.statusMessage}
            hasPosition={!!autoTrading.state.currentPosition}
            hasPendingSignal={!!autoTrading.state.pendingSignal}
            isEnabled={autoTrading.state.isEnabled}
          />
        </div>
      </div>
    </div>
  );
};

export default Index;