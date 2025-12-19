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

// 익절 상태 (단순화)
interface TakeProfitState {
  tpHit: boolean; // 익절 완료 여부
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
  // 전봉 기반 동적 손절
  stopLossPrice: number;       // 현재 손절 기준가
  lastCandleTime: number;      // 마지막 확인한 봉 시간
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
  lossProtectionEnabled: boolean; // 연속 손실 보호 기능 ON/OFF
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
  // 익절 (전량 즉시 익절)
  TP_PERCENT: 0.2,           // +0.2% 도달 시 전량 익절
  
  // 타임 스탑
  TIME_STOP_MINUTES: 15,     // 15분 타임 스탑
  VOLUME_STOP_RATIO: 0.5,    // 거래량 50% 감소 시 청산
  
  // 연속 손실 관리
  MAX_CONSECUTIVE_LOSSES: 5, // 연속 5회 손실
  LOSS_COOLDOWN_MINUTES: 60, // 1시간 휴식
  
  // 진입 조건
  MIN_SIGNAL_STRENGTH: 'medium' as const, // 최소 시그널 강도
  ENTRY_COOLDOWN_MS: 60000,  // 진입 간 쿨다운 1분
  
  // 변동성 필터
  MIN_ATR_PERCENT: 0.2,      // 최소 ATR 퍼센트
  MAX_ATR_PERCENT: 2.0,      // 최대 ATR 퍼센트
  
  // 시장 환경 필터
  MIN_ADX_FOR_TREND: 20,     // 최소 ADX - 횡보장 필터
  
  // 동적 포지션 사이징
  BASE_RISK_PERCENT: 1.0,    // 기본 리스크 퍼센트
  ATR_POSITION_MULTIPLIER: {
    LOW: 1.2,                // 낮은 변동성 → 큰 포지션
    MEDIUM: 1.0,             // 보통 변동성 → 기본 포지션
    HIGH: 0.7,               // 높은 변동성 → 작은 포지션
  },
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
    lossProtectionEnabled: false, // 기본값 OFF
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
        // 연속 5손실 + 보호 기능 켜져 있을 때만 휴식
        cooldownUntil: (prev.lossProtectionEnabled && !isWin && prev.consecutiveLosses + 1 >= CONFIG.MAX_CONSECUTIVE_LOSSES) 
          ? Date.now() + CONFIG.LOSS_COOLDOWN_MINUTES * 60 * 1000 
          : prev.cooldownUntil,
        statusMessage: (prev.lossProtectionEnabled && !isWin && prev.consecutiveLosses + 1 >= CONFIG.MAX_CONSECUTIVE_LOSSES)
          ? `⏸️ 연속 ${CONFIG.MAX_CONSECUTIVE_LOSSES}손실 - ${CONFIG.LOSS_COOLDOWN_MINUTES}분 휴식`
          : `${isWin ? '✅ 익절' : '❌ 손절'} 완료! 다음 시그널 대기...`,
      }));
      
      // 연속 손실 경고 (보호 기능 켜져 있을 때만)
      if (state.lossProtectionEnabled && !isWin && state.consecutiveLosses + 1 >= CONFIG.MAX_CONSECUTIVE_LOSSES) {
        toast.warning(`⏸️ 연속 ${CONFIG.MAX_CONSECUTIVE_LOSSES}손실! ${CONFIG.LOSS_COOLDOWN_MINUTES}분간 자동매매 일시 중지`);
      }

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

  // TP/SL 체크 (3단계 익절 + 전봉 기반 동적 손절)
  const checkTpSl = useCallback(async (currentPrice: number, _tpPercent: number = 0.3, _slPercent: number = 0.5, currentVolumeRatio?: number) => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;

    const position = state.currentPosition;
    const direction = position.side === 'long' ? 1 : -1;
    const priceDiff = (currentPrice - position.entryPrice) * direction;
    const pnlPercent = (priceDiff / position.entryPrice) * 100;
    const tpState = position.takeProfitState;
    
    // 📊 실시간 손익 로그
    const pnlRounded = Math.round(pnlPercent * 10) / 10;
    const slPercent = ((Math.abs(position.stopLossPrice - position.entryPrice) / position.entryPrice) * 100).toFixed(2);
    console.log(`[TP/SL] ${position.symbol} ${position.side.toUpperCase()} | 현재: ${currentPrice.toFixed(4)} | 진입: ${position.entryPrice.toFixed(4)} | SL: ${position.stopLossPrice.toFixed(4)} (-${slPercent}%) | 손익: ${pnlRounded >= 0 ? '+' : ''}${pnlRounded.toFixed(1)}%`);
    
    // 상태 메시지 업데이트
    setState(prev => ({
      ...prev,
      statusMessage: `📊 ${position.symbol.replace('USDT', '')} ${position.side === 'long' ? '롱' : '숏'} | ${pnlRounded >= 0 ? '+' : ''}${pnlRounded.toFixed(1)}%`,
    }));

    // 1. 전봉 기반 손절 체크
    if (position.side === 'long' && currentPrice < position.stopLossPrice) {
      console.log(`🛑 [checkTpSl] 전봉 저가 이탈 손절: ${currentPrice.toFixed(4)} < ${position.stopLossPrice.toFixed(4)}`);
      await closePosition('sl', currentPrice);
      return;
    }
    if (position.side === 'short' && currentPrice > position.stopLossPrice) {
      console.log(`🛑 [checkTpSl] 전봉 고가 이탈 손절: ${currentPrice.toFixed(4)} > ${position.stopLossPrice.toFixed(4)}`);
      await closePosition('sl', currentPrice);
      return;
    }

    // 2. 타임 스탑 체크
    const holdTime = (Date.now() - position.entryTime) / 60000;
    if (holdTime >= CONFIG.TIME_STOP_MINUTES && pnlPercent < 0) {
      await closePosition('time', currentPrice);
      return;
    }
    
    // 3. 볼륨 스톱 체크 (거래량 50% 감소 시)
    if (currentVolumeRatio !== undefined && currentVolumeRatio < CONFIG.VOLUME_STOP_RATIO && pnlPercent < 0) {
      console.log(`[checkTpSl] 볼륨 스톱 발동: 거래량 ${(currentVolumeRatio * 100).toFixed(0)}% < ${CONFIG.VOLUME_STOP_RATIO * 100}%`);
      await closePosition('sl', currentPrice);
      toast.warning('📉 거래량 급감으로 청산');
      return;
    }

    // 3. 전량 익절 체크 (+0.2%)
    if (!tpState.tpHit && pnlPercent >= CONFIG.TP_PERCENT) {
      await closePosition('tp', currentPrice);
      return;
    }
    
    // 6. 🆕 전봉 기반 동적 손절선 업데이트 (5분마다 체크)
    const now = Date.now();
    const fiveMinMs = 5 * 60 * 1000;
    const currentCandleStart = Math.floor(now / fiveMinMs) * fiveMinMs;
    
    // 새로운 5분봉이 완성되었는지 체크
    if (currentCandleStart > position.lastCandleTime) {
      try {
        const klines = await fetch5mKlines(position.symbol, 3);
        if (klines && klines.length >= 2) {
          const prevCandle = klines[klines.length - 2]; // 직전 완성된 봉
          
          if (position.side === 'long') {
            // 롱: 새 전봉 저가가 기존 손절가보다 높으면 업데이트 (유리한 방향)
            if (prevCandle.low > position.stopLossPrice) {
              console.log(`[checkTpSl] 손절선 상향: ${position.stopLossPrice.toFixed(4)} → ${prevCandle.low.toFixed(4)}`);
              setState(prev => ({
                ...prev,
                currentPosition: prev.currentPosition ? {
                  ...prev.currentPosition,
                  stopLossPrice: prevCandle.low,
                  lastCandleTime: currentCandleStart,
                } : null,
              }));
            } else {
              // 손절가는 유지하되 시간만 업데이트
              setState(prev => ({
                ...prev,
                currentPosition: prev.currentPosition ? {
                  ...prev.currentPosition,
                  lastCandleTime: currentCandleStart,
                } : null,
              }));
            }
          } else {
            // 숏: 새 전봉 고가가 기존 손절가보다 낮으면 업데이트 (유리한 방향)
            if (prevCandle.high < position.stopLossPrice) {
              console.log(`[checkTpSl] 손절선 하향: ${position.stopLossPrice.toFixed(4)} → ${prevCandle.high.toFixed(4)}`);
              setState(prev => ({
                ...prev,
                currentPosition: prev.currentPosition ? {
                  ...prev.currentPosition,
                  stopLossPrice: prevCandle.high,
                  lastCandleTime: currentCandleStart,
                } : null,
              }));
            } else {
              setState(prev => ({
                ...prev,
                currentPosition: prev.currentPosition ? {
                  ...prev.currentPosition,
                  lastCandleTime: currentCandleStart,
                } : null,
              }));
            }
          }
        }
      } catch (error) {
        console.error('[checkTpSl] 손절선 업데이트 실패:', error);
      }
    }
  }, [state.currentPosition, closePosition]);

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

    // 연속 손실 쿨다운 체크
    if (state.cooldownUntil && Date.now() < state.cooldownUntil) {
      const remainingMin = Math.ceil((state.cooldownUntil - Date.now()) / 60000);
      console.log(`[handleSignal] 연속 손실 휴식 중 (${remainingMin}분 남음)`);
      return;
    }
    
    // 연속 손실 쿨다운 해제
    if (state.cooldownUntil && Date.now() >= state.cooldownUntil) {
      setState(prev => ({
        ...prev,
        cooldownUntil: null,
        consecutiveLosses: 0,
        statusMessage: '✅ 휴식 완료! 자동매매 재개',
      }));
      toast.success('✅ 휴식 완료! 자동매매 재개');
    }

    // 쿨다운 체크
    if (Date.now() - lastEntryTimeRef.current < CONFIG.ENTRY_COOLDOWN_MS) return;

    // 시그널 강도 체크
    const strengthOrder = { weak: 1, medium: 2, strong: 3 };
    if (strengthOrder[strength] < strengthOrder[CONFIG.MIN_SIGNAL_STRENGTH]) return;

    // ADX 시장 환경 필터 - 횡보장 차단
    if (indicators.adx < CONFIG.MIN_ADX_FOR_TREND) {
      console.log(`[handleSignal] ${symbol} 횡보장 필터 (ADX: ${indicators.adx.toFixed(1)} < ${CONFIG.MIN_ADX_FOR_TREND})`);
      return;
    }

    console.log(`[handleSignal] ${symbol} ${direction} ${strength} (ADX: ${indicators.adx.toFixed(1)})`, reasons);

    // 즉시 진입 (확인대기 없음)
    setState(prev => ({
      ...prev,
      currentSymbol: symbol,
      statusMessage: `🚀 ${symbol.replace('USDT', '')} ${direction === 'long' ? '롱' : '숏'} 즉시 진입 중...`,
    }));

    addLog({
      symbol,
      action: 'pending',
      side: direction,
      price,
      quantity: 0,
      reason: `${strength} 시그널 - ${reasons.slice(0, 3).join(', ')}`,
    });

    toast.info(`🚀 ${symbol} ${direction === 'long' ? '롱' : '숏'} 즉시 진입`);

    // 바로 진입 실행
    await executeEntry(symbol, direction, price, indicators);
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

  // 🆕 동적 포지션 사이징 계산
  const calculateDynamicPositionSize = useCallback((
    balance: number,
    lev: number,
    price: number,
    atrPercent: number
  ): number => {
    // ATR 기반 변동성 레벨 판단
    let positionMultiplier = CONFIG.ATR_POSITION_MULTIPLIER.MEDIUM;
    let volatilityLevel = 'MEDIUM';
    
    if (atrPercent < 0.3) {
      positionMultiplier = CONFIG.ATR_POSITION_MULTIPLIER.LOW;
      volatilityLevel = 'LOW';
    } else if (atrPercent > 0.8) {
      positionMultiplier = CONFIG.ATR_POSITION_MULTIPLIER.HIGH;
      volatilityLevel = 'HIGH';
    }
    
    console.log(`[PositionSizing] ATR: ${atrPercent.toFixed(3)}% → ${volatilityLevel} (x${positionMultiplier})`);
    
    // 안전 잔고 * 포지션 배수 적용
    const safeBalance = balance * 0.9 * positionMultiplier;
    const buyingPower = safeBalance * lev;
    return buyingPower / price;
  }, []);

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
      // 🆕 5분봉 데이터로 초기 손절가 설정
      const klines = await fetch5mKlines(symbol, 5);
      let initialStopLoss = currentPrice;
      let lastCandleTime = Date.now();
      
      if (klines && klines.length >= 2) {
        // 전봉 (마지막에서 두번째 봉) 기준
        const prevCandle = klines[klines.length - 2];
        lastCandleTime = prevCandle.closeTime;
        
        if (side === 'long') {
          // 롱: 전봉 저가가 손절 기준
          initialStopLoss = prevCandle.low;
        } else {
          // 숏: 전봉 고가가 손절 기준
          initialStopLoss = prevCandle.high;
        }
        console.log(`[executeEntry] 초기 손절가 설정: ${side === 'long' ? '전봉 저가' : '전봉 고가'} = ${initialStopLoss.toFixed(4)}`);
      }
      
      // 🆕 ATR 기반 동적 포지션 사이징
      const atrPercent = (indicators.atr / currentPrice) * 100;
      const rawQty = calculateDynamicPositionSize(balanceUSD, leverage, currentPrice, atrPercent);

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

      // 체결 수량 파싱 (executedQty가 0이면 origQty 또는 요청 수량 사용)
      let executedQty = parseFloat(orderResult.executedQty || '0');
      const origQty = parseFloat(orderResult.origQty || '0');
      const avgPrice = parseFloat(orderResult.avgPrice || orderResult.price || '0') || currentPrice;

      // executedQty가 0이면 origQty 또는 요청 수량 사용 (시장가 주문은 거의 즉시 체결됨)
      if (executedQty <= 0 && origQty > 0) {
        console.log(`[executeEntry] executedQty=0, origQty=${origQty} 사용`);
        executedQty = origQty;
      }
      if (executedQty <= 0) {
        executedQty = quantity;
        console.log(`[executeEntry] executedQty=0, 요청 수량 ${quantity} 사용`);
      }

      // 최종 검증
      if (executedQty <= 0) {
        throw new Error(`주문 체결 수량 0 (응답: ${JSON.stringify(orderResult)})`);
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
          tpHit: false,
        },
        indicators,
        stopLossPrice: initialStopLoss,
        lastCandleTime,
      };

      setState(prev => ({
        ...prev,
        pendingSignal: null,
        currentPosition: newPosition,
        currentSymbol: symbol,
        tpPercent: CONFIG.TP_PERCENT,
        statusMessage: `🎯 ${symbol.replace('USDT', '')} ${side === 'long' ? '롱' : '숏'} 포지션 보유 중`,
      }));

      addLog({
        symbol,
        action: 'entry',
        side,
        price: avgPrice > 0 ? avgPrice : currentPrice,
        quantity: executedQty,
        reason: `진입 (익절: +${CONFIG.TP_PERCENT}%)`,
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

  // 봉 완성 체크 (TP/SL 체크용으로만 사용)
  const checkCandleCompletion = useCallback(async () => {
    if (!state.isEnabled) return;
    if (processingRef.current) return;

    const currentMinute = getMinuteTimestamp();
    if (currentMinute === lastMinuteRef.current) return;
    lastMinuteRef.current = currentMinute;

    // 진입은 handleSignal에서 즉시 처리되므로 여기서는 별도 로직 없음
  }, [state.isEnabled]);

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
                tpHit: false,
              },
              indicators: defaultIndicators,
              // 동기화된 포지션은 진입가 기준으로 0.5% 손절 설정 (전봉 데이터 없으므로)
              stopLossPrice: side === 'long' ? entryPrice * 0.995 : entryPrice * 1.005,
              lastCandleTime: Date.now(),
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

  // 연속 손실 보호 기능 토글
  const toggleLossProtection = useCallback(() => {
    setState(prev => ({
      ...prev,
      lossProtectionEnabled: !prev.lossProtectionEnabled,
      // 보호 기능 끄면 현재 쿨다운도 해제
      cooldownUntil: !prev.lossProtectionEnabled ? prev.cooldownUntil : null,
    }));
  }, []);

  // 쿨다운 즉시 해제 (현재 휴식 해제)
  const clearCooldown = useCallback(() => {
    setState(prev => ({
      ...prev,
      cooldownUntil: null,
      consecutiveLosses: 0,
    }));
  }, []);

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
    toggleLossProtection,
    clearCooldown,
    updatePrice: useCallback(() => {}, []),
  };
}
