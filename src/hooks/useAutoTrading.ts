/**
 * 고급 스캘핑 자동매매 시스템
 * - 기술적 지표 기반 진입
 * - 3단계 익절 + 트레일링 스탑
 * - 적응형 손절
 * - 리스크 관리
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useBinanceApi } from './useBinanceApi';
import { useAuth } from './useAuth';
import { fetchSymbolPrecision, roundQuantity } from '@/lib/binance';
import { playEntrySound, playTpSound, playSlSound, initAudio } from '@/lib/sounds';
import { toast } from 'sonner';
import {
  calculateAllIndicators,
  checkLongSignal,
  checkShortSignal,
  fetch5mKlines,
  fetch1mKlines,
  TechnicalIndicators,
  Kline,
} from './useTechnicalIndicators';

export interface AutoTradeLog {
  id: string;
  timestamp: number;
  symbol: string;
  action: 'entry' | 'exit' | 'tp' | 'sl' | 'error' | 'pending' | 'cancel' | 'partial_tp';
  side: 'long' | 'short';
  price: number;
  quantity: number;
  pnl?: number;
  reason: string;
}

// 대기 중인 시그널
interface PendingSignal {
  symbol: string;
  direction: 'long' | 'short';
  strength: 'weak' | 'medium' | 'strong';
  reasons: string[];
  signalTime: number;
  signalPrice: number;
  indicators: TechnicalIndicators;
  confirmCount: number; // 확인 봉 횟수
}

// 3단계 익절 상태
interface TakeProfitState {
  stage1Hit: boolean; // +0.3% (40% 청산)
  stage2Hit: boolean; // +0.8% (40% 청산)
  stage3Hit: boolean; // +1.5% (20% 청산)
  trailingActive: boolean;
  trailingHighPrice: number; // 롱: 최고가, 숏: 최저가
  trailingTriggerPrice: number; // 트레일링 시작 가격
}

// 포지션 정보
interface Position {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  initialQuantity: number;
  remainingQuantity: number;
  entryTime: number;
  atr: number;
  takeProfitState: TakeProfitState;
  indicators: TechnicalIndicators;
}

export interface AutoTradingState {
  isEnabled: boolean;
  isProcessing: boolean;
  currentSymbol: string | null;
  pendingSignal: PendingSignal | null;
  currentPosition: Position | null;
  todayStats: {
    trades: number;
    wins: number;
    losses: number;
    totalPnL: number;
  };
  tradeLogs: AutoTradeLog[];
  consecutiveLosses: number;
  cooldownUntil: number | null;
  tpPercent: number;
  statusMessage: string;
  scanningProgress: string;
}

interface UseAutoTradingProps {
  balanceUSD: number;
  leverage: number;
  krwRate: number;
  onTradeComplete?: () => void;
  initialStats?: { trades: number; wins: number; losses: number; totalPnL: number };
  logTrade?: (trade: {
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    leverage: number;
    pnlUsd: number;
  }) => Promise<void>;
}

// 설정값
const CONFIG = {
  // 익절 단계
  TP_STAGE_1: { percent: 0.3, closeRatio: 0.4 },  // +0.3%에서 40% 청산
  TP_STAGE_2: { percent: 0.8, closeRatio: 0.4 },  // +0.8%에서 40% 청산
  TP_STAGE_3: { percent: 1.5, closeRatio: 1.0 },  // +1.5%에서 전량 청산
  
  // 트레일링 스탑
  TRAILING_TRIGGER: 0.4,     // +0.4% 도달 시 트레일링 활성화
  TRAILING_DISTANCE: 0.15,   // 0.15% 거리 유지
  
  // 손절
  HARD_STOP_PERCENT: 0.5,    // -0.5% 하드 스탑
  TIME_STOP_MINUTES: 15,     // 15분 타임 스탑
  
  // 진입 조건
  MIN_SIGNAL_STRENGTH: 'medium' as const, // 최소 시그널 강도
  ENTRY_COOLDOWN_MS: 60000,  // 진입 간 쿨다운 1분
  
  // 변동성 필터
  MIN_ATR_PERCENT: 0.2,      // 최소 ATR 퍼센트
  MAX_ATR_PERCENT: 2.0,      // 최대 ATR 퍼센트
};

// 분 타임스탬프
function getMinuteTimestamp() {
  return Math.floor(Date.now() / 60000);
}

export function useAutoTrading({
  balanceUSD,
  leverage,
  krwRate,
  onTradeComplete,
  initialStats,
  logTrade,
}: UseAutoTradingProps) {
  const { user } = useAuth();
  const {
    placeMarketOrder,
    placeLimitOrder,
    getPositions,
    cancelAllOrders,
    setLeverage,
  } = useBinanceApi();

  const [state, setState] = useState<AutoTradingState>({
    isEnabled: false,
    isProcessing: false,
    currentSymbol: null,
    pendingSignal: null,
    currentPosition: null,
    todayStats: initialStats || { trades: 0, wins: 0, losses: 0, totalPnL: 0 },
    tradeLogs: [],
    consecutiveLosses: 0,
    cooldownUntil: null,
    tpPercent: 0.3,
    statusMessage: '자동매매 비활성화',
    scanningProgress: '',
  });

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
  const lastMinuteRef = useRef(getMinuteTimestamp());
  const lastEntryTimeRef = useRef(0);
  const pendingSignalRef = useRef<PendingSignal | null>(null);
  const positionSyncRef = useRef(false);

  useEffect(() => {
    pendingSignalRef.current = state.pendingSignal;
  }, [state.pendingSignal]);

  // 로그 추가
  const addLog = useCallback((log: Omit<AutoTradeLog, 'id' | 'timestamp'>) => {
    const newLog: AutoTradeLog = {
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

  // 자동매매 토글
  const toggleAutoTrading = useCallback(() => {
    setState(prev => {
      const newEnabled = !prev.isEnabled;
      if (newEnabled) {
        initAudio();
        toast.success('🤖 고급 스캘핑 시스템 시작');
      } else {
        toast.info('자동매매 중지');
      }
      return {
        ...prev,
        isEnabled: newEnabled,
        pendingSignal: null,
        statusMessage: newEnabled ? '🔍 기술적 분석 기반 스캔 중...' : '자동매매 비활성화',
        scanningProgress: '',
      };
    });
  }, []);

  // 부분 청산 실행
  const executePartialClose = useCallback(async (
    position: Position,
    closeRatio: number,
    currentPrice: number,
    stage: number
  ): Promise<{ success: boolean; closedQty: number; pnl: number }> => {
    try {
      const closeQty = position.remainingQuantity * closeRatio;
      const precision = await fetchSymbolPrecision(position.symbol);
      const roundedQty = roundQuantity(closeQty, precision);

      if (roundedQty * currentPrice < 5) {
        return { success: false, closedQty: 0, pnl: 0 };
      }

      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';
      const result = await placeMarketOrder(position.symbol, orderSide, roundedQty, true, currentPrice);

      if (!result || result.error) {
        return { success: false, closedQty: 0, pnl: 0 };
      }

      const direction = position.side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - position.entryPrice) * direction;
      const pnl = priceDiff * roundedQty;

      addLog({
        symbol: position.symbol,
        action: 'partial_tp',
        side: position.side,
        price: currentPrice,
        quantity: roundedQty,
        pnl,
        reason: `${stage}단계 익절 (${(closeRatio * 100).toFixed(0)}%)`,
      });

      const pnlKRW = Math.round(pnl * krwRate);
      playTpSound();
      toast.success(`🎯 ${stage}단계 익절! +₩${pnlKRW.toLocaleString()}`);

      return { success: true, closedQty: roundedQty, pnl };
    } catch (error) {
      console.error('Partial close error:', error);
      return { success: false, closedQty: 0, pnl: 0 };
    }
  }, [placeMarketOrder, addLog, krwRate]);

  // 전량 청산
  const closePosition = useCallback(async (reason: 'tp' | 'sl' | 'exit' | 'time', currentPrice: number) => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;

    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));

    const position = state.currentPosition;

    try {
      const positions = await getPositions(position.symbol);
      const actualPosition = positions?.find((p: any) =>
        p.symbol === position.symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );

      if (!actualPosition) {
        setState(prev => ({
          ...prev,
          currentPosition: null,
          currentSymbol: null,
          statusMessage: '🔍 기술적 분석 기반 스캔 중...',
        }));
        return;
      }

      const actualQty = Math.abs(parseFloat(actualPosition.positionAmt));
      const actualEntryPrice = parseFloat(actualPosition.entryPrice);

      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';
      const closeResult = await placeMarketOrder(position.symbol, orderSide, actualQty, true, currentPrice);

      if (!closeResult || closeResult.error) {
        throw new Error(closeResult?.error || '청산 실패');
      }

      const direction = position.side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - actualEntryPrice) * direction;
      const pnl = priceDiff * actualQty;
      const isWin = pnl > 0;

      const newTotalPnL = state.todayStats.totalPnL + pnl;

      setState(prev => ({
        ...prev,
        currentPosition: null,
        currentSymbol: null,
        todayStats: {
          trades: prev.todayStats.trades + 1,
          wins: prev.todayStats.wins + (isWin ? 1 : 0),
          losses: prev.todayStats.losses + (isWin ? 0 : 1),
          totalPnL: newTotalPnL,
        },
        consecutiveLosses: isWin ? 0 : prev.consecutiveLosses + 1,
        statusMessage: `${isWin ? '✅ 익절' : '❌ 손절'} 완료! 다음 시그널 대기...`,
      }));

      const reasonText = {
        tp: '익절',
        sl: '손절',
        exit: '수동 청산',
        time: '타임 스탑',
      }[reason];

      addLog({
        symbol: position.symbol,
        action: reason === 'sl' || reason === 'time' ? 'sl' : 'tp',
        side: position.side,
        price: currentPrice,
        quantity: actualQty,
        pnl,
        reason: reasonText,
      });

      const pnlKRW = Math.round(pnl * krwRate);

      if (isWin) {
        playTpSound();
      } else {
        playSlSound();
      }

      toast[isWin ? 'success' : 'error'](
        `${isWin ? '✅' : '❌'} ${reasonText} | ${pnl >= 0 ? '+' : ''}₩${pnlKRW.toLocaleString()}`
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
        quantity: position.remainingQuantity,
        reason: error.message || '청산 실패',
      });
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [state.currentPosition, state.todayStats, placeMarketOrder, getPositions, krwRate, leverage, addLog, onTradeComplete, logTrade]);

  // TP/SL 체크 (3단계 익절 + 트레일링)
  const checkTpSl = useCallback(async (currentPrice: number, _tpPercent: number = 0.3, _slPercent: number = 0.5) => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;

    const position = state.currentPosition;
    const direction = position.side === 'long' ? 1 : -1;
    const priceDiff = (currentPrice - position.entryPrice) * direction;
    const pnlPercent = (priceDiff / position.entryPrice) * 100;
    const tpState = position.takeProfitState;

    // 1. 하드 스탑 체크
    if (pnlPercent <= -CONFIG.HARD_STOP_PERCENT) {
      await closePosition('sl', currentPrice);
      return;
    }

    // 2. 타임 스탑 체크
    const holdTime = (Date.now() - position.entryTime) / 60000;
    if (holdTime >= CONFIG.TIME_STOP_MINUTES && pnlPercent < 0) {
      await closePosition('time', currentPrice);
      return;
    }

    // 3. 트레일링 스탑 체크
    if (tpState.trailingActive) {
      const trailDistance = position.side === 'long'
        ? ((tpState.trailingHighPrice - currentPrice) / tpState.trailingHighPrice) * 100
        : ((currentPrice - tpState.trailingHighPrice) / tpState.trailingHighPrice) * 100;

      if (trailDistance >= CONFIG.TRAILING_DISTANCE) {
        await closePosition('tp', currentPrice);
        return;
      }

      // 트레일링 최고가 업데이트
      const newHigh = position.side === 'long'
        ? Math.max(tpState.trailingHighPrice, currentPrice)
        : Math.min(tpState.trailingHighPrice, currentPrice);

      if (newHigh !== tpState.trailingHighPrice) {
        setState(prev => ({
          ...prev,
          currentPosition: prev.currentPosition ? {
            ...prev.currentPosition,
            takeProfitState: {
              ...prev.currentPosition.takeProfitState,
              trailingHighPrice: newHigh,
            },
          } : null,
        }));
      }
    }

    // 4. 3단계 익절 체크
    if (!tpState.stage1Hit && pnlPercent >= CONFIG.TP_STAGE_1.percent) {
      const result = await executePartialClose(position, CONFIG.TP_STAGE_1.closeRatio, currentPrice, 1);
      if (result.success) {
        setState(prev => ({
          ...prev,
          currentPosition: prev.currentPosition ? {
            ...prev.currentPosition,
            remainingQuantity: prev.currentPosition.remainingQuantity - result.closedQty,
            takeProfitState: {
              ...prev.currentPosition.takeProfitState,
              stage1Hit: true,
            },
          } : null,
          todayStats: {
            ...prev.todayStats,
            totalPnL: prev.todayStats.totalPnL + result.pnl,
          },
        }));
      }
    }

    if (!tpState.stage2Hit && tpState.stage1Hit && pnlPercent >= CONFIG.TP_STAGE_2.percent) {
      const result = await executePartialClose(position, CONFIG.TP_STAGE_2.closeRatio, currentPrice, 2);
      if (result.success) {
        setState(prev => ({
          ...prev,
          currentPosition: prev.currentPosition ? {
            ...prev.currentPosition,
            remainingQuantity: prev.currentPosition.remainingQuantity - result.closedQty,
            takeProfitState: {
              ...prev.currentPosition.takeProfitState,
              stage2Hit: true,
            },
          } : null,
          todayStats: {
            ...prev.todayStats,
            totalPnL: prev.todayStats.totalPnL + result.pnl,
          },
        }));
      }
    }

    if (tpState.stage2Hit && pnlPercent >= CONFIG.TP_STAGE_3.percent) {
      await closePosition('tp', currentPrice);
      return;
    }

    // 5. 트레일링 활성화 체크
    if (!tpState.trailingActive && pnlPercent >= CONFIG.TRAILING_TRIGGER) {
      setState(prev => ({
        ...prev,
        currentPosition: prev.currentPosition ? {
          ...prev.currentPosition,
          takeProfitState: {
            ...prev.currentPosition.takeProfitState,
            trailingActive: true,
            trailingHighPrice: currentPrice,
            trailingTriggerPrice: currentPrice,
          },
        } : null,
      }));
      toast.info(`📈 트레일링 스탑 활성화 @ $${currentPrice.toFixed(4)}`);
    }
  }, [state.currentPosition, closePosition, executePartialClose]);

  // 시그널 핸들러 (기술적 분석 기반)
  const handleSignal = useCallback(async (
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
    if (balanceUSD <= 0) return;
    if (state.currentPosition) return;
    if (state.pendingSignal) return;

    // 쿨다운 체크
    if (Date.now() - lastEntryTimeRef.current < CONFIG.ENTRY_COOLDOWN_MS) return;

    // 시그널 강도 체크
    const strengthOrder = { weak: 1, medium: 2, strong: 3 };
    if (strengthOrder[strength] < strengthOrder[CONFIG.MIN_SIGNAL_STRENGTH]) return;

    console.log(`[handleSignal] ${symbol} ${direction} ${strength}`, reasons);

    const pendingSignal: PendingSignal = {
      symbol,
      direction,
      strength,
      reasons,
      signalTime: Date.now(),
      signalPrice: price,
      indicators,
      confirmCount: 0,
    };

    setState(prev => ({
      ...prev,
      pendingSignal,
      currentSymbol: symbol,
      statusMessage: `✨ ${symbol.replace('USDT', '')} ${direction === 'long' ? '롱' : '숏'} 시그널 확인 중...`,
    }));

    addLog({
      symbol,
      action: 'pending',
      side: direction,
      price,
      quantity: 0,
      reason: `${strength} 시그널 - ${reasons.slice(0, 3).join(', ')}`,
    });

    toast.info(`⏳ ${symbol} ${direction === 'long' ? '롱' : '숏'} 시그널 확인 중`);
  }, [state.isEnabled, state.currentPosition, state.pendingSignal, user, balanceUSD, addLog]);

  // BB 시그널 핸들러 (레거시 호환)
  const handleBBSignal = useCallback(async (
    symbol: string,
    touchType: 'upper' | 'lower',
    currentPrice: number
  ) => {
    if (!state.isEnabled) return;
    if (processingRef.current) return;
    if (state.currentPosition) return;
    if (state.pendingSignal) return;

    // 5분봉 기술적 분석
    const klines = await fetch5mKlines(symbol, 50);
    if (!klines || klines.length < 30) return;

    const indicators = calculateAllIndicators(klines);
    if (!indicators) return;

    const direction = touchType === 'upper' ? 'short' : 'long';
    const signalCheck = direction === 'long'
      ? checkLongSignal(indicators, currentPrice)
      : checkShortSignal(indicators, currentPrice);

    if (signalCheck.valid) {
      await handleSignal(symbol, direction, currentPrice, signalCheck.strength, signalCheck.reasons, indicators);
    }
  }, [state.isEnabled, state.currentPosition, state.pendingSignal, handleSignal]);

  // 진입 실행
  const executeEntry = useCallback(async (
    symbol: string,
    side: 'long' | 'short',
    currentPrice: number,
    indicators: TechnicalIndicators
  ) => {
    if (processingRef.current) return;

    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));

    try {
      // 주문 수량 계산
      const safeBalance = balanceUSD * 0.9;
      const buyingPower = safeBalance * leverage;
      const rawQty = buyingPower / currentPrice;

      const precision = await fetchSymbolPrecision(symbol);
      const quantity = roundQuantity(rawQty, precision);

      if (quantity * currentPrice < 5.5) {
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

      // 시장가 주문
      const orderSide = side === 'long' ? 'BUY' : 'SELL';
      const orderResult = await placeMarketOrder(symbol, orderSide, quantity, false, currentPrice);

      if (!orderResult || orderResult.error) {
        throw new Error(orderResult?.error || '주문 실패');
      }

      const executedQty = parseFloat(orderResult.executedQty || orderResult.origQty || quantity);
      const avgPrice = parseFloat(orderResult.avgPrice || orderResult.price || currentPrice);

      if (executedQty <= 0) {
        throw new Error('주문 체결 수량 0');
      }

      lastEntryTimeRef.current = Date.now();

      // 포지션 저장
      const newPosition: Position = {
        symbol,
        side,
        entryPrice: avgPrice > 0 ? avgPrice : currentPrice,
        initialQuantity: executedQty,
        remainingQuantity: executedQty,
        entryTime: Date.now(),
        atr: indicators.atr,
        takeProfitState: {
          stage1Hit: false,
          stage2Hit: false,
          stage3Hit: false,
          trailingActive: false,
          trailingHighPrice: avgPrice,
          trailingTriggerPrice: 0,
        },
        indicators,
      };

      setState(prev => ({
        ...prev,
        pendingSignal: null,
        currentPosition: newPosition,
        currentSymbol: symbol,
        tpPercent: CONFIG.TP_STAGE_1.percent,
        statusMessage: `🎯 ${symbol.replace('USDT', '')} ${side === 'long' ? '롱' : '숏'} 포지션 보유 중`,
      }));

      addLog({
        symbol,
        action: 'entry',
        side,
        price: avgPrice > 0 ? avgPrice : currentPrice,
        quantity: executedQty,
        reason: `진입 (3단계 TP: ${CONFIG.TP_STAGE_1.percent}%/${CONFIG.TP_STAGE_2.percent}%/${CONFIG.TP_STAGE_3.percent}%)`,
      });

      playEntrySound();
      const cuteEmojis = ['🚀', '💫', '✨', '🎯', '💰', '🔥', '⚡'];
      const randomEmoji = cuteEmojis[Math.floor(Math.random() * cuteEmojis.length)];
      toast.success(`${randomEmoji} ${side === 'long' ? '롱' : '숏'} 진입! ${symbol.replace('USDT', '')} @ $${(avgPrice > 0 ? avgPrice : currentPrice).toFixed(2)}`);

    } catch (error: any) {
      console.error('Entry error:', error);
      lastEntryTimeRef.current = Date.now();
      setState(prev => ({ ...prev, pendingSignal: null, statusMessage: '🔍 기술적 분석 기반 스캔 중...' }));
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
  }, [balanceUSD, leverage, placeMarketOrder, setLeverage, addLog]);

  // 봉 완성 체크 및 진입 판단
  const checkCandleCompletion = useCallback(async () => {
    if (!state.isEnabled) return;
    if (processingRef.current) return;

    const currentMinute = getMinuteTimestamp();
    if (currentMinute === lastMinuteRef.current) return;
    lastMinuteRef.current = currentMinute;

    await new Promise(resolve => setTimeout(resolve, 3000));

    const latestPendingSignal = pendingSignalRef.current;

    if (latestPendingSignal && !state.currentPosition) {
      const { symbol, direction, confirmCount, indicators } = latestPendingSignal;

      try {
        const klines = await fetch1mKlines(symbol, 5);
        if (!klines || klines.length < 3) return;

        const completedCandle = klines[klines.length - 2];
        const bodyMove = completedCandle.close - completedCandle.open;

        // 방향 확인
        const isBullish = bodyMove > 0;
        const isBearish = bodyMove < 0;

        const expectedDirection = direction === 'long' ? isBullish : isBearish;

        if (expectedDirection) {
          // 방향 맞음 - 진입
          await executeEntry(symbol, direction, completedCandle.close, indicators);
        } else if (confirmCount < 2) {
          // 방향 안 맞음 - 추가 대기
          setState(prev => ({
            ...prev,
            pendingSignal: prev.pendingSignal
              ? { ...prev.pendingSignal, confirmCount: confirmCount + 1 }
              : null,
            statusMessage: `⏳ ${symbol.replace('USDT', '')} 확인 대기 (${confirmCount + 1}/2)`,
          }));
        } else {
          // 최대 대기 초과 - 취소
          setState(prev => ({
            ...prev,
            pendingSignal: null,
            statusMessage: '🔍 기술적 분석 기반 스캔 중...',
          }));
          addLog({
            symbol,
            action: 'cancel',
            side: direction,
            price: completedCandle.close,
            quantity: 0,
            reason: '확인 실패 - 시그널 취소',
          });
          toast.info(`❌ ${symbol} 시그널 취소`);
        }
      } catch (error) {
        console.error('Candle check error:', error);
      }
    }
  }, [state.isEnabled, state.currentPosition, executeEntry, addLog]);

  // 포지션 동기화
  useEffect(() => {
    if (!user) return;

    let isMounted = true;

    const syncPositions = async () => {
      if (positionSyncRef.current) return;
      positionSyncRef.current = true;

      try {
        const positions = await getPositions();
        if (!isMounted) return;

        const activePosition = positions?.find((p: any) =>
          Math.abs(parseFloat(p.positionAmt)) > 0
        );

        if (activePosition && !state.currentPosition) {
          const positionAmt = parseFloat(activePosition.positionAmt);
          const side = positionAmt > 0 ? 'long' : 'short';
          const entryPrice = parseFloat(activePosition.entryPrice);

          // 기본 인디케이터 (동기화용)
          const defaultIndicators: TechnicalIndicators = {
            rsi: 50, ema8: entryPrice, ema21: entryPrice,
            macd: 0, macdSignal: 0, macdHistogram: 0,
            upperBand: entryPrice * 1.02, lowerBand: entryPrice * 0.98, sma20: entryPrice,
            adx: 25, cci: 0, stochK: 50, stochD: 50, williamsR: -50,
            atr: entryPrice * 0.005, volumeRatio: 1,
          };

          setState(prev => ({
            ...prev,
            currentPosition: {
              symbol: activePosition.symbol,
              side,
              entryPrice,
              initialQuantity: Math.abs(positionAmt),
              remainingQuantity: Math.abs(positionAmt),
              entryTime: Date.now(),
              atr: entryPrice * 0.005,
              takeProfitState: {
                stage1Hit: false,
                stage2Hit: false,
                stage3Hit: false,
                trailingActive: false,
                trailingHighPrice: entryPrice,
                trailingTriggerPrice: 0,
              },
              indicators: defaultIndicators,
            },
            currentSymbol: activePosition.symbol,
          }));
        }
      } catch (error) {
        console.error('Position sync error:', error);
      } finally {
        positionSyncRef.current = false;
      }
    };

    syncPositions();
    const interval = setInterval(syncPositions, 10000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [user, getPositions, state.currentPosition]);

  // 봉 완성 체크 interval
  useEffect(() => {
    if (!state.isEnabled) return;
    const interval = setInterval(checkCandleCompletion, 1000);
    return () => clearInterval(interval);
  }, [state.isEnabled, checkCandleCompletion]);

  // 자정 리셋
  useEffect(() => {
    const checkDayChange = () => {
      const now = new Date();
      const koreaTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const hours = koreaTime.getUTCHours();
      const minutes = koreaTime.getUTCMinutes();

      if (hours === 0 && minutes === 0) {
        setState(prev => ({
          ...prev,
          todayStats: { trades: 0, wins: 0, losses: 0, totalPnL: 0 },
          tradeLogs: [],
          consecutiveLosses: 0,
          cooldownUntil: null,
        }));
      }
    };

    const interval = setInterval(checkDayChange, 60000);
    return () => clearInterval(interval);
  }, []);

  // 시그널 패스
  const skipSignal = useCallback(() => {
    if (!state.pendingSignal) return;

    const { symbol, direction } = state.pendingSignal;

    addLog({
      symbol,
      action: 'cancel',
      side: direction,
      price: state.pendingSignal.signalPrice,
      quantity: 0,
      reason: '🚫 수동 패스',
    });

    setState(prev => ({
      ...prev,
      pendingSignal: null,
      statusMessage: '🔍 기술적 분석 기반 스캔 중...',
    }));

    toast.info(`⏭️ ${symbol} 패스됨`);
  }, [state.pendingSignal, addLog]);

  // 시그널 방향 스왑
  const swapSignalDirection = useCallback(() => {
    if (!state.pendingSignal) return;

    const { symbol, direction } = state.pendingSignal;
    const newDirection = direction === 'long' ? 'short' : 'long';

    setState(prev => ({
      ...prev,
      pendingSignal: prev.pendingSignal
        ? { ...prev.pendingSignal, direction: newDirection }
        : null,
    }));

    toast.info(`🔄 ${symbol} → ${newDirection === 'long' ? '롱' : '숏'}으로 변경`);
  }, [state.pendingSignal]);

  // 본절 청산
  const breakEvenClose = useCallback(async () => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;

    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));

    const position = state.currentPosition;

    try {
      const positions = await getPositions(position.symbol);
      const actualPosition = positions?.find((p: any) =>
        p.symbol === position.symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );

      if (!actualPosition) {
        setState(prev => ({
          ...prev,
          currentPosition: null,
          currentSymbol: null,
          statusMessage: '🔍 기술적 분석 기반 스캔 중...',
        }));
        toast.error('실제 포지션이 없습니다');
        return;
      }

      const actualQty = Math.abs(parseFloat(actualPosition.positionAmt));
      const entryPrice = parseFloat(actualPosition.entryPrice);

      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';
      const result = await placeLimitOrder(position.symbol, orderSide, actualQty, entryPrice, true);

      if (!result || result.error) {
        throw new Error(result?.error || '본절 주문 실패');
      }

      addLog({
        symbol: position.symbol,
        action: 'pending',
        side: position.side,
        price: entryPrice,
        quantity: actualQty,
        reason: `📍 본절 주문 등록 @ $${entryPrice.toFixed(4)}`,
      });

      toast.success(`📍 ${position.symbol} 본절 주문 등록 @ $${entryPrice.toFixed(4)}`);
    } catch (error: any) {
      console.error('Break-even order error:', error);
      toast.error(`본절 주문 실패: ${error.message || '오류'}`);
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [state.currentPosition, getPositions, placeLimitOrder, addLog]);

  // 본절 주문 취소
  const cancelBreakEvenOrder = useCallback(async () => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;

    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));

    const position = state.currentPosition;

    try {
      await cancelAllOrders(position.symbol);

      addLog({
        symbol: position.symbol,
        action: 'cancel',
        side: position.side,
        price: position.entryPrice,
        quantity: 0,
        reason: '🚫 본절 주문 취소됨',
      });

      toast.info(`🚫 ${position.symbol} 본절 주문 취소됨`);
    } catch (error: any) {
      console.error('Cancel break-even order error:', error);
      toast.error(`본절 취소 실패: ${error.message || '오류'}`);
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [state.currentPosition, cancelAllOrders, addLog]);

  return {
    state,
    toggleAutoTrading,
    handleSignal: handleBBSignal, // 레거시 호환
    handleTechnicalSignal: handleSignal,
    closePosition,
    checkTpSl,
    skipSignal,
    swapSignalDirection,
    breakEvenClose,
    cancelBreakEvenOrder,
    updatePrice: useCallback(() => {}, []),
  };
}
