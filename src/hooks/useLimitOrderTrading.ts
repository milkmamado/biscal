/**
 * ⚡ 2단계 진입 전략 매매 훅 v2.0
 * 
 * 특징:
 * 1. 1차: 50% 지정가 진입
 * 2. 2차: 1차 체결 시 50% 시장가 즉시 진입
 * 3. 미체결 문제 해결 & 빠른 회전
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
  generateFirstEntryPrice,
  generateTakeProfitPrices,
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
    stopLossUsdt: number;  // USDT 기반 손절
    takeProfitUsdt: number; // USDT 기반 익절
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
  // PaperTrading/Index에서 전달된 레버리지를 우선 사용 (기본값은 config)
  const leverage = _leverage ?? LIMIT_ORDER_CONFIG.LEVERAGE;

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
    placeStopMarketOrder,
    placeTakeProfitMarketOrder,
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
  const checkEntryFillRef = useRef<(symbol: string, side: 'long' | 'short', isPartialWait?: boolean) => Promise<void>>();
  const lastSyncedPositionRef = useRef<string | null>(null);

  // currentPosition을 ref로 동기화
  useEffect(() => {
    currentPositionRef.current = state.currentPosition;
  }, [state.currentPosition]);

  // ===== 실제 포지션 주기적 동기화 (수동 지정가 체결 감지용) =====
  // 신규 포지션 감지 시 SL/TP 설정을 위한 ref
  const slTpSettingInProgressRef = useRef<string | null>(null);
  // SL/TP 함수를 ref로 저장 (의존성 문제 방지)
  const placeStopMarketOrderRef = useRef(placeStopMarketOrder);
  const placeTakeProfitMarketOrderRef = useRef(placeTakeProfitMarketOrder);
  const filterSettingsRef = useRef(filterSettings);
  
  useEffect(() => {
    placeStopMarketOrderRef.current = placeStopMarketOrder;
    placeTakeProfitMarketOrderRef.current = placeTakeProfitMarketOrder;
    filterSettingsRef.current = filterSettings;
  }, [placeStopMarketOrder, placeTakeProfitMarketOrder, filterSettings]);
  
  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    const syncPositionFromExchange = async () => {
      // 처리 중/진입 대기/청산 중이면 스킵 (상태 꼬임 방지)
      if (processingRef.current) return;
      if (state.currentPosition?.entryPhase === 'waiting') return;
      if (state.currentPosition?.entryPhase === 'closing') return;

      try {
        const positions = await getPositions();
        if (!isMounted) return;
        if (!positions || !Array.isArray(positions)) return;

        // 실제 열린 포지션 찾기
        const openPosition = positions.find((p: any) => {
          const amt = parseFloat(p.positionAmt || '0');
          return Math.abs(amt) > 0;
        });

        if (openPosition) {
          const posAmt = parseFloat(openPosition.positionAmt);
          const entryPrice = parseFloat(openPosition.entryPrice);
          const symbol = openPosition.symbol;
          const side: 'long' | 'short' = posAmt > 0 ? 'long' : 'short';
          const qty = Math.abs(posAmt);
          // 바이낸스에서 제공하는 실제 미실현 손익
          const unrealizedPnl = parseFloat(openPosition.unRealizedProfit || '0');
          const markPrice = parseFloat(openPosition.markPrice || '0');

          // 중복 동기화 방지 (unrealizedPnl 변경은 허용)
          const posKey = `${symbol}-${side}-${qty.toFixed(6)}`;
          const isBrandNewPosition = lastSyncedPositionRef.current !== posKey;
          if (isBrandNewPosition) {
            lastSyncedPositionRef.current = posKey;
          }

          console.log(`🔄 [포지션 동기화] ${symbol} ${side} @ ${entryPrice} qty=${qty} PnL=$${unrealizedPnl.toFixed(2)}`);

          // 손절가 계산
          const positionValueUsd = entryPrice * qty;
          const targetStopLossUsdt = filterSettingsRef.current?.stopLossUsdt ?? 7;
          const targetTakeProfitUsdt = filterSettingsRef.current?.takeProfitUsdt ?? 7;
          const slPercent = (targetStopLossUsdt / positionValueUsd) * 100;
          const tpPercent = (targetTakeProfitUsdt / positionValueUsd) * 100;
          
          let slPrice: number;
          let tpPrice: number;
          
          if (side === 'long') {
            slPrice = entryPrice * (1 - slPercent / 100);
            tpPrice = entryPrice * (1 + tpPercent / 100);
          } else {
            slPrice = entryPrice * (1 + slPercent / 100);
            tpPrice = entryPrice * (1 - tpPercent / 100);
          }

          if (isMounted) {
            setState(prev => {
              const prevPos = prev.currentPosition;

              // 같은 심볼/방향이면 수량/평단/PnL 갱신
              if (prevPos && prevPos.symbol === symbol && prevPos.side === side) {
                return {
                  ...prev,
                  currentSymbol: symbol,
                  currentPosition: {
                    ...prevPos,
                    avgPrice: entryPrice,
                    totalQuantity: qty,
                    filledQuantity: qty,
                    stopLossPrice: slPrice,
                    unrealizedPnl,
                    markPrice,
                  },
                };
              }

              // 신규 포지션 감지
              return {
                ...prev,
                currentSymbol: symbol,
                currentPosition: {
                  symbol,
                  side,
                  entries: [],
                  avgPrice: entryPrice,
                  totalQuantity: qty,
                  filledQuantity: qty,
                  startTime: Date.now(),
                  entryPhase: 'active',
                  takeProfitOrders: [],
                  stopLossPrice: slPrice,
                  unrealizedPnl,
                  markPrice,
                },
                statusMessage: `✅ ${symbol} ${side === 'long' ? '롱' : '숏'} 포지션 감지!`,
              };
            });
          }

          // ===== 신규 포지션 감지 시 바이낸스에 SL/TP 자동 설정 =====
          if (isBrandNewPosition && slTpSettingInProgressRef.current !== posKey && isMounted) {
            slTpSettingInProgressRef.current = posKey;
            
            const closeSide = side === 'long' ? 'SELL' : 'BUY';
            
            console.log(`📊 [신규 포지션 SL/TP 설정] ${symbol} | SL=$${targetStopLossUsdt}→${slPrice.toFixed(4)} | TP=$${targetTakeProfitUsdt}→${tpPrice.toFixed(4)}`);
            
            // STOP_MARKET 주문
            try {
              const slResult = await placeStopMarketOrderRef.current(symbol, closeSide, qty, slPrice);
              if (isMounted && slResult && !slResult.error) {
                console.log(`✅ [STOP_MARKET] 설정 완료! 손절가=${slPrice.toFixed(4)}`);
                toast.info(`🛑 손절 주문 설정: $${slPrice.toFixed(2)}`);
              }
            } catch (slError: any) {
              console.warn(`❌ STOP_MARKET 실패:`, slError?.message);
            }
            
            if (!isMounted) return;
            
            // TAKE_PROFIT_MARKET 주문
            try {
              const tpResult = await placeTakeProfitMarketOrderRef.current(symbol, closeSide, qty, tpPrice);
              if (isMounted && tpResult && !tpResult.error) {
                console.log(`✅ [TAKE_PROFIT_MARKET] 설정 완료! 익절가=${tpPrice.toFixed(4)}`);
                toast.info(`💰 익절 주문 설정: $${tpPrice.toFixed(2)}`);
              }
            } catch (tpError: any) {
              console.warn(`❌ TAKE_PROFIT_MARKET 실패:`, tpError?.message);
            }
            
            if (isMounted) {
              toast.success(`✅ ${symbol.replace('USDT', '')} ${side === 'long' ? '롱' : '숏'} 체결! SL/TP 자동 설정됨`);
              playEntrySound();
            }
          } else if (isBrandNewPosition && isMounted) {
            toast.success(`✅ ${symbol.replace('USDT', '')} ${side === 'long' ? '롱' : '숏'} 체결! @ ${entryPrice.toFixed(2)}`);
            playEntrySound();
          }
        } else {
          // 포지션이 없으면 동기화 키 초기화
          if (lastSyncedPositionRef.current) {
            lastSyncedPositionRef.current = null;
            slTpSettingInProgressRef.current = null;
          }
        }
      } catch (error) {
        // 조용히 실패 (네트워크 일시 오류 등)
        console.warn('[포지션 동기화] 오류:', error);
      }
    };

    // 3초마다 실제 포지션 확인
    const interval = setInterval(syncPositionFromExchange, 3000);
    // 초기 1회 실행
    syncPositionFromExchange();

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [user, state.currentPosition, getPositions]);

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

      // 실제 체결 가격 가져오기 (바이낸스 응답에서)
      const actualExitPrice = parseFloat(closeResult.avgPrice || closeResult.price || '0') || currentPrice;
      console.log(`📊 [청산 체결] 예상가=${currentPrice.toFixed(6)} → 실제체결가=${actualExitPrice.toFixed(6)}`);

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

      // 손익 계산 (실제 체결가 기준)
      const feeRate = LIMIT_ORDER_CONFIG.TAKER_FEE / 100;
      const entryFeeRate = LIMIT_ORDER_CONFIG.MAKER_FEE / 100;
      const direction = position.side === 'long' ? 1 : -1;
      const priceDiff = (actualExitPrice - actualEntryPrice) * direction;
      const pnlGross = priceDiff * actualQty;
      const entryNotional = actualEntryPrice * actualQty;
      const exitNotional = actualExitPrice * actualQty;
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
        price: actualExitPrice,  // 실제 체결가
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
          exitPrice: actualExitPrice,  // 실제 체결가
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

  // ===== 1차 익절 후 4분할 TP 배치 =====
  const executeFirstTakeProfit = useCallback(async (
    currentPrice: number
  ) => {
    const position = currentPositionRef.current;
    if (!position || position.entryPhase !== 'active') return;
    if (processingRef.current) return;

    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));

    try {
      const precision = await fetchSymbolPrecision(position.symbol, isTestnet);
      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';
      
      // 1차 익절: 20% 시장가 청산
      const firstTpQty = roundQuantity(position.filledQuantity * 0.2, precision);
      
      console.log(`💰 [1차익절] ${position.symbol} 시장가 ${firstTpQty} 청산`);
      const firstTpResult = await placeMarketOrder(position.symbol, orderSide, firstTpQty, true, currentPrice);
      
      if (!firstTpResult || firstTpResult.error) {
        console.error('1차 익절 실패:', firstTpResult?.error);
        // 실패해도 계속 진행
      } else {
        playTpSound();
        const pnlKRW = Math.round((currentPrice - position.avgPrice) * (position.side === 'long' ? 1 : -1) * firstTpQty * krwRate);
        toast.success(`💰 1차 익절! +₩${pnlKRW.toLocaleString()}`);
      }

      // 잔량 확인
      await new Promise(resolve => setTimeout(resolve, 500));
      const positions = await getPositions(position.symbol);
      const actualPosition = positions?.find((p: any) =>
        p.symbol === position.symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );

      if (!actualPosition) {
        // 전량 청산됨
        console.log(`✅ [익절완료] ${position.symbol} 전량 청산됨`);
        setState(prev => ({
          ...prev,
          currentPosition: null,
          currentSymbol: null,
          statusMessage: '🔍 다음 시그널 대기...',
        }));
        processingRef.current = false;
        setState(prev => ({ ...prev, isProcessing: false }));
        return;
      }

      const remainQty = Math.abs(parseFloat(actualPosition.positionAmt));
      const avgPrice = parseFloat(actualPosition.entryPrice);
      console.log(`📊 [잔량] ${position.symbol} 잔량 ${remainQty} → 4분할 TP 배치`);

      // 나머지 4분할 지정가 TP 배치
      const targetProfitUsdt = filterSettings?.takeProfitUsdt ?? 7;
      const profitStepUsdt = 3; // $3 간격으로 분할
      const roundTripFeePercent = LIMIT_ORDER_CONFIG.MAKER_FEE * 2 / 100;
      const tpOrders: LimitOrderEntry[] = [];
      const splitCount = 4;
      const splitQty = roundQuantity(remainQty / splitCount, precision);

      for (let i = 0; i < splitCount; i++) {
        // TP2~TP5 (1차는 이미 체결됨)
        const targetProfitForSplit = targetProfitUsdt + (profitStepUsdt * (i + 1));
        const requiredPriceDiff = targetProfitForSplit / position.filledQuantity + (avgPrice * roundTripFeePercent);

        let tpPrice: number;
        if (position.side === 'long') {
          tpPrice = avgPrice + requiredPriceDiff;
        } else {
          tpPrice = avgPrice - requiredPriceDiff;
        }
        tpPrice = roundPrice(tpPrice, precision);

        const qty = i === splitCount - 1
          ? roundQuantity(remainQty - (splitQty * (splitCount - 1)), precision)
          : splitQty;

        if (qty <= 0) continue;

        try {
          const result = await placeLimitOrder(position.symbol, orderSide, qty, tpPrice, true);
          if (result && !result.error) {
            tpOrders.push({
              orderId: result.orderId,
              price: tpPrice,
              quantity: qty,
              filled: 0,
              status: 'NEW',
              timestamp: Date.now(),
            });
            console.log(`  ✅ TP${i + 2}: ${tpPrice.toFixed(precision.pricePrecision)} × ${qty}`);
          }
        } catch (err) {
          console.error(`  ❌ TP${i + 2} 실패:`, err);
        }
      }

      // 포지션 업데이트 + 10초 타이머 시작
      setState(prev => {
        if (!prev.currentPosition) return prev;
        return {
          ...prev,
          currentPosition: {
            ...prev.currentPosition,
            filledQuantity: remainQty,
            takeProfitOrders: tpOrders,
            entryPhase: 'closing' as const, // 익절 진행 중
          },
          statusMessage: `⏳ ${position.symbol.replace('USDT', '')} 잔량 TP 대기 (10초)...`,
        };
      });

      // 10초 후 잔량 시장가 청산
      tpTimeoutRef.current = setTimeout(async () => {
        const currentPos = currentPositionRef.current;
        if (!currentPos) return;

        console.log(`⏰ [타임아웃] ${currentPos.symbol} 10초 경과 → 잔량 시장가 청산`);

        // 미체결 TP 취소
        await cancelPendingOrders(currentPos.symbol);

        // 잔량 확인 및 청산
        const finalPositions = await getPositions(currentPos.symbol);
        const finalPosition = finalPositions?.find((p: any) =>
          p.symbol === currentPos.symbol && Math.abs(parseFloat(p.positionAmt)) > 0
        );

        if (finalPosition) {
          const finalQty = Math.abs(parseFloat(finalPosition.positionAmt));
          const markPrice = parseFloat((finalPosition as any).markPrice || (finalPosition as any).entryPrice || '0');
          if (finalQty > 0) {
            await closePositionMarket('tp', markPrice);
          }
        } else {
          setState(prev => ({
            ...prev,
            currentPosition: null,
            currentSymbol: null,
            statusMessage: '🔍 다음 시그널 대기...',
          }));
        }

        tpTimeoutRef.current = null;
      }, 10000); // 10초

    } catch (error) {
      console.error('익절 실행 실패:', error);
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [placeMarketOrder, placeLimitOrder, getPositions, cancelPendingOrders, closePositionMarket, krwRate, filterSettings, isTestnet]);

  // ===== TP/SL 체크 =====
  const checkTpSl = useCallback(async (currentPrice: number) => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;
    if (state.currentPosition.entryPhase === 'waiting') return;
    if (state.currentPosition.entryPhase === 'closing') return; // 이미 익절 진행 중

    const position = state.currentPosition;
    const holdTimeSec = (Date.now() - position.startTime) / 1000;

    // 정확한 PnL 계산
    const direction = position.side === 'long' ? 1 : -1;
    const priceDiff = (currentPrice - position.avgPrice) * direction;
    const pnlUSD = priceDiff * position.filledQuantity;
    const pnlKRW = pnlUSD * krwRate;
    const pnlPercent = (priceDiff / position.avgPrice) * 100;

    // 저체결 손익분기 모드 체크
    const isLowFillBreakeven = (position as any).isLowFillBreakeven === true;
    const breakEvenBuffer = LIMIT_ORDER_CONFIG.ENTRY.BREAKEVEN_FEE_BUFFER ?? 0.1;

    // 상태 메시지 업데이트
    setState(prev => ({
      ...prev,
      statusMessage: isLowFillBreakeven
        ? `⚡ ${position.symbol.replace('USDT', '')} 손익분기 대기 | ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`
        : `🔄 ${position.symbol.replace('USDT', '')} ${position.side === 'long' ? '롱' : '숏'} | ${pnlKRW >= 0 ? '+' : ''}₩${Math.round(pnlKRW).toLocaleString()}`,
    }));

    // 진입 직후 5초 보호
    if (holdTimeSec < 5) return;

    // ===== 저체결 손익분기 모드: 손익분기 도달 시 즉시 청산 =====
    if (isLowFillBreakeven) {
      if (pnlPercent >= -breakEvenBuffer) {
        console.log(`✅ [저체결 손익분기] ${position.symbol} PnL ${pnlPercent.toFixed(3)}% >= -${breakEvenBuffer}% → 청산`);
        await closePositionMarket('tp', currentPrice);
        return;
      }
      // 손절 체크 (USDT 기반)
      const targetStopLossUsdt = filterSettings?.stopLossUsdt ?? 7;
      if (pnlUSD <= -targetStopLossUsdt) {
        console.log(`🛑 저체결 손절! $${pnlUSD.toFixed(2)} <= -$${targetStopLossUsdt}`);
        await closePositionMarket('sl', currentPrice);
        return;
      }
      // 저체결 모드에서는 익절/타임스탑 무시, 손익분기만 대기
      return;
    }

    // ===== 일반 모드 =====
    // 손절 체크 (USDT 기반)
    const targetStopLossUsdt = filterSettings?.stopLossUsdt ?? 7;
    if (pnlUSD <= -targetStopLossUsdt) {
      console.log(`🛑 손절! $${pnlUSD.toFixed(2)} <= -$${targetStopLossUsdt}`);
      await closePositionMarket('sl', currentPrice);
      return;
    }

    // 타임스탑 체크
    if (shouldTimeStop(position.startTime)) {
      console.log(`⏰ 타임스탑! ${LIMIT_ORDER_CONFIG.STOP_LOSS.TIME_STOP_MINUTES}분 경과`);
      await closePositionMarket('timeout', currentPrice);
      return;
    }

    // 익절 체크 (USDT 기반) → 1차 시장가 익절 실행
    const targetProfitUsdt = filterSettings?.takeProfitUsdt ?? 7;
    if (pnlUSD >= targetProfitUsdt) {
      console.log(`💰 익절 조건! $${pnlUSD.toFixed(2)} >= $${targetProfitUsdt}`);
      await executeFirstTakeProfit(currentPrice);
      return;
    }

  }, [state.currentPosition, closePositionMarket, krwRate, filterSettings, executeFirstTakeProfit]);

  // ===== 2단계 진입 전략 =====
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
      statusMessage: `📝 ${symbol.replace('USDT', '')} 2단계 진입 준비...`,
    }));

    try {
      // 정밀도 조회
      const precision = await fetchSymbolPrecision(symbol, isTestnet);
      
      // 레버리지 설정 (실패 시 단계적으로 낮춤)
      let appliedLeverage = leverage;
      const leverageCandidates = Array.from(
        new Set([leverage, 10, 5, 3, 2, 1].filter((v) => v <= leverage))
      );

      for (const lev of leverageCandidates) {
        try {
          const res = await setLeverage(symbol, lev);
          appliedLeverage = lev;
          if (!res?.alreadySet) {
            console.log(`🧲 [Leverage] ${symbol} 적용: ${lev}x`);
          }
          break;
        } catch (levError: any) {
          const msg = levError?.message || String(levError);
          console.warn(`레버리지 설정 실패(${lev}x):`, msg);
          continue;
        }
      }

      // 전체 포지션 계산
      const positionSizePercent = LIMIT_ORDER_CONFIG.POSITION_SIZE_PERCENT / 100;
      const entryBalance = balanceUSD * positionSizePercent;
      const buyingPower = entryBalance * appliedLeverage;
      const totalQty = buyingPower / currentPrice;
      
      // 1차: 50% 지정가
      const firstEntryPercent = LIMIT_ORDER_CONFIG.ENTRY.FIRST_ENTRY_PERCENT / 100;
      const firstQtyRaw = totalQty * firstEntryPercent;
      const firstQty = roundQuantity(firstQtyRaw, precision);
      
      // 2차: 50% 시장가 (1차 체결 후)
      const secondEntryPercent = LIMIT_ORDER_CONFIG.ENTRY.SECOND_ENTRY_PERCENT / 100;
      const secondQtyRaw = totalQty * secondEntryPercent;
      const secondQty = roundQuantity(secondQtyRaw, precision);

      const qtyDigits = Math.min(8, Math.max(0, precision.quantityPrecision));

      console.log(
        `💳 [Sizing] bal=${balanceUSD.toFixed(2)}USDT lev=${appliedLeverage}x | 1차=${firstQty.toFixed(qtyDigits)} 2차=${secondQty.toFixed(qtyDigits)}`
      );

      // 1차 지정가 가격 생성
      const firstEntryPrice = generateFirstEntryPrice(currentPrice, side, precision.tickSize);
      const roundedFirstPrice = roundPrice(firstEntryPrice, precision);
      const orderSide = side === 'long' ? 'BUY' : 'SELL';
      
      console.log(`📝 [1차 지정가] ${symbol} ${orderSide} 가격=${roundedFirstPrice} 수량=${firstQty.toFixed(qtyDigits)}`);

      // 1차 지정가 주문 실행 (포지션 한도 초과 시 수량 축소 재시도)
      let orderResult: any = null;
      let actualFirstQty = firstQty;
      let actualSecondQty = secondQty;
      const maxRetries = 3;
      const reductionFactors = [1.0, 0.5, 0.25]; // 100%, 50%, 25%

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const factor = reductionFactors[attempt];
        actualFirstQty = roundQuantity(firstQty * factor, precision);
        actualSecondQty = roundQuantity(secondQty * factor, precision);

        if (attempt > 0) {
          console.log(`🔄 [재시도 ${attempt}] 포지션 한도 초과 → 수량 ${(factor * 100).toFixed(0)}%로 축소: 1차=${actualFirstQty} 2차=${actualSecondQty}`);
        }

        try {
          orderResult = await placeLimitOrder(symbol, orderSide, actualFirstQty, roundedFirstPrice);

          if (orderResult && orderResult.orderId && !orderResult.error) {
            // 성공
            break;
          }

          const errMsg = orderResult?.error || orderResult?.msg || orderResult?.message || '';
          
          // 포지션 한도 초과 에러인 경우 재시도
          if (errMsg.includes('Exceeded the maximum allowable position') || 
              errMsg.includes('position at current leverage')) {
            console.warn(`⚠️ [포지션 한도 초과] ${symbol} attempt ${attempt + 1}/${maxRetries}`);
            if (attempt < maxRetries - 1) continue; // 다음 시도
          }

          // 다른 에러면 바로 throw
          throw new Error(`1차 지정가 주문 실패: ${errMsg}`);
        } catch (orderError: any) {
          const errMsg = orderError?.message || String(orderError);
          
          // 포지션 한도 초과 에러인 경우 재시도
          if ((errMsg.includes('Exceeded the maximum allowable position') || 
               errMsg.includes('position at current leverage')) &&
              attempt < maxRetries - 1) {
            console.warn(`⚠️ [포지션 한도 초과] ${symbol} attempt ${attempt + 1}/${maxRetries}`);
            continue;
          }
          throw orderError;
        }
      }
      
      if (!orderResult || !orderResult.orderId) {
        throw new Error(`1차 지정가 주문 실패: 포지션 한도 초과 (수량 25%로도 불가)`);
      }

      const orderId = orderResult.orderId.toString();
      const entries: LimitOrderEntry[] = [{
        orderId,
        price: roundedFirstPrice,
        quantity: actualFirstQty,
        filled: 0,
        status: 'NEW',
        timestamp: Date.now(),
      }];

      // 포지션 생성 (진입 대기 상태) - actualSecondQty 저장
      const newPosition: LimitOrderPosition = {
        symbol,
        side,
        entries,
        avgPrice: 0,
        totalQuantity: actualFirstQty + actualSecondQty, // 전체 목표 수량 (축소 반영)
        filledQuantity: 0,
        startTime: Date.now(),
        entryPhase: 'waiting',
        takeProfitOrders: [],
        stopLossPrice: 0,
        // 추가 정보 (2차 진입용)
        pendingSecondQty: actualSecondQty,
      } as any;

      setState(prev => ({
        ...prev,
        pendingSignal: null,
        currentPosition: newPosition,
        currentSymbol: symbol,
        entryOrderIds: [orderId],
        entryStartTime: Date.now(),
        statusMessage: `⏳ ${symbol.replace('USDT', '')} 1차 체결 대기 (${LIMIT_ORDER_CONFIG.ENTRY.TIMEOUT_SEC}초)...`,
      }));

      addLog({
        symbol,
        action: 'order',
        side,
        price: roundedFirstPrice,
        quantity: actualFirstQty,
        reason: actualFirstQty < firstQty 
          ? `1차 지정가 진입 (한도축소 ${((actualFirstQty / firstQty) * 100).toFixed(0)}%)`
          : `1차 지정가 진입 (50%)`,
      });

      lastEntryTimeRef.current = Date.now();

      // 타임아웃 설정
      entryTimeoutRef.current = setTimeout(async () => {
        if (checkEntryFillRef.current) {
          await checkEntryFillRef.current(symbol, side, false);
        }
      }, LIMIT_ORDER_CONFIG.ENTRY.TIMEOUT_SEC * 1000);

      playEntrySound();
      toast.info(`📝 ${side === 'long' ? '롱' : '숏'} 1차 지정가 진입`);

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

  // ===== 체결 확인 (2단계 진입) =====
  const checkEntryFill = useCallback(async (symbol: string, side: 'long' | 'short', isRetry: boolean = false) => {
    const currentPos = currentPositionRef.current;
    if (!currentPos || currentPos.entryPhase !== 'waiting') {
      console.log(`[checkEntryFill] ${symbol} 스킵 - position: ${!!currentPos}, phase: ${currentPos?.entryPhase}`);
      return;
    }

    try {
      // 포지션 조회
      const positions = await getPositions(symbol);
      
      // API가 null을 반환하면 (테스트넷 키 미로드 등) 강제 취소 처리
      if (!positions) {
        console.warn(`⚠️ [checkEntryFill] ${symbol} API 응답 없음 → 강제 취소 처리`);
        await cancelPendingOrders(symbol);
        
        setState(prev => ({
          ...prev,
          currentPosition: null,
          currentSymbol: null,
          entryOrderIds: [],
          entryStartTime: null,
          statusMessage: '⚠️ API 오류, 다음 종목 스캔...',
        }));

        addLog({
          symbol,
          action: 'cancel',
          side,
          price: 0,
          quantity: 0,
          reason: `API 응답 없음 (키 미로드)`,
        });
        
        toast.warning(`⚠️ ${symbol.replace('USDT', '')} API 오류로 취소`);
        return;
      }
      
      const actualPosition = positions.find((p: any) =>
        p.symbol === symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );

      const filledQty = actualPosition ? Math.abs(parseFloat(actualPosition.positionAmt)) : 0;
      const firstEntryQty = currentPos.entries[0]?.quantity || 0;
      const fillRatio = firstEntryQty > 0 ? filledQty / firstEntryQty : 0;

      if (filledQty === 0) {
        // 완전 미체결 → 변동성 없음, 전량 취소
        console.log(`🚫 [타임아웃] ${symbol} ${LIMIT_ORDER_CONFIG.ENTRY.TIMEOUT_SEC}초 내 미체결 → 전량 취소`);
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
          reason: `${LIMIT_ORDER_CONFIG.ENTRY.TIMEOUT_SEC}초 내 미체결 (변동성 부족)`,
        });

        toast.info(`🚫 ${symbol.replace('USDT', '')} 변동성 부족, 다음 종목 탐색`);
        return;
      }

      // 1차 지정가 체결됨 → 미체결 주문 취소 후 2차 시장가 진입
      console.log(`✅ [1차 체결] ${symbol} 체결률: ${(fillRatio * 100).toFixed(1)}% (${filledQty})`);
      await cancelPendingOrders(symbol);

      const avgPrice = parseFloat(actualPosition!.entryPrice);
      const pendingSecondQty = (currentPos as any).pendingSecondQty || 0;
      const orderSide = side === 'long' ? 'BUY' : 'SELL';

      // 2차 시장가 진입
      let secondFilledQty = 0;
      let finalAvgPrice = avgPrice;
      
      if (pendingSecondQty > 0) {
        console.log(`📈 [2차 시장가] ${symbol} ${orderSide} 수량=${pendingSecondQty.toFixed(8)}`);
        
        try {
          const marketResult = await placeMarketOrder(symbol, orderSide, pendingSecondQty, false);
          
          if (marketResult && !marketResult.error) {
            // 2차 체결 후 포지션 재조회
            await new Promise(resolve => setTimeout(resolve, 500)); // 0.5초 대기
            const updatedPositions = await getPositions(symbol);
            const updatedPos = updatedPositions?.find((p: any) =>
              p.symbol === symbol && Math.abs(parseFloat(p.positionAmt)) > 0
            );
            
            if (updatedPos) {
              secondFilledQty = Math.abs(parseFloat(updatedPos.positionAmt)) - filledQty;
              finalAvgPrice = parseFloat(updatedPos.entryPrice);
              console.log(`✅ [2차 체결] 추가 수량=${secondFilledQty.toFixed(8)} 평균가=${finalAvgPrice}`);
            }

            addLog({
              symbol,
              action: 'fill',
              side,
              price: finalAvgPrice,
              quantity: secondFilledQty,
              reason: `2차 시장가 진입 (50%)`,
            });

            toast.success(`✅ 2차 시장가 체결!`);
          } else {
            const errMsg = marketResult?.error || marketResult?.msg || '2차 시장가 실패';
            console.warn(`2차 시장가 실패:`, errMsg);
            toast.warning(`2차 시장가 실패: ${errMsg}`);
          }
        } catch (marketError: any) {
          console.warn(`2차 시장가 예외:`, marketError?.message);
          toast.warning(`2차 시장가 실패`);
        }
      }

      // 최종 체결 수량
      const totalFilledQty = filledQty + secondFilledQty;
      
      // ===== 바이낸스에 STOP_MARKET / TAKE_PROFIT_MARKET 주문 설정 =====
      const closeSide = side === 'long' ? 'SELL' : 'BUY';
      const positionValueUsd = finalAvgPrice * totalFilledQty;
      
      // USDT 기반 손절/익절 금액
      const targetStopLossUsdt = filterSettings?.stopLossUsdt ?? 7;
      const targetTakeProfitUsdt = filterSettings?.takeProfitUsdt ?? 7;
      
      // 손절가/익절가 계산 (USDT 금액 기반)
      const slPercent = (targetStopLossUsdt / positionValueUsd) * 100;
      const tpPercent = (targetTakeProfitUsdt / positionValueUsd) * 100;
      
      let slPrice: number;
      let tpPrice: number;
      
      if (side === 'long') {
        slPrice = finalAvgPrice * (1 - slPercent / 100);
        tpPrice = finalAvgPrice * (1 + tpPercent / 100);
      } else {
        slPrice = finalAvgPrice * (1 + slPercent / 100);
        tpPrice = finalAvgPrice * (1 - tpPercent / 100);
      }
      
      console.log(`📊 [SL/TP 계산] 포지션가치=$${positionValueUsd.toFixed(2)} | SL=$${targetStopLossUsdt}→${slPrice.toFixed(4)} | TP=$${targetTakeProfitUsdt}→${tpPrice.toFixed(4)}`);
      
      // STOP_MARKET 주문 (손절)
      try {
        const slResult = await placeStopMarketOrder(symbol, closeSide, totalFilledQty, slPrice);
        if (slResult && !slResult.error) {
          console.log(`✅ [STOP_MARKET] 설정 완료! 손절가=${slPrice.toFixed(4)}`);
          toast.info(`🛑 손절 주문 설정: $${slPrice.toFixed(4)}`);
        } else {
          console.warn(`❌ STOP_MARKET 실패:`, slResult?.error || slResult?.msg);
        }
      } catch (slError: any) {
        console.warn(`❌ STOP_MARKET 예외:`, slError?.message);
      }
      
      // TAKE_PROFIT_MARKET 주문 (익절)
      try {
        const tpResult = await placeTakeProfitMarketOrder(symbol, closeSide, totalFilledQty, tpPrice);
        if (tpResult && !tpResult.error) {
          console.log(`✅ [TAKE_PROFIT_MARKET] 설정 완료! 익절가=${tpPrice.toFixed(4)}`);
          toast.info(`💰 익절 주문 설정: $${tpPrice.toFixed(4)}`);
        } else {
          console.warn(`❌ TAKE_PROFIT_MARKET 실패:`, tpResult?.error || tpResult?.msg);
        }
      } catch (tpError: any) {
        console.warn(`❌ TAKE_PROFIT_MARKET 예외:`, tpError?.message);
      }

      // 포지션 활성화 (entries에 2차 진입도 추가)
      setState(prev => {
        if (!prev.currentPosition) return prev;
        
        // 기존 entries에 2차 시장가 진입 추가
        const updatedEntries = [...prev.currentPosition.entries];
        if (secondFilledQty > 0) {
          updatedEntries.push({
            orderId: `market_${Date.now()}`,
            price: finalAvgPrice, // 2차는 시장가이므로 평균가 사용
            quantity: secondFilledQty,
            filled: secondFilledQty,
            status: 'FILLED' as const,
            timestamp: Date.now(),
          });
        }
        // 1차 진입도 체결 상태로 업데이트
        if (updatedEntries[0]) {
          updatedEntries[0] = {
            ...updatedEntries[0],
            filled: filledQty,
            status: 'FILLED' as const,
          };
        }
        
        return {
          ...prev,
          currentPosition: {
            ...prev.currentPosition,
            entries: updatedEntries,
            avgPrice: finalAvgPrice,
            filledQuantity: totalFilledQty,
            entryPhase: 'active',
            startTime: Date.now(),
            stopLossPrice: slPrice,
          },
          entryOrderIds: [],
          statusMessage: `🔄 ${symbol.replace('USDT', '')} ${side === 'long' ? '롱' : '숏'} 활성화 (SL/TP 설정됨)`,
        };
      });

      addLog({
        symbol,
        action: 'fill',
        side,
        price: finalAvgPrice,
        quantity: totalFilledQty,
        reason: `2단계 진입 완료 + SL/TP 설정`,
      });

      toast.success(`✅ ${side === 'long' ? '롱' : '숏'} 진입 완료! SL/TP 자동 설정됨`);

    } catch (error: any) {
      console.error('체결 확인 실패:', error);
    }
  }, [getPositions, cancelPendingOrders, addLog, filterSettings, placeMarketOrder, placeStopMarketOrder, placeTakeProfitMarketOrder]);

  // checkEntryFill을 ref에 저장 (재귀 호출용)
  useEffect(() => {
    checkEntryFillRef.current = checkEntryFill;
  }, [checkEntryFill]);

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

    // ===== 5봉 연속 진행 필터 (한 방향 과열 방지) =====
    try {
      const klines1m = await fetch1mKlines(symbol, 6); // 최근 6봉 (현재봉 제외하고 5봉 분석)
      if (klines1m && klines1m.length >= 6) {
        // 최신봉(현재 미완성봉) 제외하고 완성된 5봉 분석
        // klines는 최신순이므로 [0]이 현재봉, [1]~[5]가 완성된 최근 5봉
        const last5Candles = klines1m.slice(1, 6);
        
        // "연속" 양봉/음봉 카운트 - 끊기면 리셋
        let consecutiveBullish = 0;
        let consecutiveBearish = 0;
        
        // 가장 최근 완성봉부터 역순으로 연속 체크
        for (const candle of last5Candles) {
          const isBullish = candle.close > candle.open;
          const isBearish = candle.close < candle.open;
          
          if (isBullish) {
            if (consecutiveBearish > 0) break; // 음봉이 있었으면 연속 끊김
            consecutiveBullish++;
          } else if (isBearish) {
            if (consecutiveBullish > 0) break; // 양봉이 있었으면 연속 끊김
            consecutiveBearish++;
          } else {
            // 도지봉(시가=종가)은 연속 유지하지 않음
            break;
          }
        }
        
        // 5봉 연속 양봉 → 롱 진입 금지 (이미 많이 상승)
        if (consecutiveBullish >= 5 && direction === 'long') {
          console.log(`🚫 [5봉필터] ${symbol} 5봉 연속 양봉 → 롱 진입 금지 (과매수)`);
          return;
        }
        
        // 5봉 연속 음봉 → 숏 진입 금지 (이미 많이 하락)
        if (consecutiveBearish >= 5 && direction === 'short') {
          console.log(`🚫 [5봉필터] ${symbol} 5봉 연속 음봉 → 숏 진입 금지 (과매도)`);
          return;
        }
      }
    } catch (err) {
      console.warn('5봉 필터 확인 실패:', err);
    }

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
      const positions = await getPositions(state.currentPosition.symbol);
      const actualPosition = positions?.find((p: any) =>
        p.symbol === state.currentPosition!.symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );

      const currentPrice = actualPosition
        ? parseFloat((actualPosition as any).markPrice || (actualPosition as any).entryPrice || '0')
        : state.currentPosition.avgPrice;

      await closePositionMarket('cancel', currentPrice);
    } catch (error) {
      console.error('수동 청산 실패:', error);
      toast.error('청산 실패');
    }
  }, [state.currentPosition, closePositionMarket, getPositions]);

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

  // ===== 수동 시장가 진입 (분할 매수 지원) =====
  const manualMarketEntry = useCallback(async (symbol: string, direction: 'long' | 'short', splitCount: number = 5) => {
    console.log(`📌 [manualMarketEntry] 호출됨: ${symbol} ${direction} (${splitCount}분할)`);
    console.log(`📌 [manualMarketEntry] isEnabled: ${state.isEnabled}, currentPosition: ${!!state.currentPosition}, user: ${!!user}`);
    
    // 스캔 활성화 체크 제거 - 수동 진입은 언제든 가능해야 함
    if (state.currentPosition) {
      toast.error('이미 포지션이 있습니다');
      return;
    }
    if (!user) {
      toast.error('로그인이 필요합니다');
      return;
    }
    if (processingRef.current) {
      toast.error('처리 중입니다');
      return;
    }

    console.log(`🚀 [manualMarketEntry] 주문 시작: ${symbol} ${direction} (${splitCount}분할)`);
    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true, statusMessage: `⏳ ${symbol} ${direction === 'long' ? '롱' : '숏'} 시장가 진입 중...` }));

    try {
      initAudio();
      const precision = await fetchSymbolPrecision(symbol, isTestnet);
      
      // 레버리지 설정 (중요!)
      let appliedLeverage = leverage;
      const leverageCandidates = Array.from(
        new Set([leverage, 10, 5, 3, 2, 1].filter((v) => v <= leverage))
      );

      for (const lev of leverageCandidates) {
        try {
          const res = await setLeverage(symbol, lev);
          appliedLeverage = lev;
          if (!res?.alreadySet) {
            console.log(`🧲 [Leverage] ${symbol} 적용: ${lev}x`);
          }
          break;
        } catch (levError: any) {
          console.warn(`레버리지 설정 실패(${lev}x):`, levError?.message);
          continue;
        }
      }
      
      // 전체 자금의 비율로 수량 계산
      const positionSizeRatio = LIMIT_ORDER_CONFIG.POSITION_SIZE_PERCENT / 100;
      const positionValueUSD = balanceUSD * positionSizeRatio * appliedLeverage;
      
      // 현재가 조회
      const tickerRes = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
      const tickerData = await tickerRes.json();
      const currentPrice = parseFloat(tickerData.price);
      
      if (!currentPrice || currentPrice <= 0) {
        throw new Error('현재가 조회 실패');
      }
      
      // 전체 수량 계산 (반올림은 마지막에만)
      const rawTotalQuantity = positionValueUSD / currentPrice;
      
      // 분할 수량 계산: 1분할이면 전체, 아니면 분할
      const rawSplitQuantity = splitCount === 1 ? rawTotalQuantity : rawTotalQuantity / splitCount;
      const splitQuantity = roundQuantity(rawSplitQuantity, precision);
      
      // 실제 총 수량 계산
      const actualTotalQty = splitQuantity * splitCount;
      const actualTotalValue = actualTotalQty * currentPrice;
      
      console.log(`💰 [시장가 계산] balanceUSD=${balanceUSD.toFixed(2)} × ${(positionSizeRatio * 100).toFixed(0)}% × ${appliedLeverage}x = ${positionValueUSD.toFixed(2)} USDT`);
      console.log(`📊 [시장가 수량] rawTotal=${rawTotalQuantity.toFixed(4)} → split(${splitCount}) → ${splitQuantity} × ${splitCount} = ${actualTotalQty.toFixed(4)} (${actualTotalValue.toFixed(2)} USDT)`);
      
      // 최소 주문 검증
      const splitNotional = splitQuantity * currentPrice;
      if (splitNotional < precision.minNotional) {
        throw new Error(`분할당 주문 금액이 최소 ${precision.minNotional} USDT 이상이어야 합니다. 현재: ${splitNotional.toFixed(2)} USDT`);
      }
      
      if (splitQuantity <= 0) {
        toast.error('잔고가 부족합니다');
        return;
      }
      
      const orderSide = direction === 'long' ? 'BUY' : 'SELL';
      
      console.log(`🚀 [수동 시장가] ${symbol} ${direction} ${splitQuantity} x ${splitCount}분할 (총 ${actualTotalQty})`);
      
      // 분할 주문 실행
      let totalFilledQty = 0;
      let totalFilledValue = 0;
      let successCount = 0;
      
      for (let i = 0; i < splitCount; i++) {
        try {
          const result = await placeMarketOrder(symbol, orderSide, splitQuantity, false, currentPrice);
          
          if (result && !result.error) {
            const filledQty = parseFloat(result.executedQty || splitQuantity);
            const filledPrice = parseFloat(result.avgPrice || currentPrice);
            totalFilledQty += filledQty;
            totalFilledValue += filledQty * filledPrice;
            successCount++;
            console.log(`  ✅ ${i + 1}/${splitCount} 체결: ${filledQty} @ ${filledPrice}`);
          } else {
            console.warn(`  ❌ ${i + 1}/${splitCount} 실패:`, result?.error);
          }
          
          // 주문 간 약간의 딜레이 (연속 주문 방지)
          if (i < splitCount - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (orderError: any) {
          console.error(`  ❌ ${i + 1}/${splitCount} 오류:`, orderError.message);
        }
      }
      
      if (successCount === 0 || totalFilledQty === 0) {
        throw new Error('모든 주문이 실패했습니다');
      }
      
      // 바이낸스 실제 포지션 조회하여 정확한 데이터 사용
      await new Promise(resolve => setTimeout(resolve, 500));
      const positions = await getPositions(symbol);
      const actualPosition = positions?.find((p: any) =>
        p.symbol === symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );
      
      let finalQty = totalFilledQty;
      let finalAvgPrice = totalFilledValue / totalFilledQty;
      let unrealizedPnl = 0;
      let markPrice = currentPrice;
      
      if (actualPosition) {
        finalQty = Math.abs(parseFloat(actualPosition.positionAmt));
        finalAvgPrice = parseFloat(actualPosition.entryPrice);
        unrealizedPnl = parseFloat(actualPosition.unRealizedProfit || '0');
        markPrice = parseFloat(actualPosition.markPrice || String(currentPrice));
        console.log(`📊 [바이낸스 포지션 확인] 수량=${finalQty} 평단=${finalAvgPrice} PnL=$${unrealizedPnl.toFixed(2)}`);
      }
      
      playEntrySound();
      
      // ===== 바이낸스에 STOP_MARKET / TAKE_PROFIT_MARKET 주문 설정 =====
      const closeSide = direction === 'long' ? 'SELL' : 'BUY';
      const positionValueUsd = finalAvgPrice * finalQty;
      
      const targetStopLossUsdt = filterSettings?.stopLossUsdt ?? 7;
      const targetTakeProfitUsdt = filterSettings?.takeProfitUsdt ?? 7;
      
      const slPercent = (targetStopLossUsdt / positionValueUsd) * 100;
      const tpPercent = (targetTakeProfitUsdt / positionValueUsd) * 100;
      
      let slPrice: number;
      let tpPrice: number;
      
      if (direction === 'long') {
        slPrice = finalAvgPrice * (1 - slPercent / 100);
        tpPrice = finalAvgPrice * (1 + tpPercent / 100);
      } else {
        slPrice = finalAvgPrice * (1 + slPercent / 100);
        tpPrice = finalAvgPrice * (1 - tpPercent / 100);
      }
      
      console.log(`📊 [SL/TP 설정] 포지션가치=$${positionValueUsd.toFixed(2)} | SL=$${targetStopLossUsdt}→${slPrice.toFixed(4)} | TP=$${targetTakeProfitUsdt}→${tpPrice.toFixed(4)}`);
      
      // STOP_MARKET 주문
      try {
        const slResult = await placeStopMarketOrder(symbol, closeSide, finalQty, slPrice);
        if (slResult && !slResult.error) {
          console.log(`✅ [STOP_MARKET] 설정 완료! 손절가=${slPrice.toFixed(4)}`);
          toast.info(`🛑 손절 주문 설정: $${slPrice.toFixed(4)}`);
        }
      } catch (slError: any) {
        console.warn(`❌ STOP_MARKET 실패:`, slError?.message);
      }
      
      // TAKE_PROFIT_MARKET 주문
      try {
        const tpResult = await placeTakeProfitMarketOrder(symbol, closeSide, finalQty, tpPrice);
        if (tpResult && !tpResult.error) {
          console.log(`✅ [TAKE_PROFIT_MARKET] 설정 완료! 익절가=${tpPrice.toFixed(4)}`);
          toast.info(`💰 익절 주문 설정: $${tpPrice.toFixed(4)}`);
        }
      } catch (tpError: any) {
        console.warn(`❌ TAKE_PROFIT_MARKET 실패:`, tpError?.message);
      }
      
      // 포지션 상태 저장 (바이낸스 실제 데이터 기준)
      const newPosition: LimitOrderPosition = {
        symbol,
        side: direction,
        entries: [{
          price: finalAvgPrice,
          quantity: finalQty,
          orderId: 'manual-market',
          status: 'FILLED',
          filled: finalQty,
          timestamp: Date.now(),
        }],
        filledQuantity: finalQty,
        totalQuantity: finalQty,
        avgPrice: finalAvgPrice,
        stopLossPrice: slPrice,
        startTime: Date.now(),
        entryPhase: 'active',
        takeProfitOrders: [],
        unrealizedPnl,
        markPrice,
      };
      
      currentPositionRef.current = newPosition;
      lastSyncedPositionRef.current = `${symbol}-${direction}-${finalQty.toFixed(6)}`;
      
      setState(prev => ({
        ...prev,
        currentPosition: newPosition,
        currentSymbol: symbol,
        statusMessage: `✅ ${symbol} ${direction === 'long' ? '롱' : '숏'} 진입 완료 (SL/TP 설정됨)`,
        isProcessing: false,
      }));
      
      addLog({
        symbol,
        action: 'fill',
        side: direction,
        price: finalAvgPrice,
        quantity: finalQty,
        reason: `수동 시장가 진입 (${successCount}/${splitCount}분할) + SL/TP`,
      });
      
      toast.success(`🚀 ${symbol.replace('USDT', '')} ${direction === 'long' ? '롱' : '숏'} 체결! SL/TP 자동 설정됨`);
      
    } catch (error: any) {
      console.error('수동 진입 실패:', error);
      toast.error(`진입 실패: ${error.message}`);
      setState(prev => ({
        ...prev,
        isProcessing: false,
        statusMessage: '🔍 시그널 스캔 중...',
      }));
    } finally {
      processingRef.current = false;
    }
  }, [state.currentPosition, user, balanceUSD, leverage, isTestnet, placeMarketOrder, setLeverage, filterSettings, addLog, getPositions, placeStopMarketOrder, placeTakeProfitMarketOrder]);

  // ===== 수동 지정가 진입 (분할 매수 지원) =====
  const manualLimitEntry = useCallback(async (symbol: string, direction: 'long' | 'short', price: number, splitCount: number = 5) => {
    console.log(`📌 [manualLimitEntry] 호출됨: ${symbol} ${direction} @ ${price} (${splitCount}분할)`);
    
    if (!user) {
      toast.error('로그인이 필요합니다');
      return;
    }
    const existing = state.currentPosition;
    if (existing && (existing.symbol !== symbol || existing.side !== direction)) {
      toast.error('다른 포지션이 있어 추가 진입 불가');
      return;
    }
    if (processingRef.current) {
      toast.error('처리 중입니다');
      return;
    }

    processingRef.current = true;
    setState(prev => ({
      ...prev,
      isProcessing: true,
      statusMessage: `⏳ ${symbol} ${existing ? '추가 진입' : ''} 지정가 주문 중...`,
    }));

    try {
      initAudio();
      
      // 심볼 정밀도 조회
      const precision = await fetchSymbolPrecision(symbol, isTestnet);
      
      // 레버리지 설정 (중요!)
      let appliedLeverage = leverage;
      const leverageCandidates = Array.from(
        new Set([leverage, 10, 5, 3, 2, 1].filter((v) => v <= leverage))
      );

      for (const lev of leverageCandidates) {
        try {
          const res = await setLeverage(symbol, lev);
          appliedLeverage = lev;
          if (!res?.alreadySet) {
            console.log(`🧲 [Leverage] ${symbol} 적용: ${lev}x`);
          }
          break;
        } catch (levError: any) {
          const msg = levError?.message || String(levError);
          console.warn(`레버리지 설정 실패(${lev}x):`, msg);
          continue;
        }
      }

      if (appliedLeverage !== leverage) {
        toast.warning(`⚠️ 레버리지 ${leverage}x → ${appliedLeverage}x로 적용됨`);
      }
      
      // 포지션 사이즈 계산 (잔고의 POSITION_SIZE_PERCENT% × 적용된 레버리지)
      const positionSizeRatio = LIMIT_ORDER_CONFIG.POSITION_SIZE_PERCENT / 100;
      const positionValueUSD = balanceUSD * positionSizeRatio * appliedLeverage;
      const totalQuantity = positionValueUSD / price;
      
      // 1분할인 경우 전체 수량, 아니면 분할
      const rawSplitQuantity = splitCount === 1 ? totalQuantity : totalQuantity / splitCount;

      const roundedPrice = roundPrice(price, precision);
      const roundedSplitQty = roundQuantity(rawSplitQuantity, precision);
      
      // 실제 총 주문 수량 계산
      const actualTotalQty = roundedSplitQty * splitCount;
      const actualTotalValue = actualTotalQty * roundedPrice;

      console.log(`💰 [지정가 계산] balanceUSD=${balanceUSD.toFixed(2)} × ${(positionSizeRatio * 100).toFixed(0)}% × ${appliedLeverage}x = ${positionValueUSD.toFixed(2)} USDT`);
      console.log(`📊 [지정가 수량] totalQty=${totalQuantity.toFixed(4)} → split(${splitCount}) → ${roundedSplitQty} × ${splitCount} = ${actualTotalQty.toFixed(4)} (${actualTotalValue.toFixed(2)} USDT)`);

      const splitNotional = roundedSplitQty * roundedPrice;
      if (splitNotional < precision.minNotional) {
        throw new Error(
          `분할당 주문 금액이 최소 ${precision.minNotional} USDT 이상이어야 합니다. 현재(분할당): ${splitNotional.toFixed(2)} USDT`
        );
      }

      console.log(
        `📊 지정가 ${splitCount}분할 주문: ${symbol} ${direction} @ ${roundedPrice}, qty: ${roundedSplitQty} x ${splitCount} (레버리지: ${appliedLeverage}x)`
      );

      // splitCount 만큼 개별 주문 생성 - 가격 분산!
      // 롱: 클릭가격에서 아래로 분산 (5,4,3,2,1 식으로)
      // 숏: 클릭가격에서 위로 분산 (1,2,3,4,5 식으로)
      const priceStep = precision.tickSize * 10; // 틱사이즈 x 10 간격으로 분산
      
      for (let i = 0; i < splitCount; i++) {
        // 가격 분산 계산
        // 롱: 첫 주문이 가장 높은 가격, 마지막이 가장 낮은 가격
        // 숏: 첫 주문이 가장 낮은 가격, 마지막이 가장 높은 가격
        const priceOffset = direction === 'long' 
          ? -priceStep * i  // 롱: 아래로 분산
          : priceStep * i;  // 숏: 위로 분산
        
        const orderPrice = roundPrice(roundedPrice + priceOffset, precision);
        
        console.log(`  📌 ${i + 1}/${splitCount} 주문: ${orderPrice} (offset: ${priceOffset > 0 ? '+' : ''}${priceOffset})`);
        
        const result = await placeLimitOrder(
          symbol,
          direction === 'long' ? 'BUY' : 'SELL',
          roundedSplitQty,
          orderPrice,
          false
        );

        if (!result) {
          throw new Error('주문 응답이 없습니다');
        }

        addLog({
          symbol,
          action: 'order',
          side: direction,
          price: orderPrice,
          quantity: roundedSplitQty,
          reason: `수동 지정가 주문 (${i + 1}/${splitCount}분할) @ ${orderPrice}`,
        });
        
        // 연속 주문 방지 딜레이
        if (i < splitCount - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      playEntrySound();
      toast.success(
        `📝 ${symbol.replace('USDT', '')} ${direction === 'long' ? '롱' : '숏'} 지정가 ${splitCount}분할 주문 완료! @ ${roundedPrice}`
      );

      setState(prev => ({
        ...prev,
        isProcessing: false,
        statusMessage: `📝 ${symbol} 지정가 대기 중... (${splitCount}개)`,
      }));
    } catch (error: any) {
      console.error('지정가 주문 실패:', error);
      toast.error(`주문 실패: ${error.message}`);
      setState(prev => ({
        ...prev,
        isProcessing: false,
        statusMessage: '🔍 시그널 스캔 중...',
      }));
    } finally {
      processingRef.current = false;
    }
  }, [state.currentPosition, user, balanceUSD, leverage, isTestnet, placeLimitOrder, addLog]);

  // ===== 손절/익절 설정 변경 시 바이낸스 SL/TP 주문 업데이트 =====
  const prevSlTpRef = useRef<{ sl: number; tp: number } | null>(null);
  
  useEffect(() => {
    let isMounted = true;
    
    const currentSl = filterSettings?.stopLossUsdt ?? 7;
    const currentTp = filterSettings?.takeProfitUsdt ?? 7;
    
    // 초기 로드 시 값 저장만 하고 리턴
    if (!prevSlTpRef.current) {
      prevSlTpRef.current = { sl: currentSl, tp: currentTp };
      return;
    }
    
    // 설정 변경 감지
    const slChanged = prevSlTpRef.current.sl !== currentSl;
    const tpChanged = prevSlTpRef.current.tp !== currentTp;
    
    if (!slChanged && !tpChanged) return;
    
    // 활성 포지션이 있을 때만 업데이트
    const position = currentPositionRef.current;
    if (!position || position.entryPhase !== 'active') {
      prevSlTpRef.current = { sl: currentSl, tp: currentTp };
      return;
    }
    
    // 처리 중이면 스킵
    if (processingRef.current) return;
    
    // 비동기로 SL/TP 업데이트 실행
    const updateSlTpOrders = async () => {
      console.log(`🔄 [SL/TP 변경 감지] SL: $${prevSlTpRef.current?.sl} → $${currentSl} | TP: $${prevSlTpRef.current?.tp} → $${currentTp}`);
      prevSlTpRef.current = { sl: currentSl, tp: currentTp };
      
      try {
        // 기존 미체결 주문 전량 취소 (SL/TP 포함)
        console.log(`🚫 [SL/TP 업데이트] ${position.symbol} 기존 SL/TP 주문 취소 중...`);
        await cancelAllOrders(position.symbol);
        
        if (!isMounted) return;
        
        // 잠시 대기 (취소 반영)
        await new Promise(resolve => setTimeout(resolve, 300));
        
        if (!isMounted) return;
        
        // 실제 포지션 조회
        const positions = await getPositions(position.symbol);
        
        if (!isMounted) return;
        
        const actualPosition = positions?.find((p: any) =>
          p.symbol === position.symbol && Math.abs(parseFloat(p.positionAmt)) > 0
        );
        
        if (!actualPosition) {
          console.log(`⚠️ [SL/TP 업데이트] ${position.symbol} 포지션 없음, 스킵`);
          return;
        }
        
        const qty = Math.abs(parseFloat(actualPosition.positionAmt));
        const avgPrice = parseFloat(actualPosition.entryPrice);
        const closeSide = position.side === 'long' ? 'SELL' : 'BUY';
        const positionValueUsd = avgPrice * qty;
        
        // 새 손절가/익절가 계산
        const slPercent = (currentSl / positionValueUsd) * 100;
        const tpPercent = (currentTp / positionValueUsd) * 100;
        
        let slPrice: number;
        let tpPrice: number;
        
        if (position.side === 'long') {
          slPrice = avgPrice * (1 - slPercent / 100);
          tpPrice = avgPrice * (1 + tpPercent / 100);
        } else {
          slPrice = avgPrice * (1 + slPercent / 100);
          tpPrice = avgPrice * (1 - tpPercent / 100);
        }
        
        console.log(`📊 [새 SL/TP] 포지션가치=$${positionValueUsd.toFixed(2)} | SL=$${currentSl}→${slPrice.toFixed(4)} | TP=$${currentTp}→${tpPrice.toFixed(4)}`);
        
        // 새 STOP_MARKET 주문
        try {
          const slResult = await placeStopMarketOrder(position.symbol, closeSide, qty, slPrice);
          if (isMounted && slResult && !slResult.error) {
            console.log(`✅ [STOP_MARKET] 재설정 완료! 손절가=${slPrice.toFixed(4)}`);
            toast.success(`🛑 손절가 변경: $${slPrice.toFixed(2)}`);
          }
        } catch (slError: any) {
          console.warn(`❌ STOP_MARKET 재설정 실패:`, slError?.message);
        }
        
        if (!isMounted) return;
        
        // 새 TAKE_PROFIT_MARKET 주문
        try {
          const tpResult = await placeTakeProfitMarketOrder(position.symbol, closeSide, qty, tpPrice);
          if (isMounted && tpResult && !tpResult.error) {
            console.log(`✅ [TAKE_PROFIT_MARKET] 재설정 완료! 익절가=${tpPrice.toFixed(4)}`);
            toast.success(`💰 익절가 변경: $${tpPrice.toFixed(2)}`);
          }
        } catch (tpError: any) {
          console.warn(`❌ TAKE_PROFIT_MARKET 재설정 실패:`, tpError?.message);
        }
        
        if (!isMounted) return;
        
        // 포지션 상태에 새 손절가 저장
        setState(prev => {
          if (!prev.currentPosition) return prev;
          return {
            ...prev,
            currentPosition: {
              ...prev.currentPosition,
              stopLossPrice: slPrice,
            },
            statusMessage: `✅ SL/TP 업데이트 완료!`,
          };
        });
        
      } catch (error: any) {
        console.error('[SL/TP 업데이트 오류]', error);
        if (isMounted) {
          toast.error('SL/TP 업데이트 실패');
        }
      }
    };
    
    updateSlTpOrders();
    
    return () => {
      isMounted = false;
    };
  }, [filterSettings?.stopLossUsdt, filterSettings?.takeProfitUsdt, cancelAllOrders, getPositions, placeStopMarketOrder, placeTakeProfitMarketOrder]);

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
    manualMarketEntry,
    manualLimitEntry,
    addLog,
  };
}
