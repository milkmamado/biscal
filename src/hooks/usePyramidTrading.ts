/**
 * ⚡ 1분봉 피라미드 트레이딩 훅 (10배 고정)
 * 수익 기반 분할 진입 시스템
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useBinanceApi } from './useBinanceApi';
import { useAuth } from './useAuth';
import { useMarketAnalysis } from './useMarketAnalysis';
import { TechnicalIndicators, checkLongSignal, checkShortSignal, calculateAllIndicators } from './useTechnicalIndicators';
import { initAudio, playEntrySound, playTpSound, playSlSound } from '@/lib/sounds';
import { fetchSymbolPrecision, roundQuantity } from '@/lib/binance';

// 1분봉/5분봉 캔들 조회 함수
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
import {
  PYRAMID_CONFIG,
  TAKE_PROFIT_CONFIG,
  STOP_LOSS_CONFIG,
  EMERGENCY_CONFIG,
  RISK_CONFIG,
  getStageSL,
  getStageTPConfig,
  getStageMaxHold,
  getExposurePercent,
  getMaxLossPercent,
  getPositionType,
  shouldPyramidUp,
  shouldAverageDown,
  calculateNewAvgPrice,
  type PositionType,
} from '@/lib/pyramidConfig';

// ===== 타입 정의 =====

export interface PyramidEntry {
  stage: number;
  price: number;
  quantity: number;
  timestamp: number;
}

export interface PyramidPosition {
  symbol: string;
  side: 'long' | 'short';
  entries: PyramidEntry[];
  avgPrice: number;
  totalQuantity: number;
  currentStage: number;
  startTime: number;
  maxProfitReached: number;        // 최고 수익률 (트레일링용)
  dynamicSL: number;               // 동적 손절선
  partialCloses: number[];         // 분할 청산 기록
  consecutiveSameDir: number;      // 연속 같은 방향 캔들 수
  indicators: TechnicalIndicators;
  positionType: PositionType;      // 포지션 유형: initial, pyramid_up, averaging_down
}

export interface PendingPyramidSignal {
  symbol: string;
  direction: 'long' | 'short';
  strength: 'weak' | 'medium' | 'strong';
  reasons: string[];
  signalTime: number;
  signalPrice: number;
  indicators: TechnicalIndicators;
}

export interface PyramidTradeLog {
  id: string;
  timestamp: number;
  symbol: string;
  action: 'entry' | 'add' | 'partial_tp' | 'tp' | 'sl' | 'emergency' | 'time_exit' | 'error' | 'pending';
  side: 'long' | 'short';
  stage?: number;
  price: number;
  quantity: number;
  pnl?: number;
  reason?: string;
}

export interface DailyRiskStats {
  tradeCount: number;
  fullPositionCount: number;      // 5단계 올인 횟수
  averageDownCount: number;       // 일일 물타기 횟수
  consecutiveLosses: number;
  dailyPnL: number;
  dailyPnLPercent: number;
  cooldownUntil: number;
}

export interface PyramidTradingState {
  isEnabled: boolean;
  isProcessing: boolean;
  currentSymbol: string | null;
  pendingSignal: PendingPyramidSignal | null;
  currentPosition: PyramidPosition | null;
  todayStats: {
    trades: number;
    wins: number;
    losses: number;
    totalPnL: number;
  };
  dailyRisk: DailyRiskStats;
  tradeLogs: PyramidTradeLog[];
  statusMessage: string;
  scanningProgress: string;
  aiAnalysis: any | null;
  isAiAnalyzing: boolean;
  aiEnabled: boolean;
}

interface UsePyramidTradingProps {
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
}

// ===== 유틸리티 =====

const getMinuteTimestamp = () => Math.floor(Date.now() / 60000);

// ===== 메인 훅 =====

export function usePyramidTrading({
  balanceUSD,
  leverage: _leverage, // 무시하고 10배 고정 사용
  krwRate,
  onTradeComplete,
  initialStats,
  logTrade,
  majorCoinMode = true,
  isTestnet = false,
}: UsePyramidTradingProps) {
  const leverage = PYRAMID_CONFIG.LEVERAGE; // 10배 고정

  const [state, setState] = useState<PyramidTradingState>({
    isEnabled: false,
    isProcessing: false,
    currentSymbol: null,
    pendingSignal: null,
    currentPosition: null,
    todayStats: initialStats || { trades: 0, wins: 0, losses: 0, totalPnL: 0 },
    dailyRisk: {
      tradeCount: 0,
      fullPositionCount: 0,
      averageDownCount: 0,
      consecutiveLosses: 0,
      dailyPnL: 0,
      dailyPnLPercent: 0,
      cooldownUntil: 0,
    },
    tradeLogs: [],
    statusMessage: '🔄 피라미드 매매 비활성화',
    scanningProgress: '',
    aiAnalysis: null,
    isAiAnalyzing: false,
    aiEnabled: true,
  });

  const { user } = useAuth();
  const { placeMarketOrder, getPositions, setLeverage } = useBinanceApi({ isTestnet });
  const { analysis: aiAnalysisResult, isAnalyzing: isAiAnalyzing } = useMarketAnalysis({ mode: majorCoinMode ? 'MAJOR' : 'ALTCOIN' });

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

  // ===== 로그 추가 =====
  const addLog = useCallback((log: Omit<PyramidTradeLog, 'id' | 'timestamp'>) => {
    const newLog: PyramidTradeLog = {
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
        toast.success(`⚡ 피라미드 매매 시작 (10배)`);
      } else {
        toast.info('피라미드 매매 중지');
      }
      return {
        ...prev,
        isEnabled: newEnabled,
        pendingSignal: null,
        statusMessage: newEnabled ? '🔍 시그널 스캔 중...' : '🔄 피라미드 매매 비활성화',
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

  // ===== 평균 단가 계산 =====
  const calculateAvgPrice = useCallback((entries: PyramidEntry[]): number => {
    if (entries.length === 0) return 0;
    const totalValue = entries.reduce((sum, e) => sum + e.price * e.quantity, 0);
    const totalQty = entries.reduce((sum, e) => sum + e.quantity, 0);
    return totalQty > 0 ? totalValue / totalQty : 0;
  }, []);

  // ===== 현재 손익률 계산 =====
  const calculatePnLPercent = useCallback((position: PyramidPosition, currentPrice: number): number => {
    const direction = position.side === 'long' ? 1 : -1;
    const priceDiff = (currentPrice - position.avgPrice) * direction;
    const pnlPercentRaw = (priceDiff / position.avgPrice) * 100;
    const totalFeePercent = PYRAMID_CONFIG.FEE_RATE * 2;
    return pnlPercentRaw - totalFeePercent;
  }, []);

  // ===== 연속 캔들 분석 =====
  const analyzeConsecutiveCandles = useCallback(async (
    symbol: string,
    direction: 'long' | 'short'
  ): Promise<number> => {
    try {
      const klines = await fetch1mKlines(symbol, 10);
      if (!klines || klines.length < 3) return 0;

      let count = 0;
      for (let i = klines.length - 2; i >= 0; i--) {
        const candle = klines[i];
        const isBullish = candle.close > candle.open;
        const isBearish = candle.close < candle.open;

        if (direction === 'long' && isBullish) count++;
        else if (direction === 'short' && isBearish) count++;
        else break;
      }
      return count;
    } catch {
      return 0;
    }
  }, []);

  // ===== 반대 캔들 분석 (물타기 필터용) =====
  const analyzeOppositeCandles = useCallback(async (
    symbol: string,
    direction: 'long' | 'short'
  ): Promise<number> => {
    try {
      const klines = await fetch1mKlines(symbol, 10);
      if (!klines || klines.length < 3) return 0;

      let count = 0;
      // 반대 방향 캔들 카운트
      for (let i = klines.length - 2; i >= 0; i--) {
        const candle = klines[i];
        const isBullish = candle.close > candle.open;
        const isBearish = candle.close < candle.open;

        // 롱 포지션이면 하락 캔들이 반대
        if (direction === 'long' && isBearish) count++;
        else if (direction === 'short' && isBullish) count++;
        else break;
      }
      return count;
    } catch {
      return 0;
    }
  }, []);

  // ===== 물타기 안전 필터 체크 =====
  const checkAveragingDownSafety = useCallback(async (
    position: PyramidPosition,
    dailyAvgDownCount: number
  ): Promise<{ safe: boolean; reason: string }> => {
    const filters = PYRAMID_CONFIG.AVERAGING_DOWN.safetyFilters;

    // 1. 일일 물타기 횟수 제한
    if (dailyAvgDownCount >= filters.maxDailyAverageDown) {
      return { safe: false, reason: `일일 물타기 한도 도달 (${filters.maxDailyAverageDown}회)` };
    }

    // 2. RSI 과매도 체크
    if (filters.requireRsiOversold) {
      const rsi = position.indicators.rsi;
      if (rsi > filters.rsiThreshold) {
        return { safe: false, reason: `RSI ${rsi.toFixed(1)} > ${filters.rsiThreshold} (과매도 아님)` };
      }
    }

    // 3. ADX 하락 중 체크 (현재 ADX vs 이전 - 단순 임계값으로 대체)
    if (filters.blockOnAdxFalling) {
      const adx = position.indicators.adx;
      // ADX가 25 미만이면 추세 약화로 간주
      if (adx < 25) {
        return { safe: false, reason: `ADX ${adx.toFixed(1)} < 25 (추세 약화)` };
      }
    }

    // 4. 반대 캔들 연속 체크
    const oppositeCount = await analyzeOppositeCandles(position.symbol, position.side);
    if (oppositeCount >= filters.blockOnOppositeCandles) {
      return { safe: false, reason: `반대 캔들 ${oppositeCount}개 연속 (추세 역행)` };
    }

    return { safe: true, reason: '물타기 조건 충족' };
  }, [analyzeOppositeCandles]);

  // ===== 분할 청산 실행 =====
  const executePartialClose = useCallback(async (
    position: PyramidPosition,
    closeRatio: number,
    currentPrice: number,
    reason: string
  ): Promise<boolean> => {
    if (processingRef.current) return false;
    processingRef.current = true;

    try {
      const closeQty = position.totalQuantity * closeRatio;
      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';

      const precision = await fetchSymbolPrecision(position.symbol, isTestnet);
      const roundedQty = roundQuantity(closeQty, precision);

      if (roundedQty * currentPrice < 5.5) {
        processingRef.current = false;
        return false;
      }

      console.log(`📉 [분할청산] ${position.symbol} ${orderSide} ${(closeRatio * 100).toFixed(0)}% (${roundedQty})`);

      const result = await placeMarketOrder(position.symbol, orderSide, roundedQty, true, currentPrice);
      if (!result || result.error) {
        throw new Error(result?.error || '분할 청산 실패');
      }

      // 포지션 업데이트
      const newTotalQty = position.totalQuantity - roundedQty;
      
      setState(prev => {
        if (!prev.currentPosition) return prev;
        return {
          ...prev,
          currentPosition: {
            ...prev.currentPosition,
            totalQuantity: newTotalQty,
            partialCloses: [...prev.currentPosition.partialCloses, closeRatio],
          },
        };
      });

      addLog({
        symbol: position.symbol,
        action: 'partial_tp',
        side: position.side,
        stage: position.currentStage,
        price: currentPrice,
        quantity: roundedQty,
        reason: `${reason} (${(closeRatio * 100).toFixed(0)}%)`,
      });

      toast.info(`📉 분할 익절 ${(closeRatio * 100).toFixed(0)}%`);
      processingRef.current = false;
      return true;
    } catch (error: any) {
      console.error('Partial close error:', error);
      processingRef.current = false;
      return false;
    }
  }, [placeMarketOrder, addLog, isTestnet]);

  // ===== 전량 청산 =====
  const closePosition = useCallback(async (
    reason: 'tp' | 'sl' | 'emergency' | 'time_exit' | 'exit',
    currentPrice: number
  ) => {
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
          statusMessage: '🔍 다음 시그널 대기...',
        }));
        return;
      }

      const actualQty = Math.abs(parseFloat(actualPosition.positionAmt));
      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';

      console.log(`🔴 [전량청산] ${position.symbol} ${orderSide} 수량=${actualQty} 사유=${reason}`);

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

      // 손익 계산
      const feeRate = PYRAMID_CONFIG.FEE_RATE / 100;
      const direction = position.side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - position.avgPrice) * direction;
      const pnlGross = priceDiff * actualQty;
      const entryNotional = position.avgPrice * actualQty;
      const exitNotional = currentPrice * actualQty;
      const feeUsd = (entryNotional + exitNotional) * feeRate;
      const pnl = pnlGross - feeUsd;
      const isWin = pnl > 0;

      // 리스크 통계 업데이트
      const newConsecutiveLosses = isWin ? 0 : state.dailyRisk.consecutiveLosses + 1;
      let newCooldownUntil = state.dailyRisk.cooldownUntil;

      if (newConsecutiveLosses >= RISK_CONFIG.MAX_CONSECUTIVE_LOSSES) {
        newCooldownUntil = Date.now() + RISK_CONFIG.LOSS_COOLDOWN_MINUTES * 60 * 1000;
        toast.warning(`⚠️ 연속 ${newConsecutiveLosses}패! ${RISK_CONFIG.LOSS_COOLDOWN_MINUTES}분 휴식`);
      }

      setState(prev => ({
        ...prev,
        currentPosition: null,
        currentSymbol: null,
        todayStats: {
          trades: prev.todayStats.trades + 1,
          wins: prev.todayStats.wins + (isWin ? 1 : 0),
          losses: prev.todayStats.losses + (isWin ? 0 : 1),
          totalPnL: prev.todayStats.totalPnL + pnl,
        },
        dailyRisk: {
          ...prev.dailyRisk,
          tradeCount: prev.dailyRisk.tradeCount + 1,
          consecutiveLosses: newConsecutiveLosses,
          dailyPnL: prev.dailyRisk.dailyPnL + pnl,
          cooldownUntil: newCooldownUntil,
        },
        statusMessage: `${isWin ? '✅' : '❌'} ${reason === 'tp' ? '익절' : reason === 'sl' ? '손절' : '청산'} 완료!`,
      }));

      const reasonText: Record<string, string> = {
        tp: '익절',
        sl: '손절',
        emergency: '긴급 탈출',
        time_exit: '시간 초과',
        exit: '수동 청산',
      };

      addLog({
        symbol: position.symbol,
        action: reason === 'tp' ? 'tp' : reason === 'sl' ? 'sl' : 'emergency',
        side: position.side,
        stage: position.currentStage,
        price: currentPrice,
        quantity: actualQty,
        pnl,
        reason: `${reasonText[reason]} (${position.currentStage}단계)`,
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
          entryPrice: position.avgPrice,
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
        quantity: position.totalQuantity,
        reason: error.message || '청산 실패',
      });
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [state.currentPosition, state.dailyRisk, placeMarketOrder, getPositions, krwRate, leverage, addLog, onTradeComplete, logTrade]);

  // ===== TP/SL 체크 =====
  const checkTpSl = useCallback(async (currentPrice: number) => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;

    const position = state.currentPosition;
    const pnlPercent = calculatePnLPercent(position, currentPrice);
    const holdTimeSec = (Date.now() - position.startTime) / 1000;
    const holdTimeMin = holdTimeSec / 60;

    // 상태 메시지 업데이트
    const exposure = getExposurePercent(position.currentStage);
    setState(prev => ({
      ...prev,
      statusMessage: `🔄 ${position.symbol.replace('USDT', '')} ${position.side === 'long' ? '롱' : '숏'} | ${position.currentStage}단계 (${exposure}%) | ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`,
    }));

    // 진입 직후 3초 보호
    if (holdTimeSec < 3) return;

    // 최고 수익률 갱신
    if (pnlPercent > position.maxProfitReached) {
      setState(prev => {
        if (!prev.currentPosition) return prev;
        return {
          ...prev,
          currentPosition: {
            ...prev.currentPosition,
            maxProfitReached: pnlPercent,
          },
        };
      });
    }

    // ===== 긴급 탈출 체크 (포지션 유형별) =====
    const positionType = getPositionType(position.currentStage);
    const maxLoss = getMaxLossPercent(position.currentStage, positionType);
    if (pnlPercent <= -maxLoss) {
      console.log(`🚨 긴급 탈출! 손실 ${pnlPercent.toFixed(2)}% <= -${maxLoss}% (${positionType})`);
      await closePosition('emergency', currentPrice);
      return;
    }

    // ===== 손절 체크 (포지션 유형별) =====
    const slPercent = getStageSL(position.currentStage, positionType);
    if (pnlPercent <= -slPercent) {
      console.log(`🛑 손절! ${pnlPercent.toFixed(2)}% <= -${slPercent}% (${positionType})`);
      await closePosition('sl', currentPrice);
      return;
    }

    // ===== 동적 손절 (수익 도달 후) =====
    for (const { profitTrigger, newSL } of STOP_LOSS_CONFIG.DYNAMIC_SL) {
      if (position.maxProfitReached >= profitTrigger && pnlPercent <= newSL) {
        console.log(`📉 동적 손절! 최고 +${position.maxProfitReached.toFixed(2)}% → 현재 ${pnlPercent.toFixed(2)}%`);
        await closePosition('sl', currentPrice);
        return;
      }
    }

    // ===== 시간 기반 강제 청산 =====
    const maxHold = getStageMaxHold(position.currentStage);
    if (holdTimeMin >= maxHold) {
      if (pnlPercent >= TAKE_PROFIT_CONFIG.TIME_BASED.over15min.profitThreshold) {
        console.log(`⏰ 시간 초과 익절! +${pnlPercent.toFixed(2)}%`);
        await closePosition('tp', currentPrice);
      } else {
        console.log(`⏰ 시간 초과 청산! ${pnlPercent.toFixed(2)}%`);
        await closePosition('time_exit', currentPrice);
      }
      return;
    }

    // ===== 분할 익절 체크 =====
    const tpConfig = getStageTPConfig(position.currentStage);
    if ('targets' in tpConfig) {
      const firstTarget = tpConfig.targets[0];
      // 매 10초마다 로그 (디버깅용)
      if (Math.floor(holdTimeSec) % 10 === 0) {
        console.log(`[TP체크] ${position.symbol} 현재 PnL: ${pnlPercent.toFixed(3)}% | TP목표: +${firstTarget.percent}% | 수수료차감: -0.10%`);
      }
      
      for (const target of tpConfig.targets) {
        if (pnlPercent >= target.percent && !position.partialCloses.includes(target.closeRatio)) {
          console.log(`✅ [익절 트리거] ${pnlPercent.toFixed(3)}% >= +${target.percent}%`);
          if (target.closeRatio >= 1) {
            // 전량 청산
            await closePosition('tp', currentPrice);
          } else {
            // 분할 청산
            await executePartialClose(position, target.closeRatio, currentPrice, `+${target.percent}% 도달`);
          }
          return;
        }
      }
    }

  }, [state.currentPosition, calculatePnLPercent, closePosition, executePartialClose]);

  // ===== 피라미드 진입 실행 =====
  const executePyramidEntry = useCallback(async (
    symbol: string,
    side: 'long' | 'short',
    currentPrice: number,
    indicators: TechnicalIndicators,
    stage: number = 1
  ) => {
    if (processingRef.current) return;

    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));

    try {
      // 20% 포지션 계산
      const stagePercent = PYRAMID_CONFIG.STAGE_SIZE_PERCENT / 100;
      const entryBalance = balanceUSD * stagePercent;
      const buyingPower = entryBalance * leverage;
      const rawQty = buyingPower / currentPrice;

      const precision = await fetchSymbolPrecision(symbol, isTestnet);
      const quantity = roundQuantity(rawQty, precision);

      if (quantity * currentPrice < 5.5) {
        throw new Error('최소 주문금액 미달');
      }

      // 레버리지 설정 (첫 진입 시만)
      if (stage === 1) {
        try {
          await setLeverage(symbol, leverage);
        } catch (levError: any) {
          if (!levError.message?.includes('-4046') && !levError.message?.includes('already')) {
            console.warn('레버리지 설정 실패:', levError.message);
          }
        }
      }

      // 시장가 주문
      const orderSide = side === 'long' ? 'BUY' : 'SELL';
      console.log(`🚀 [피라미드] ${stage}단계 진입: ${symbol} ${orderSide} 수량=${quantity}`);

      const orderResult = await placeMarketOrder(symbol, orderSide, quantity, false, currentPrice);

      if (!orderResult || orderResult.error || orderResult.code) {
        throw new Error(orderResult?.msg || orderResult?.error || '주문 실패');
      }

      let executedQty = parseFloat(orderResult.executedQty || '0');
      const origQty = parseFloat(orderResult.origQty || '0');
      const avgPrice = parseFloat(orderResult.avgPrice || orderResult.price || '0') || currentPrice;

      if (executedQty <= 0 && origQty > 0) {
        executedQty = origQty;
      }

      if (executedQty <= 0) {
        throw new Error(`주문 체결 실패 - 체결 수량 0`);
      }

      lastEntryTimeRef.current = Date.now();

      const newEntry: PyramidEntry = {
        stage,
        price: avgPrice > 0 ? avgPrice : currentPrice,
        quantity: executedQty,
        timestamp: Date.now(),
      };

      if (stage === 1) {
        // 새 포지션 생성
        const newPosition: PyramidPosition = {
          symbol,
          side,
          entries: [newEntry],
          avgPrice: newEntry.price,
          totalQuantity: executedQty,
          currentStage: 1,
          startTime: Date.now(),
          maxProfitReached: 0,
          dynamicSL: getStageSL(1),
          partialCloses: [],
          consecutiveSameDir: 0,
          indicators,
          positionType: 'initial',
        };

        setState(prev => ({
          ...prev,
          pendingSignal: null,
          currentPosition: newPosition,
          currentSymbol: symbol,
          statusMessage: `🔄 ${symbol.replace('USDT', '')} ${side === 'long' ? '롱' : '숏'} 1단계`,
        }));

        addLog({
          symbol,
          action: 'entry',
          side,
          stage: 1,
          price: newEntry.price,
          quantity: executedQty,
          reason: `1단계 진입 (${PYRAMID_CONFIG.STAGE_SIZE_PERCENT}%)`,
        });

        playEntrySound();
        toast.success(`⚡ ${side === 'long' ? '롱' : '숏'} 1단계 진입!`);
      } else {
        // 추가 매수
        setState(prev => {
          if (!prev.currentPosition) return prev;

          const updatedEntries = [...prev.currentPosition.entries, newEntry];
          const newAvgPrice = calculateAvgPrice(updatedEntries);
          const newTotalQty = updatedEntries.reduce((sum, e) => sum + e.quantity, 0);

          // 5단계 올인 횟수 카운트
          const newFullPositionCount = stage === 5
            ? prev.dailyRisk.fullPositionCount + 1
            : prev.dailyRisk.fullPositionCount;

          return {
            ...prev,
            currentPosition: {
              ...prev.currentPosition,
              entries: updatedEntries,
              avgPrice: newAvgPrice,
              totalQuantity: newTotalQty,
              currentStage: stage,
              dynamicSL: getStageSL(stage),
              positionType: getPositionType(stage),
            },
            dailyRisk: {
              ...prev.dailyRisk,
              fullPositionCount: newFullPositionCount,
            },
            statusMessage: `🔄 ${symbol.replace('USDT', '')} ${side === 'long' ? '롱' : '숏'} ${stage}단계`,
          };
        });

        const stageType = getPositionType(stage);
        const isAveragingDown = stageType === 'averaging_down';

        addLog({
          symbol,
          action: 'add',
          side,
          stage,
          price: newEntry.price,
          quantity: executedQty,
          reason: isAveragingDown 
            ? `${stage}단계 물타기 💧 (${stage * PYRAMID_CONFIG.STAGE_SIZE_PERCENT}%)`
            : `${stage}단계 불타기 🔥 (${stage * PYRAMID_CONFIG.STAGE_SIZE_PERCENT}%)`,
        });

        const exposure = getExposurePercent(stage);
        toast.info(`📈 ${stage}단계 추가! 노출 ${exposure}%`);
      }

    } catch (error: any) {
      console.error('Entry error:', error);
      lastEntryTimeRef.current = Date.now();

      if (stage === 1) {
        setState(prev => ({ ...prev, pendingSignal: null, statusMessage: '🔍 다음 시그널 대기...' }));
      }

      addLog({
        symbol,
        action: 'error',
        side,
        stage,
        price: currentPrice,
        quantity: 0,
        reason: error.message || '진입 실패',
      });
      toast.error(`진입 실패: ${error.message || '오류'}`);
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [balanceUSD, leverage, placeMarketOrder, setLeverage, addLog, calculateAvgPrice, isTestnet]);

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
    if (balanceUSD <= 0) return;
    if (state.currentPosition) return;
    if (state.pendingSignal) return;

    // 리스크 체크
    if (Date.now() < state.dailyRisk.cooldownUntil) {
      console.log('[handleSignal] 쿨다운 중...');
      return;
    }
    if (state.dailyRisk.tradeCount >= RISK_CONFIG.DAILY_MAX_TRADES) {
      console.log('[handleSignal] 일일 거래 한도 도달');
      return;
    }

    // 시그널 강도 체크
    if (strength === 'weak') return;

    // ADX 필터
    if (indicators.adx < PYRAMID_CONFIG.MIN_ADX) {
      console.log(`[handleSignal] ${symbol} 횡보장 필터 (ADX: ${indicators.adx.toFixed(1)})`);
      return;
    }

    console.log(`[handleSignal] ${symbol} ${direction} ${strength}`, reasons);

    // 대기 상태로 전환
    const pendingSignal: PendingPyramidSignal = {
      symbol,
      direction,
      strength,
      reasons,
      signalTime: Date.now(),
      signalPrice: price,
      indicators,
    };

    setState(prev => ({
      ...prev,
      pendingSignal,
      currentSymbol: symbol,
      statusMessage: `⏳ ${symbol.replace('USDT', '')} 분석 중...`,
    }));

    addLog({
      symbol,
      action: 'pending',
      side: direction,
      price,
      quantity: 0,
      reason: `${strength} 시그널 감지`,
    });

    // 즉시 진입 (1단계는 대기 없음)
    let currentPrice = price;
    try {
      const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
      const data = await res.json();
      currentPrice = parseFloat(data.price);
    } catch {
      console.warn('가격 조회 실패');
    }

    setState(prev => ({ ...prev, pendingSignal: null }));
    await executePyramidEntry(symbol, direction, currentPrice, indicators, 1);

  }, [state.isEnabled, state.currentPosition, state.pendingSignal, state.dailyRisk, user, balanceUSD, addLog, executePyramidEntry]);

  // ===== BB 시그널 핸들러 (레거시 호환) =====
  const handleSignal = useCallback(async (
    symbol: string,
    touchType: 'upper' | 'lower',
    currentPrice: number
  ) => {
    if (!state.isEnabled) return;
    if (processingRef.current) return;
    if (state.currentPosition) return;
    if (state.pendingSignal) return;

    const klines = await fetch5mKlines(symbol, 50);
    if (!klines || klines.length < 30) return;

    const indicators = calculateAllIndicators(klines);
    if (!indicators) return;

    const direction = touchType === 'upper' ? 'short' : 'long';
    const signalCheck = direction === 'long'
      ? checkLongSignal(indicators, currentPrice)
      : checkShortSignal(indicators, currentPrice);

    if (signalCheck.valid) {
      await handleTechnicalSignal(symbol, direction, currentPrice, signalCheck.strength, signalCheck.reasons, indicators);
    }
  }, [state.isEnabled, state.currentPosition, state.pendingSignal, handleTechnicalSignal]);

  // ===== 하이브리드 추가 진입 체크 (불타기 + 물타기) =====
  const checkNextStageEntry = useCallback(async (currentPrice: number) => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;

    const position = state.currentPosition;
    const nextStage = position.currentStage + 1;

    if (nextStage > PYRAMID_CONFIG.TOTAL_STAGES) return;

    // 5단계 올인 일일 제한 체크
    if (nextStage === 5 && state.dailyRisk.fullPositionCount >= RISK_CONFIG.MAX_FULL_POSITION_DAILY) {
      console.log('[checkNextStage] 5단계 올인 일일 한도 도달');
      return;
    }

    const pnlPercent = calculatePnLPercent(position, currentPrice);
    const currentType = getPositionType(position.currentStage);
    const holdTimeMin = (Date.now() - position.startTime) / 60000;
    const timeWindow = PYRAMID_CONFIG.STAGE_TIME_WINDOW[nextStage];

    // 시간 윈도우 체크
    if (timeWindow && (holdTimeMin < timeWindow[0] || holdTimeMin > timeWindow[1])) {
      return;
    }

    // ===== 불타기 체크 (수익시) =====
    const pyramidCheck = shouldPyramidUp(position.currentStage, pnlPercent, currentType);
    
    // 디버깅 로그 (매번 출력)
    if (position.currentStage < 3) {
      const nextStageCondition = PYRAMID_CONFIG.PYRAMID_UP.conditions[nextStage];
      if (nextStageCondition) {
        console.log(`[불타기체크] ${position.symbol} Stage ${position.currentStage} → ${nextStage} | PnL: ${pnlPercent.toFixed(3)}% | 필요: +${nextStageCondition.profitRequired}% | 시간: ${holdTimeMin.toFixed(1)}분`);
      }
    }
    
    if (pyramidCheck.should) {
      // 연속 캔들 조건 체크 (불타기 전용)
      const requiredCandles = PYRAMID_CONFIG.STAGE_CANDLE_REQUIRED[nextStage] || 0;
      if (requiredCandles > 0) {
        const consecutiveCandles = await analyzeConsecutiveCandles(position.symbol, position.side);
        if (consecutiveCandles < requiredCandles) {
          console.log(`[불타기] ${nextStage}단계 대기: 연속 캔들 ${consecutiveCandles} < 필요 ${requiredCandles}`);
          return;
        }
      }

      console.log(`🔥 [불타기] ${nextStage}단계 진입! ${pyramidCheck.reason} (수익 ${pnlPercent.toFixed(2)}%)`);
      await executePyramidEntry(position.symbol, position.side, currentPrice, position.indicators, nextStage);
      return;
    }

    // ===== 물타기 체크 (손실시) =====
    const avgDownCheck = shouldAverageDown(position.currentStage, pnlPercent, currentType);
    if (avgDownCheck.should) {
      // 🛡️ 물타기 안전 필터 체크
      const safetyCheck = await checkAveragingDownSafety(position, state.dailyRisk.averageDownCount);
      if (!safetyCheck.safe) {
        console.log(`🛡️ [물타기 차단] ${safetyCheck.reason}`);
        return;
      }

      // 물타기 효과 미리 계산
      const stagePercent = PYRAMID_CONFIG.STAGE_SIZE_PERCENT / 100;
      const newQty = (balanceUSD * stagePercent * PYRAMID_CONFIG.LEVERAGE) / currentPrice;
      const { improvementPercent } = calculateNewAvgPrice(
        position.avgPrice,
        position.totalQuantity,
        currentPrice,
        newQty
      );

      console.log(`💧 [물타기] ${nextStage}단계 진입! ${avgDownCheck.reason} (손실 ${pnlPercent.toFixed(2)}%, 평단 개선 ${improvementPercent.toFixed(2)}%)`);
      
      // 물타기 횟수 증가
      setState(prev => ({
        ...prev,
        dailyRisk: {
          ...prev.dailyRisk,
          averageDownCount: prev.dailyRisk.averageDownCount + 1,
        },
      }));

      await executePyramidEntry(position.symbol, position.side, currentPrice, position.indicators, nextStage);
      return;
    }

  }, [state.currentPosition, state.dailyRisk, balanceUSD, calculatePnLPercent, analyzeConsecutiveCandles, checkAveragingDownSafety, executePyramidEntry]);

  // ===== 시그널 스킵 =====
  const skipSignal = useCallback(() => {
    if (!state.pendingSignal) return;
    setState(prev => ({
      ...prev,
      pendingSignal: null,
      currentSymbol: null,
      statusMessage: '🔍 다음 시그널 대기...',
    }));
    toast.info('시그널 스킵됨');
  }, [state.pendingSignal]);

  // ===== TP/SL 가격 계산 =====
  const calculateTpSlPrices = useCallback(() => {
    if (!state.currentPosition) return { tpPrice: 0, slPrice: 0 };

    const position = state.currentPosition;
    const tpConfig = getStageTPConfig(position.currentStage);
    const slPercent = getStageSL(position.currentStage);

    // 첫 번째 TP 타겟
    const firstTarget = 'targets' in tpConfig ? tpConfig.targets[0].percent : 0.5;

    const direction = position.side === 'long' ? 1 : -1;
    const tpPrice = position.avgPrice * (1 + (firstTarget / 100) * direction);
    const slPrice = position.avgPrice * (1 - (slPercent / 100) * direction);

    return { tpPrice, slPrice };
  }, [state.currentPosition]);

  // ===== 수동 청산 =====
  const manualClose = useCallback((currentPrice: number) => {
    closePosition('exit', currentPrice);
  }, [closePosition]);

  // ===== 포지션 동기화 =====
  useEffect(() => {
    if (!user) return;

    let isMounted = true;

    const syncPositions = async () => {
      try {
        const positions = await getPositions();
        if (!isMounted) return;

        const activePosition = positions?.find((p: any) =>
          Math.abs(parseFloat(p.positionAmt)) > 0
        );

        // 외부 청산 감지
        if (state.currentPosition && !activePosition) {
          const timeSinceEntry = Date.now() - state.currentPosition.startTime;

          if (timeSinceEntry >= 10000) {
            console.log(`⚠️ 외부 청산 감지`);
            toast.warning(`⚠️ ${state.currentPosition.symbol.replace('USDT', '')} 외부에서 청산됨`);
            setState(prev => ({
              ...prev,
              currentPosition: null,
              currentSymbol: null,
              statusMessage: '🔍 다음 시그널 대기...',
            }));
          }
        }
      } catch (error) {
        console.error('Position sync error:', error);
      }
    };

    syncPositions();
    const interval = setInterval(syncPositions, 10000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [user, getPositions, state.currentPosition]);

  // ===== 추가 매수 체크 interval =====
  useEffect(() => {
    if (!state.isEnabled) return;
    if (!state.currentPosition) return;

    const checkInterval = setInterval(async () => {
      if (!state.currentPosition) return;

      // 현재 가격 조회
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${state.currentPosition.symbol}`);
        const data = await res.json();
        const currentPrice = parseFloat(data.price);

        await checkNextStageEntry(currentPrice);
      } catch (e) {
        console.warn('가격 조회 실패');
      }
    }, 5000); // 5초마다 체크

    return () => clearInterval(checkInterval);
  }, [state.isEnabled, state.currentPosition, checkNextStageEntry]);

  // ===== 자정 리셋 =====
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
          dailyRisk: {
            tradeCount: 0,
            fullPositionCount: 0,
            averageDownCount: 0,
            consecutiveLosses: 0,
            dailyPnL: 0,
            dailyPnLPercent: 0,
            cooldownUntil: 0,
          },
          tradeLogs: [],
        }));
        toast.info('📅 새로운 거래일 시작!');
      }
    };

    const interval = setInterval(checkDayChange, 60000);
    return () => clearInterval(interval);
  }, []);

  return {
    state,
    toggleAutoTrading,
    toggleAiAnalysis,
    handleSignal,
    handleTechnicalSignal,
    checkTpSl,
    closePosition: manualClose,
    skipSignal,
    calculateTpSlPrices,
    config: PYRAMID_CONFIG,
  };
}
