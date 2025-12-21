/**
 * ⚡ 지정가 기반 빠른 회전 매매 훅 v1.0
 * 
 * 특징:
 * 1. 10분할 지정가 진입 (수수료 절감)
 * 2. 10초 타임아웃 필터
 * 3. 5분할 지정가 익절
 * 4. 3초 내 시장가 청산
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useBinanceApi } from './useBinanceApi';
import { useAuth } from './useAuth';
import { useMarketAnalysis } from './useMarketAnalysis';
import { TechnicalIndicators, checkLongSignal, checkShortSignal, calculateAllIndicators } from './useTechnicalIndicators';
import { initAudio, playEntrySound, playTpSound, playSlSound } from '@/lib/sounds';
import { fetchSymbolPrecision, roundQuantity, roundPrice } from '@/lib/binance';
import {
  LIMIT_ORDER_CONFIG,
  LimitOrderEntry,
  LimitOrderPosition,
  generateEntryPrices,
  calculateFillRatio,
  calculateAvgFillPrice,
  calculatePnLPercent,
  calculateStopLossPrice,
  shouldStopLoss,
  shouldTimeStop,
} from '@/lib/limitOrderConfig';

// 1분봉 조회
const fetch1mKlines = async (symbol: string, limit: number = 10) => {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=${limit}`);
    const data = await res.json();
    return data.map((k: any) => ({
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch { return null; }
};

const fetch5mKlines = async (symbol: string, limit: number = 50) => {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=5m&limit=${limit}`);
    const data = await res.json();
    return data.map((k: any) => ({
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch { return null; }
};

// ===== 타입 정의 =====
export interface LimitOrderTradeLog {
  id: string;
  timestamp: number;
  symbol: string;
  action: 'order' | 'fill' | 'cancel' | 'tp' | 'sl' | 'timeout' | 'error';
  side: 'long' | 'short';
  price: number;
  quantity: number;
  pnl?: number;
  reason?: string;
}

export interface PendingSignal {
  symbol: string;
  direction: 'long' | 'short';
  strength: 'weak' | 'medium' | 'strong';
  reasons: string[];
  signalTime: number;
  signalPrice: number;
  indicators: TechnicalIndicators;
}

export interface LimitOrderTradingState {
  isEnabled: boolean;
  isProcessing: boolean;
  currentSymbol: string | null;
  pendingSignal: PendingSignal | null;
  currentPosition: LimitOrderPosition | null;
  todayStats: {
    trades: number;
    wins: number;
    losses: number;
    totalPnL: number;
  };
  tradeLogs: LimitOrderTradeLog[];
  statusMessage: string;
  scanningProgress: string;
  aiAnalysis: any | null;
  isAiAnalyzing: boolean;
  aiEnabled: boolean;
  // 진입 상태
  entryOrderIds: string[];
  entryStartTime: number | null;
}

interface UseLimitOrderTradingProps {
  balanceUSD: number;
  leverage: number;
  krwRate: number;
  onTradeComplete?: () => void;
  initialStats?: {
    trades: number;
    wins: number;
    losses: number;
    totalPnL: number;
  };
  logTrade?: (trade: {
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    leverage: number;
    pnlUsd: number;
  }) => void;
  majorCoinMode?: boolean;
  isTestnet?: boolean;
  // 필터 설정
  filterSettings?: {
    adxEnabled: boolean;
    volumeEnabled: boolean;
    rsiEnabled: boolean;
    macdEnabled: boolean;
    bollingerEnabled: boolean;
    adxThreshold: number;
    stopLossPercent: number;
    takeProfitKrw: number;
  };
}

// ===== 메인 훅 =====
export function useLimitOrderTrading({
  balanceUSD,
  leverage: _leverage,
  krwRate,
  onTradeComplete,
  initialStats,
  logTrade,
  majorCoinMode = true,
  isTestnet = false,
  filterSettings,
}: UseLimitOrderTradingProps) {
  const leverage = LIMIT_ORDER_CONFIG.LEVERAGE;

  const [state, setState] = useState<LimitOrderTradingState>({
    isEnabled: false,
    isProcessing: false,
    currentSymbol: null,
    pendingSignal: null,
    currentPosition: null,
    todayStats: initialStats || { trades: 0, wins: 0, losses: 0, totalPnL: 0 },
    tradeLogs: [],
    statusMessage: '🔄 지정가 매매 비활성화',
    scanningProgress: '',
    aiAnalysis: null,
    isAiAnalyzing: false,
    aiEnabled: true,
    entryOrderIds: [],
    entryStartTime: null,
  });

  const { user } = useAuth();
  const { 
    placeMarketOrder, 
    placeLimitOrder, 
    getPositions, 
    setLeverage,
    cancelAllOrders,
    getOpenOrders,
  } = useBinanceApi({ isTestnet });
  
  const { analysis: aiAnalysisResult, isAnalyzing: isAiAnalyzing } = useMarketAnalysis({ 
    mode: majorCoinMode ? 'MAJOR' : 'ALTCOIN' 
  });

  const majorCoinModeRef = useRef(majorCoinMode);
  useEffect(() => { majorCoinModeRef.current = majorCoinMode; }, [majorCoinMode]);

  // AI 분석 결과 동기화
  useEffect(() => {
    setState(prev => ({
      ...prev,
      aiAnalysis: aiAnalysisResult,
      isAiAnalyzing,
    }));
  }, [aiAnalysisResult, isAiAnalyzing]);

  // 초기 통계 업데이트
  useEffect(() => {
    if (initialStats) {
      setState(prev => ({
        ...prev,
        todayStats: initialStats,
      }));
    }
  }, [initialStats?.trades, initialStats?.wins, initialStats?.losses, initialStats?.totalPnL]);

  const processingRef = useRef(false);
  const lastEntryTimeRef = useRef(0);
  const entryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tpTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentPositionRef = useRef<LimitOrderPosition | null>(null);

  // currentPosition을 ref로 동기화
  useEffect(() => {
    currentPositionRef.current = state.currentPosition;
  }, [state.currentPosition]);

  // ===== 로그 추가 =====
  const addLog = useCallback((log: Omit<LimitOrderTradeLog, 'id' | 'timestamp'>) => {
    const newLog: LimitOrderTradeLog = {
      ...log,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };
    setState(prev => ({
      ...prev,
      tradeLogs: [newLog, ...prev.tradeLogs].slice(0, 50),
    }));
    return newLog;
  }, []);

  // ===== 자동매매 토글 =====
  const toggleAutoTrading = useCallback(() => {
    setState(prev => {
      const newEnabled = !prev.isEnabled;
      if (newEnabled) {
        initAudio();
        toast.success(`⚡ 지정가 빠른 회전 매매 시작`);
      } else {
        toast.info('지정가 매매 중지');
        // 타이머 정리
        if (entryTimeoutRef.current) clearTimeout(entryTimeoutRef.current);
        if (tpTimeoutRef.current) clearTimeout(tpTimeoutRef.current);
      }
      return {
        ...prev,
        isEnabled: newEnabled,
        pendingSignal: null,
        statusMessage: newEnabled ? '🔍 시그널 스캔 중...' : '🔄 지정가 매매 비활성화',
      };
    });
  }, []);

  // ===== AI 분석 토글 =====
  const toggleAiAnalysis = useCallback(() => {
    setState(prev => ({
      ...prev,
      aiEnabled: !prev.aiEnabled,
    }));
    toast.info(state.aiEnabled ? 'AI 분석 OFF' : 'AI 분석 ON');
  }, [state.aiEnabled]);

  // ===== 미체결 주문 취소 =====
  const cancelPendingOrders = useCallback(async (symbol: string) => {
    try {
      await cancelAllOrders(symbol);
      console.log(`🚫 [cancelPendingOrders] ${symbol} 미체결 주문 전량 취소`);
    } catch (error) {
      console.error('주문 취소 실패:', error);
    }
  }, [cancelAllOrders]);

  // ===== 전량 시장가 청산 =====
  const closePositionMarket = useCallback(async (
    reason: 'tp' | 'sl' | 'timeout' | 'cancel',
    currentPrice: number
  ) => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;

    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));

    const position = state.currentPosition;

    try {
      // 미체결 주문 모두 취소
      await cancelPendingOrders(position.symbol);

      // 실제 포지션 조회
      const positions = await getPositions(position.symbol);
      const actualPosition = positions?.find((p: any) =>
        p.symbol === position.symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );

      if (!actualPosition) {
        setState(prev => ({
          ...prev,
          currentPosition: null,
          currentSymbol: null,
          entryOrderIds: [],
          entryStartTime: null,
          statusMessage: '🔍 다음 시그널 대기...',
        }));
        return;
      }

      const actualQty = Math.abs(parseFloat(actualPosition.positionAmt));
      const actualEntryPrice = parseFloat(actualPosition.entryPrice);
      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';

      console.log(`🔴 [시장가 청산] ${position.symbol} ${orderSide} 수량=${actualQty} 사유=${reason}`);

      const closeResult = await placeMarketOrder(position.symbol, orderSide, actualQty, true, currentPrice);
      if (!closeResult || closeResult.error) {
        throw new Error(closeResult?.error || '청산 실패');
      }

      // 잔량 확인 및 추가 청산
      await new Promise(resolve => setTimeout(resolve, 500));
      const remainingPositions = await getPositions(position.symbol);
      const remainingPosition = remainingPositions?.find((p: any) =>
        p.symbol === position.symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );

      if (remainingPosition) {
        const remainingQty = Math.abs(parseFloat(remainingPosition.positionAmt));
        if (remainingQty > 0) {
          try {
            await placeMarketOrder(position.symbol, orderSide, remainingQty, true, currentPrice);
          } catch (e) {
            console.warn(`⚠️ 잔량 청산 실패:`, e);
          }
        }
      }

      // 손익 계산 (시장가 청산 = taker 수수료)
      const feeRate = LIMIT_ORDER_CONFIG.TAKER_FEE / 100;
      const entryFeeRate = LIMIT_ORDER_CONFIG.MAKER_FEE / 100;
      const direction = position.side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - actualEntryPrice) * direction;
      const pnlGross = priceDiff * actualQty;
      const entryNotional = actualEntryPrice * actualQty;
      const exitNotional = currentPrice * actualQty;
      const feeUsd = (entryNotional * entryFeeRate) + (exitNotional * feeRate);
      const pnl = pnlGross - feeUsd;
      const isWin = pnl > 0;

      setState(prev => ({
        ...prev,
        currentPosition: null,
        currentSymbol: null,
        entryOrderIds: [],
        entryStartTime: null,
        todayStats: {
          trades: prev.todayStats.trades + 1,
          wins: prev.todayStats.wins + (isWin ? 1 : 0),
          losses: prev.todayStats.losses + (isWin ? 0 : 1),
          totalPnL: prev.todayStats.totalPnL + pnl,
        },
        statusMessage: `${isWin ? '✅' : '❌'} ${reason === 'tp' ? '익절' : reason === 'sl' ? '손절' : '청산'} 완료!`,
      }));

      const reasonText: Record<string, string> = {
        tp: '익절',
        sl: '손절',
        timeout: '타임아웃',
        cancel: '취소',
      };

      addLog({
        symbol: position.symbol,
        action: reason === 'tp' ? 'tp' : reason === 'sl' ? 'sl' : 'timeout',
        side: position.side,
        price: currentPrice,
        quantity: actualQty,
        pnl,
        reason: reasonText[reason],
      });

      const pnlKRW = Math.round(pnl * krwRate);

      if (isWin) {
        playTpSound();
      } else {
        playSlSound();
      }

      toast[isWin ? 'success' : 'error'](
        `${isWin ? '✅' : '❌'} ${reasonText[reason]} | ${pnl >= 0 ? '+' : ''}₩${pnlKRW.toLocaleString()}`
      );

      if (logTrade) {
        logTrade({
          symbol: position.symbol,
          side: position.side,
          entryPrice: actualEntryPrice,
          exitPrice: currentPrice,
          quantity: actualQty,
          leverage,
          pnlUsd: pnl,
        });
      }

      onTradeComplete?.();
    } catch (error: any) {
      console.error('Close error:', error);
      addLog({
        symbol: position.symbol,
        action: 'error',
        side: position.side,
        price: currentPrice,
        quantity: position.filledQuantity,
        reason: error.message || '청산 실패',
      });
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [state.currentPosition, placeMarketOrder, getPositions, cancelPendingOrders, krwRate, leverage, addLog, onTradeComplete, logTrade]);

  // ===== TP/SL 체크 =====
  const checkTpSl = useCallback(async (currentPrice: number) => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;
    if (state.currentPosition.entryPhase !== 'active') return;

    const position = state.currentPosition;
    const pnlPercent = calculatePnLPercent(position.avgPrice, currentPrice, position.side, false);
    const holdTimeSec = (Date.now() - position.startTime) / 1000;

    // 상태 메시지 업데이트
    setState(prev => ({
      ...prev,
      statusMessage: `🔄 ${position.symbol.replace('USDT', '')} ${position.side === 'long' ? '롱' : '숏'} | ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`,
    }));

    // 진입 직후 5초 보호
    if (holdTimeSec < 5) return;

    // 손절 체크
    if (shouldStopLoss(currentPrice, position.stopLossPrice, position.side)) {
      console.log(`🛑 손절! 현재가 ${currentPrice} ${position.side === 'long' ? '<=' : '>='} SL ${position.stopLossPrice}`);
      await closePositionMarket('sl', currentPrice);
      return;
    }

    // 타임스탑 체크
    if (shouldTimeStop(position.startTime)) {
      console.log(`⏰ 타임스탑! ${LIMIT_ORDER_CONFIG.STOP_LOSS.TIME_STOP_MINUTES}분 경과`);
      await closePositionMarket('timeout', currentPrice);
      return;
    }

    // 익절 조건 체크 (1만원 이상)
    const pnlUSD = (pnlPercent / 100) * position.avgPrice * position.filledQuantity;
    const pnlKRW = pnlUSD * krwRate;
    
    if (pnlKRW >= LIMIT_ORDER_CONFIG.TAKE_PROFIT.MIN_PROFIT_KRW) {
      console.log(`💰 익절 조건 충족! ₩${Math.round(pnlKRW).toLocaleString()}`);
      // 빠른 회전을 위해 바로 시장가 청산
      await closePositionMarket('tp', currentPrice);
      return;
    }

  }, [state.currentPosition, closePositionMarket, krwRate]);

  // ===== 10분할 지정가 진입 =====
  const executeLimitEntry = useCallback(async (
    symbol: string,
    side: 'long' | 'short',
    currentPrice: number,
    indicators: TechnicalIndicators
  ) => {
    if (processingRef.current) return;

    processingRef.current = true;
    setState(prev => ({ 
      ...prev, 
      isProcessing: true,
      statusMessage: `📝 ${symbol.replace('USDT', '')} 10분할 지정가 주문 중...`,
    }));

    try {
      // 정밀도 조회
      const precision = await fetchSymbolPrecision(symbol, isTestnet);
      
      // 전체 포지션 계산
      const positionSizePercent = LIMIT_ORDER_CONFIG.POSITION_SIZE_PERCENT / 100;
      const entryBalance = balanceUSD * positionSizePercent;
      const buyingPower = entryBalance * leverage;
      const totalQty = buyingPower / currentPrice;
      const splitQty = totalQty / LIMIT_ORDER_CONFIG.ENTRY.SPLIT_COUNT;
      const roundedSplitQty = roundQuantity(splitQty, precision);

      if (roundedSplitQty * currentPrice < 5.5) {
        throw new Error('최소 주문금액 미달');
      }

      // 레버리지 설정
      try {
        await setLeverage(symbol, leverage);
      } catch (levError: any) {
        if (!levError.message?.includes('-4046') && !levError.message?.includes('already')) {
          console.warn('레버리지 설정 실패:', levError.message);
        }
      }

      // 10분할 지정가 가격 생성
      const entryPrices = generateEntryPrices(currentPrice, side, precision.tickSize);
      const orderSide = side === 'long' ? 'BUY' : 'SELL';
      
      console.log(`📝 [지정가 진입] ${symbol} ${orderSide} ${LIMIT_ORDER_CONFIG.ENTRY.SPLIT_COUNT}분할`);
      console.log(`   가격 범위: ${entryPrices[0].toFixed(precision.pricePrecision)} ~ ${entryPrices[entryPrices.length - 1].toFixed(precision.pricePrecision)}`);

      // 지정가 주문 실행
      const orderIds: string[] = [];
      const entries: LimitOrderEntry[] = [];

      for (let i = 0; i < entryPrices.length; i++) {
        const price = entryPrices[i];
        const roundedPrice = roundPrice(price, precision);
        
        try {
          const orderResult = await placeLimitOrder(symbol, orderSide, roundedSplitQty, roundedPrice);
          
          if (orderResult && !orderResult.error && orderResult.orderId) {
            orderIds.push(orderResult.orderId.toString());
            entries.push({
              orderId: orderResult.orderId.toString(),
              price: roundedPrice,
              quantity: roundedSplitQty,
              filled: 0,
              status: 'NEW',
              timestamp: Date.now(),
            });
          }
        } catch (orderError: any) {
          console.warn(`주문 ${i + 1} 실패:`, orderError.message);
        }
      }

      if (orderIds.length === 0) {
        throw new Error('모든 지정가 주문 실패');
      }

      // 포지션 생성 (진입 대기 상태)
      const newPosition: LimitOrderPosition = {
        symbol,
        side,
        entries,
        avgPrice: 0,
        totalQuantity: roundedSplitQty * entries.length,
        filledQuantity: 0,
        startTime: Date.now(),
        entryPhase: 'waiting',
        takeProfitOrders: [],
        stopLossPrice: 0,
      };

      setState(prev => ({
        ...prev,
        pendingSignal: null,
        currentPosition: newPosition,
        currentSymbol: symbol,
        entryOrderIds: orderIds,
        entryStartTime: Date.now(),
        statusMessage: `⏳ ${symbol.replace('USDT', '')} 체결 대기 (10초)...`,
      }));

      addLog({
        symbol,
        action: 'order',
        side,
        price: currentPrice,
        quantity: roundedSplitQty * entries.length,
        reason: `10분할 지정가 주문 (${entries.length}개)`,
      });

      lastEntryTimeRef.current = Date.now();

      // 10초 타임아웃 설정
      entryTimeoutRef.current = setTimeout(async () => {
        await checkEntryFill(symbol, side);
      }, LIMIT_ORDER_CONFIG.ENTRY.TIMEOUT_SEC * 1000);

      playEntrySound();
      toast.info(`📝 ${side === 'long' ? '롱' : '숏'} 10분할 지정가 주문!`);

    } catch (error: any) {
      console.error('Entry error:', error);
      lastEntryTimeRef.current = Date.now();

      setState(prev => ({ 
        ...prev, 
        pendingSignal: null, 
        currentPosition: null,
        entryOrderIds: [],
        entryStartTime: null,
        statusMessage: '🔍 다음 시그널 대기...' 
      }));

      addLog({
        symbol,
        action: 'error',
        side,
        price: currentPrice,
        quantity: 0,
        reason: error.message || '진입 실패',
      });
      toast.error(`진입 실패: ${error.message || '오류'}`);
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [balanceUSD, leverage, placeLimitOrder, setLeverage, addLog, isTestnet]);

  // ===== 체결 확인 (10초 후) =====
  const checkEntryFill = useCallback(async (symbol: string, side: 'long' | 'short') => {
    // ref를 사용해서 최신 currentPosition 확인 (stale closure 방지)
    const currentPos = currentPositionRef.current;
    if (!currentPos || currentPos.entryPhase !== 'waiting') {
      console.log(`[checkEntryFill] ${symbol} 스킵 - position: ${!!currentPos}, phase: ${currentPos?.entryPhase}`);
      return;
    }

    try {
      // 포지션 조회
      const positions = await getPositions(symbol);
      const actualPosition = positions?.find((p: any) =>
        p.symbol === symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );

      if (!actualPosition || Math.abs(parseFloat(actualPosition.positionAmt)) === 0) {
        // 미체결 → 변동성 없음, 전량 취소
        console.log(`🚫 [타임아웃] ${symbol} 10초 내 미체결 → 전량 취소`);
        await cancelPendingOrders(symbol);
        
        setState(prev => ({
          ...prev,
          currentPosition: null,
          currentSymbol: null,
          entryOrderIds: [],
          entryStartTime: null,
          statusMessage: '🔍 변동성 부족, 다음 종목 스캔...',
        }));

        addLog({
          symbol,
          action: 'cancel',
          side,
          price: 0,
          quantity: 0,
          reason: '10초 내 미체결 (변동성 부족)',
        });

        toast.info(`🚫 ${symbol.replace('USDT', '')} 변동성 부족, 다음 종목 탐색`);
        return;
      }

      // 체결됨
      const filledQty = Math.abs(parseFloat(actualPosition.positionAmt));
      const avgPrice = parseFloat(actualPosition.entryPrice);
      const fillRatio = currentPos.totalQuantity > 0 ? filledQty / currentPos.totalQuantity : 0;

      console.log(`✅ [체결] ${symbol} 체결률: ${(fillRatio * 100).toFixed(1)}% (${filledQty})`);

      // 미체결 주문 취소
      await cancelPendingOrders(symbol);

      // 손절가 계산
      const stopLossPrice = calculateStopLossPrice(avgPrice, side);

      // 포지션 활성화
      setState(prev => {
        if (!prev.currentPosition) return prev;
        return {
          ...prev,
          currentPosition: {
            ...prev.currentPosition,
            avgPrice,
            filledQuantity: filledQty,
            entryPhase: 'active',
            startTime: Date.now(), // 활성화 시점부터 타임스탑 계산
            stopLossPrice,
          },
          entryOrderIds: [],
          statusMessage: `🔄 ${symbol.replace('USDT', '')} ${side === 'long' ? '롱' : '숏'} 활성화`,
        };
      });

      addLog({
        symbol,
        action: 'fill',
        side,
        price: avgPrice,
        quantity: filledQty,
        reason: `체결 완료 (${(fillRatio * 100).toFixed(0)}%)`,
      });

      toast.success(`✅ ${side === 'long' ? '롱' : '숏'} 체결! 평균가 ${avgPrice.toFixed(4)}`);

    } catch (error: any) {
      console.error('체결 확인 실패:', error);
    }
  }, [getPositions, cancelPendingOrders, addLog]);

  // ===== 시그널 핸들러 =====
  const handleTechnicalSignal = useCallback(async (
    symbol: string,
    direction: 'long' | 'short',
    price: number,
    strength: 'weak' | 'medium' | 'strong',
    reasons: string[],
    indicators: TechnicalIndicators
  ) => {
    if (!state.isEnabled) return;
    if (processingRef.current) return;
    if (!user) return;
    
    if (balanceUSD <= 0) {
      console.log(`[handleSignal] 잔고 미로드 - ${symbol} ${direction} 시그널 무시`);
      setState(prev => ({
        ...prev,
        statusMessage: '⏳ 잔고 조회 중... 시그널 대기',
      }));
      return;
    }
    
    if (state.currentPosition) return;
    if (state.pendingSignal) return;

    // 시그널 강도 체크
    if (strength === 'weak') return;

    // ADX 필터 (설정에서 끌 수 있음)
    const adxEnabled = filterSettings?.adxEnabled ?? true;
    const adxThreshold = filterSettings?.adxThreshold ?? LIMIT_ORDER_CONFIG.SIGNAL.MIN_ADX;
    if (adxEnabled && indicators.adx < adxThreshold) {
      console.log(`[handleSignal] ${symbol} 횡보장 필터 (ADX: ${indicators.adx.toFixed(1)} < ${adxThreshold})`);
      return;
    }

    // 거래량 필터 (설정에서 끌 수 있음)
    const volumeEnabled = filterSettings?.volumeEnabled ?? true;
    const volumePercent = (indicators.volumeRatio || 0) * 100;
    if (volumeEnabled && volumePercent < LIMIT_ORDER_CONFIG.SIGNAL.MIN_VOLUME_RATIO) {
      console.log(`[handleSignal] ${symbol} 거래량 부족 (${volumePercent.toFixed(0)}% < ${LIMIT_ORDER_CONFIG.SIGNAL.MIN_VOLUME_RATIO}%)`);
      return;
    }

    // RSI 필터 (설정에서 끌 수 있음)
    const rsiEnabled = filterSettings?.rsiEnabled ?? true;
    if (rsiEnabled) {
      // 롱: RSI 30-70 사이 / 숏: RSI 30-70 사이 (극단값 제외)
      if (direction === 'long' && indicators.rsi > 70) {
        console.log(`[handleSignal] ${symbol} RSI 과매수 (${indicators.rsi.toFixed(1)} > 70)`);
        return;
      }
      if (direction === 'short' && indicators.rsi < 30) {
        console.log(`[handleSignal] ${symbol} RSI 과매도 (${indicators.rsi.toFixed(1)} < 30)`);
        return;
      }
    }

    // MACD 필터 (설정에서 끌 수 있음)
    const macdEnabled = filterSettings?.macdEnabled ?? true;
    if (macdEnabled) {
      // 롱: MACD > Signal / 숏: MACD < Signal
      if (direction === 'long' && indicators.macd < indicators.macdSignal) {
        console.log(`[handleSignal] ${symbol} MACD 하락 (${indicators.macd.toFixed(4)} < ${indicators.macdSignal.toFixed(4)})`);
        return;
      }
      if (direction === 'short' && indicators.macd > indicators.macdSignal) {
        console.log(`[handleSignal] ${symbol} MACD 상승 (${indicators.macd.toFixed(4)} > ${indicators.macdSignal.toFixed(4)})`);
        return;
      }
    }

    // 볼린저밴드 필터 (설정에서 끌 수 있음)
    const bollingerEnabled = filterSettings?.bollingerEnabled ?? true;
    if (bollingerEnabled) {
      // 롱: 가격이 상단밴드 이상이면 과매수
      if (direction === 'long' && price > indicators.upperBand) {
        console.log(`[handleSignal] ${symbol} 볼린저 상단돌파 (${price.toFixed(2)} > ${indicators.upperBand.toFixed(2)})`);
        return;
      }
      // 숏: 가격이 하단밴드 이하면 과매도
      if (direction === 'short' && price < indicators.lowerBand) {
        console.log(`[handleSignal] ${symbol} 볼린저 하단돌파 (${price.toFixed(2)} < ${indicators.lowerBand.toFixed(2)})`);
        return;
      }
    }

    // 필터 상태 로그
    const disabledFilters: string[] = [];
    if (!adxEnabled) disabledFilters.push('ADX');
    if (!volumeEnabled) disabledFilters.push('거래량');
    if (!rsiEnabled) disabledFilters.push('RSI');
    if (!macdEnabled) disabledFilters.push('MACD');
    if (!bollingerEnabled) disabledFilters.push('볼린저');
    const filterStatus = disabledFilters.length > 0 ? ` [OFF: ${disabledFilters.join(',')}]` : '';

    console.log(`🎯 [시그널] ${symbol} ${direction} (${strength})${filterStatus}`);
    
    // 즉시 진입 (지정가 주문)
    await executeLimitEntry(symbol, direction, price, indicators);

  }, [state.isEnabled, state.currentPosition, state.pendingSignal, user, balanceUSD, executeLimitEntry]);

  // ===== 수동 청산 =====
  const manualClosePosition = useCallback(async () => {
    if (!state.currentPosition) return;
    
    try {
      const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${state.currentPosition.symbol}`);
      const data = await res.json();
      const currentPrice = parseFloat(data.price);
      
      await closePositionMarket('cancel', currentPrice);
    } catch (error) {
      console.error('수동 청산 실패:', error);
      toast.error('청산 실패');
    }
  }, [state.currentPosition, closePositionMarket]);

  // ===== 진입 대기 중 취소 =====
  const cancelEntry = useCallback(async () => {
    const currentPos = currentPositionRef.current;
    if (!currentPos || currentPos.entryPhase !== 'waiting') {
      toast.error('취소할 주문이 없습니다');
      return;
    }

    try {
      console.log(`🚫 [수동취소] ${currentPos.symbol} 진입 대기 주문 취소`);
      
      // 타임아웃 취소
      if (entryTimeoutRef.current) {
        clearTimeout(entryTimeoutRef.current);
        entryTimeoutRef.current = null;
      }

      // 미체결 주문 취소
      await cancelPendingOrders(currentPos.symbol);

      // 상태 초기화
      setState(prev => ({
        ...prev,
        currentPosition: null,
        currentSymbol: null,
        entryOrderIds: [],
        entryStartTime: null,
        statusMessage: '🔍 다음 시그널 대기...',
      }));

      addLog({
        symbol: currentPos.symbol,
        action: 'cancel',
        side: currentPos.side,
        price: 0,
        quantity: 0,
        reason: '수동 취소',
      });

      toast.info(`🚫 ${currentPos.symbol.replace('USDT', '')} 진입 취소`);
    } catch (error) {
      console.error('진입 취소 실패:', error);
      toast.error('취소 실패');
    }
  }, [cancelPendingOrders, addLog]);

  // ===== Cleanup =====
  useEffect(() => {
    return () => {
      if (entryTimeoutRef.current) clearTimeout(entryTimeoutRef.current);
      if (tpTimeoutRef.current) clearTimeout(tpTimeoutRef.current);
    };
  }, []);

  return {
    state,
    toggleAutoTrading,
    toggleAiAnalysis,
    handleTechnicalSignal,
    checkTpSl,
    closePosition: manualClosePosition,
    cancelEntry,
    addLog,
  };
}
