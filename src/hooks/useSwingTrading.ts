/**
 * 🔄 5분 스윙 트레이딩 시스템
 * - 1분봉마다 20%씩 분할 매수 (총 5봉 = 100%)
 * - 평단가 기반 TP/SL 실시간 재계산
 * - 조기 익절: +0.5% 도달 시 전량 청산
 * - 5봉 완성 시 전량 청산
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
import { 
  getTradingConfig, 
  isMajorCoin,
} from '@/lib/majorCoins';
import { useMarketAnalysis, MarketAnalysisResult } from './useMarketAnalysis';

// ===== 타입 정의 =====

export interface SwingTradeLog {
  id: string;
  timestamp: number;
  symbol: string;
  action: 'entry' | 'add' | 'exit' | 'tp' | 'sl' | 'error' | 'pending' | 'cancel';
  side: 'long' | 'short';
  price: number;
  quantity: number;
  pnl?: number;
  reason: string;
}

// 분할 매수 기록
interface SwingEntry {
  price: number;
  quantity: number;
  candleNumber: number; // 1~5
  timestamp: number;
}

// 스윙 포지션 정보
export interface SwingPosition {
  symbol: string;
  side: 'long' | 'short';
  entries: SwingEntry[];
  avgPrice: number; // 평균 단가
  totalQuantity: number;
  startTime: number;
  currentCandleNumber: number; // 현재 봉 번호 (1~5)
  nextCandleClose: number; // 다음 봉 마감 시간
  indicators: TechnicalIndicators;
}

// 대기 중인 시그널
interface PendingSwingSignal {
  symbol: string;
  direction: 'long' | 'short';
  strength: 'weak' | 'medium' | 'strong';
  reasons: string[];
  signalTime: number;
  signalPrice: number;
  indicators: TechnicalIndicators;
  waitingForCandle: boolean;
  targetCandleClose: number;
}

export interface SwingTradingState {
  isEnabled: boolean;
  isProcessing: boolean;
  currentSymbol: string | null;
  pendingSignal: PendingSwingSignal | null;
  currentPosition: SwingPosition | null;
  todayStats: {
    trades: number;
    wins: number;
    losses: number;
    totalPnL: number;
  };
  tradeLogs: SwingTradeLog[];
  statusMessage: string;
  scanningProgress: string;
  // AI 분석 관련
  aiAnalysis: MarketAnalysisResult | null;
  isAiAnalyzing: boolean;
  aiEnabled: boolean;
}

interface UseSwingTradingProps {
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
  isTestnet?: boolean;
  majorCoinMode?: boolean;
}

// ===== 설정값 =====
const SWING_CONFIG = {
  // 수수료
  FEE_RATE: 0.05, // 0.05% per side
  
  // 분할 매수
  ENTRY_PERCENT: 0.20, // 1봉당 20%
  MAX_CANDLES: 5, // 최대 5봉
  
  // 익절/손절 (평단가 기준)
  TP_PERCENT: 0.50, // +0.5% 조기 익절
  SL_PERCENT: 0.35, // -0.35% 손절
  
  // 진입 조건
  MIN_SIGNAL_STRENGTH: 'medium' as const,
  MIN_ADX_FOR_TREND: 20,
  MIN_CONFIDENCE: 55, // AI 분석 신뢰도
  
  // 진입 쿨다운
  ENTRY_COOLDOWN_MS: 30000, // 30초
};

// 분 타임스탬프
function getMinuteTimestamp() {
  return Math.floor(Date.now() / 60000);
}

export function useSwingTrading({
  balanceUSD,
  leverage,
  krwRate,
  onTradeComplete,
  initialStats,
  logTrade,
  isTestnet = false,
  majorCoinMode = false,
}: UseSwingTradingProps) {
  const { user } = useAuth();
  const {
    placeMarketOrder,
    getPositions,
    setLeverage,
  } = useBinanceApi({ isTestnet });

  const majorCoinModeRef = useRef(majorCoinMode);
  
  useEffect(() => {
    majorCoinModeRef.current = majorCoinMode;
  }, [majorCoinMode]);

  const [state, setState] = useState<SwingTradingState>({
    isEnabled: false,
    isProcessing: false,
    currentSymbol: null,
    pendingSignal: null,
    currentPosition: null,
    todayStats: initialStats || { trades: 0, wins: 0, losses: 0, totalPnL: 0 },
    tradeLogs: [],
    statusMessage: majorCoinMode ? '🏆 메이저 코인 스윙 매매 비활성화' : '🔄 스윙 매매 비활성화',
    scanningProgress: '',
    aiAnalysis: null,
    isAiAnalyzing: false,
    aiEnabled: true,
  });

  // AI 시장 분석 훅
  const tradingMode = majorCoinMode ? 'MAJOR' : 'ALTCOIN';
  const { 
    analysis: aiAnalysisResult, 
    isAnalyzing: isAiAnalyzing, 
    dynamicConfig, 
    analyzeMarket,
    shouldAnalyze,
    resetAnalysis,
  } = useMarketAnalysis({ 
    mode: tradingMode as 'MAJOR' | 'ALTCOIN', 
    enabled: state.isEnabled && state.aiEnabled,
  });

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
  const lastMinuteRef = useRef(getMinuteTimestamp());
  const lastEntryTimeRef = useRef(0);

  // 로그 추가
  const addLog = useCallback((log: Omit<SwingTradeLog, 'id' | 'timestamp'>) => {
    const newLog: SwingTradeLog = {
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
      const modeLabel = majorCoinModeRef.current ? '🏆 메이저 코인' : '🎯 잡코인';
      if (newEnabled) {
        initAudio();
        toast.success(`🔄 ${modeLabel} 5분 스윙 시스템 시작`);
      } else {
        toast.info('스윙 매매 중지');
      }
      return {
        ...prev,
        isEnabled: newEnabled,
        pendingSignal: null,
        statusMessage: newEnabled ? `🔍 ${modeLabel} 스캔 중...` : (majorCoinModeRef.current ? '🏆 메이저 코인 스윙 매매 비활성화' : '🔄 스윙 매매 비활성화'),
        scanningProgress: '',
      };
    });
  }, []);

  // 평균 단가 계산
  const calculateAvgPrice = useCallback((entries: SwingEntry[]): number => {
    if (entries.length === 0) return 0;
    const totalValue = entries.reduce((sum, e) => sum + e.price * e.quantity, 0);
    const totalQty = entries.reduce((sum, e) => sum + e.quantity, 0);
    return totalQty > 0 ? totalValue / totalQty : 0;
  }, []);

  // 전량 청산
  const closePosition = useCallback(async (reason: 'tp' | 'sl' | 'exit' | 'complete', currentPrice: number) => {
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
      const actualEntryPrice = position.avgPrice; // 평단가 사용

      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';
      console.log(`🔴 [closePosition] 청산 요청: ${position.symbol} ${orderSide} 수량=${actualQty} 가격=${currentPrice} 사유=${reason}`);
      
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

      // 손익 계산 (수수료 반영)
      const feeRate = SWING_CONFIG.FEE_RATE / 100;
      const direction = position.side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - actualEntryPrice) * direction;
      const pnlGross = priceDiff * actualQty;

      const entryNotional = actualEntryPrice * actualQty;
      const exitNotional = currentPrice * actualQty;
      const feeUsd = (entryNotional + exitNotional) * feeRate;

      const pnl = pnlGross - feeUsd;
      const isWin = pnl > 0;

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
        statusMessage: `${isWin ? '✅' : '❌'} ${reason === 'tp' ? '익절' : reason === 'sl' ? '손절' : '청산'} 완료! 다음 시그널 대기...`,
      }));

      const reasonText = {
        tp: '조기 익절',
        sl: '손절',
        exit: '수동 청산',
        complete: '5봉 완성 청산',
      }[reason];

      addLog({
        symbol: position.symbol,
        action: isWin ? 'tp' : 'sl',
        side: position.side,
        price: currentPrice,
        quantity: actualQty,
        pnl,
        reason: `${reasonText} (${position.entries.length}봉)`,
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
        quantity: position.totalQuantity,
        reason: error.message || '청산 실패',
      });
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [state.currentPosition, placeMarketOrder, getPositions, krwRate, leverage, addLog, onTradeComplete, logTrade]);

  // TP/SL 체크 (평단가 기준)
  const checkTpSl = useCallback(async (currentPrice: number) => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;

    const position = state.currentPosition;
    const direction = position.side === 'long' ? 1 : -1;
    const priceDiff = (currentPrice - position.avgPrice) * direction;
    const pnlPercentRaw = (priceDiff / position.avgPrice) * 100;
    
    // 수수료 반영 손익
    const totalFeePercent = SWING_CONFIG.FEE_RATE * 2;
    const pnlPercent = pnlPercentRaw - totalFeePercent;
    
    const holdTimeSec = (Date.now() - position.startTime) / 1000;
    const entryCount = position.entries.length;
    
    console.log(`[스윙] ${position.symbol} ${position.side.toUpperCase()} | ${entryCount}/5봉 | 평단가:$${position.avgPrice.toFixed(4)} | 손익:${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`);
    
    // 상태 메시지 업데이트
    setState(prev => ({
      ...prev,
      statusMessage: `🔄 ${position.symbol.replace('USDT', '')} ${position.side === 'long' ? '롱' : '숏'} | ${entryCount}/5봉 | ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}%`,
    }));

    // 진입 직후 5초 보호
    if (holdTimeSec < 5) {
      return;
    }

    // 조기 익절: +0.5% 도달 (2봉 이상 투입 후)
    if (entryCount >= 2 && pnlPercent >= SWING_CONFIG.TP_PERCENT) {
      console.log(`🎯 [스윙] 조기 익절! +${pnlPercent.toFixed(2)}% >= +${SWING_CONFIG.TP_PERCENT}%`);
      toast.success(`🎯 조기 익절! +${pnlPercent.toFixed(2)}%`);
      await closePosition('tp', currentPrice);
      return;
    }

    // 손절: -0.35%
    if (pnlPercent <= -SWING_CONFIG.SL_PERCENT) {
      console.log(`🛑 [스윙] 손절! ${pnlPercent.toFixed(2)}% <= -${SWING_CONFIG.SL_PERCENT}%`);
      await closePosition('sl', currentPrice);
      return;
    }

  }, [state.currentPosition, closePosition]);

  // 1분봉 완성 분석
  const analyzeCandleDirection = useCallback(async (
    symbol: string,
    originalDirection: 'long' | 'short'
  ): Promise<{ direction: 'long' | 'short'; confidence: number; reason: string }> => {
    try {
      const klines = await fetch1mKlines(symbol, 5);
      if (!klines || klines.length < 3) {
        return { direction: originalDirection, confidence: 30, reason: '데이터 부족' };
      }

      const completedCandle = klines[klines.length - 2];
      const prevCandle = klines[klines.length - 3];
      const currentCandle = klines[klines.length - 1];

      const candleBody = completedCandle.close - completedCandle.open;
      const candleRange = completedCandle.high - completedCandle.low;
      const bodyRatio = candleRange > 0 ? Math.abs(candleBody) / candleRange : 0;
      const isBullish = candleBody > 0;
      const isBearish = candleBody < 0;

      let confidence = 50;
      let reasons: string[] = [];

      // 봉 방향 분석
      if (bodyRatio > 0.5) {
        if (isBullish) {
          confidence += 15;
          reasons.push('강한 양봉');
        } else if (isBearish) {
          confidence -= 15;
          reasons.push('강한 음봉');
        }
      }

      // 연속 캔들 분석
      const prevBody = prevCandle.close - prevCandle.open;
      if ((isBullish && prevBody > 0) || (isBearish && prevBody < 0)) {
        confidence += 10;
        reasons.push('연속 방향');
      }

      // 현재 진행 중인 봉 방향
      const currentBody = currentCandle.close - currentCandle.open;
      if (originalDirection === 'long' && currentBody > 0) {
        confidence += 12;
        reasons.push('진행봉 양봉');
      } else if (originalDirection === 'short' && currentBody < 0) {
        confidence += 12;
        reasons.push('진행봉 음봉');
      } else if (originalDirection === 'long' && currentBody < 0) {
        confidence -= 10;
        reasons.push('진행봉 음봉(역방향)');
      } else if (originalDirection === 'short' && currentBody > 0) {
        confidence -= 10;
        reasons.push('진행봉 양봉(역방향)');
      }

      // 신뢰도 범위 제한
      confidence = Math.max(30, Math.min(95, confidence));

      // 방향 결정
      let finalDirection = originalDirection;
      if (confidence < 45) {
        finalDirection = originalDirection === 'long' ? 'short' : 'long';
        confidence = 100 - confidence;
      }

      return {
        direction: finalDirection,
        confidence,
        reason: reasons.join(', ') || '기본 분석',
      };
    } catch (error) {
      console.error('봉 방향 분석 실패:', error);
      return { direction: originalDirection, confidence: 30, reason: '분석 실패' };
    }
  }, []);

  // 분할 매수 실행
  const executeSwingEntry = useCallback(async (
    symbol: string,
    side: 'long' | 'short',
    currentPrice: number,
    indicators: TechnicalIndicators,
    candleNumber: number = 1
  ) => {
    if (processingRef.current) return;

    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));

    try {
      // 20% 포지션 계산
      const entryBalance = balanceUSD * SWING_CONFIG.ENTRY_PERCENT;
      const buyingPower = entryBalance * leverage;
      const rawQty = buyingPower / currentPrice;

      const precision = await fetchSymbolPrecision(symbol, isTestnet);
      const quantity = roundQuantity(rawQty, precision);

      if (quantity * currentPrice < 5.5) {
        throw new Error('최소 주문금액 미달');
      }

      // 레버리지 설정 (첫 진입 시만)
      if (candleNumber === 1) {
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
      console.log(`🚀 [스윙] ${candleNumber}봉 진입: ${symbol} ${orderSide} 수량=${quantity}`);
      
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

      // 새 진입 기록
      const newEntry: SwingEntry = {
        price: avgPrice > 0 ? avgPrice : currentPrice,
        quantity: executedQty,
        candleNumber,
        timestamp: Date.now(),
      };

      // 다음 봉 마감 시간
      const now = Date.now();
      const currentMinuteStart = Math.floor(now / 60000) * 60000;
      const nextCandleClose = currentMinuteStart + 60000 + 3000; // 다음 봉 마감 + 3초

      if (candleNumber === 1) {
        // 첫 진입 - 새 포지션 생성
        const newPosition: SwingPosition = {
          symbol,
          side,
          entries: [newEntry],
          avgPrice: newEntry.price,
          totalQuantity: executedQty,
          startTime: Date.now(),
          currentCandleNumber: 1,
          nextCandleClose,
          indicators,
        };

        setState(prev => ({
          ...prev,
          pendingSignal: null,
          currentPosition: newPosition,
          currentSymbol: symbol,
          statusMessage: `🔄 ${symbol.replace('USDT', '')} ${side === 'long' ? '롱' : '숏'} 1/5봉`,
        }));

        addLog({
          symbol,
          action: 'entry',
          side,
          price: newEntry.price,
          quantity: executedQty,
          reason: `1봉 진입 (20%)`,
        });

        playEntrySound();
        toast.success(`🔄 ${side === 'long' ? '롱' : '숏'} 1/5봉 진입! ${symbol.replace('USDT', '')}`);
      } else {
        // 추가 매수 - 기존 포지션에 추가
        setState(prev => {
          if (!prev.currentPosition) return prev;
          
          const updatedEntries = [...prev.currentPosition.entries, newEntry];
          const newAvgPrice = calculateAvgPrice(updatedEntries);
          const newTotalQty = updatedEntries.reduce((sum, e) => sum + e.quantity, 0);

          return {
            ...prev,
            currentPosition: {
              ...prev.currentPosition,
              entries: updatedEntries,
              avgPrice: newAvgPrice,
              totalQuantity: newTotalQty,
              currentCandleNumber: candleNumber,
              nextCandleClose,
            },
            statusMessage: `🔄 ${symbol.replace('USDT', '')} ${side === 'long' ? '롱' : '숏'} ${candleNumber}/5봉`,
          };
        });

        addLog({
          symbol,
          action: 'add',
          side,
          price: newEntry.price,
          quantity: executedQty,
          reason: `${candleNumber}봉 추가 매수 (${candleNumber * 20}%)`,
        });

        toast.info(`📈 ${candleNumber}/5봉 추가 매수! 평단가 갱신`);
      }

    } catch (error: any) {
      console.error('Entry error:', error);
      lastEntryTimeRef.current = Date.now();
      
      if (candleNumber === 1) {
        setState(prev => ({ ...prev, pendingSignal: null, statusMessage: '🔍 다음 시그널 대기...' }));
      }
      
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
  }, [balanceUSD, leverage, placeMarketOrder, setLeverage, addLog, calculateAvgPrice, isTestnet]);

  // 시그널 핸들러
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
    if (Date.now() - lastEntryTimeRef.current < SWING_CONFIG.ENTRY_COOLDOWN_MS) return;

    // 시그널 강도 체크
    const strengthOrder = { weak: 1, medium: 2, strong: 3 };
    if (strengthOrder[strength] < strengthOrder[SWING_CONFIG.MIN_SIGNAL_STRENGTH]) return;

    // ADX 필터
    if (indicators.adx < SWING_CONFIG.MIN_ADX_FOR_TREND) {
      console.log(`[handleSignal] ${symbol} 횡보장 필터 (ADX: ${indicators.adx.toFixed(1)})`);
      return;
    }

    console.log(`[handleSignal] ${symbol} ${direction} ${strength}`, reasons);

    // 봉 완성 대기 상태로 전환
    const now = Date.now();
    const currentMinuteStart = Math.floor(now / 60000) * 60000;
    const nextCandleClose = currentMinuteStart + 60000 + 5000;

    const pendingSignal: PendingSwingSignal = {
      symbol,
      direction,
      strength,
      reasons,
      signalTime: now,
      signalPrice: price,
      indicators,
      waitingForCandle: true,
      targetCandleClose: nextCandleClose,
    };

    setState(prev => ({
      ...prev,
      pendingSignal,
      currentSymbol: symbol,
      statusMessage: `⏳ ${symbol.replace('USDT', '')} 봉 완성 대기 중...`,
    }));

    addLog({
      symbol,
      action: 'pending',
      side: direction,
      price,
      quantity: 0,
      reason: `${strength} 시그널 대기`,
    });

    toast.info(`⏳ ${symbol.replace('USDT', '')} 봉 완성 대기 (5분 스윙)`);

  }, [state.isEnabled, state.currentPosition, state.pendingSignal, user, balanceUSD, addLog]);

  // 봉 완성 확인 및 진입/추가매수 처리
  const processPendingSignal = useCallback(async () => {
    // 대기 중인 시그널 처리 (첫 진입)
    const pending = state.pendingSignal;
    if (pending?.waitingForCandle && !state.currentPosition) {
      const now = Date.now();
      
      if (now < pending.targetCandleClose) {
        const remainingSec = Math.ceil((pending.targetCandleClose - now) / 1000);
        setState(prev => ({
          ...prev,
          statusMessage: `⏳ ${pending.symbol.replace('USDT', '')} 봉 완성 대기... (${remainingSec}초)`,
        }));
        return;
      }

      // 봉 완성됨 → AI 분석
      console.log(`[processPendingSignal] ${pending.symbol} 봉 완성 → 분석 시작`);
      
      const analysis = await analyzeCandleDirection(pending.symbol, pending.direction);
      
      // 최신 가격 조회
      let currentPrice = pending.signalPrice;
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${pending.symbol}`);
        const data = await res.json();
        currentPrice = parseFloat(data.price);
      } catch (e) {
        console.warn('가격 조회 실패');
      }

      // 신뢰도 체크
      if (analysis.confidence < SWING_CONFIG.MIN_CONFIDENCE || analysis.reason === '분석 실패') {
        console.log(`⚠️ 신뢰도 부족 (${analysis.confidence}%) - 스킵`);
        toast.warning(`⚠️ 분석 불충분 (${analysis.confidence}%) - 스킵`);
        setState(prev => ({
          ...prev,
          pendingSignal: null,
          currentSymbol: null,
          statusMessage: '🔍 다음 시그널 대기...',
        }));
        return;
      }

      // 첫 진입 실행
      setState(prev => ({
        ...prev,
        pendingSignal: null,
      }));

      await executeSwingEntry(pending.symbol, analysis.direction, currentPrice, pending.indicators, 1);
      return;
    }

    // 포지션 보유 중 - 추가 매수 처리
    const position = state.currentPosition;
    if (position && position.currentCandleNumber < SWING_CONFIG.MAX_CANDLES) {
      const now = Date.now();
      
      if (now < position.nextCandleClose) {
        return;
      }

      // 봉 완성됨 → 추가 매수 또는 5봉 청산
      const nextCandleNumber = position.currentCandleNumber + 1;
      
      // 최신 가격 조회
      let currentPrice = position.avgPrice;
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${position.symbol}`);
        const data = await res.json();
        currentPrice = parseFloat(data.price);
      } catch (e) {
        console.warn('가격 조회 실패');
      }

      if (nextCandleNumber === 5) {
        // 5봉 완성 - 청산 또는 마지막 추가 매수 후 즉시 청산
        console.log(`[processPendingSignal] 5봉 완성 → 전량 청산`);
        
        // 마지막 추가 매수
        await executeSwingEntry(position.symbol, position.side, currentPrice, position.indicators, 5);
        
        // 즉시 청산
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1초 대기
        await closePosition('complete', currentPrice);
      } else {
        // 2~4봉 추가 매수
        console.log(`[processPendingSignal] ${nextCandleNumber}봉 추가 매수`);
        await executeSwingEntry(position.symbol, position.side, currentPrice, position.indicators, nextCandleNumber);
      }
    }
  }, [state.pendingSignal, state.currentPosition, analyzeCandleDirection, executeSwingEntry, closePosition]);

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

  // 포지션 동기화
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

  // 봉 완성 체크 interval
  useEffect(() => {
    if (!state.isEnabled) return;
    if (!state.pendingSignal?.waitingForCandle && !state.currentPosition) return;
    
    const interval = setInterval(() => {
      processPendingSignal();
    }, 1000);
    
    return () => clearInterval(interval);
  }, [state.isEnabled, state.pendingSignal, state.currentPosition, processPendingSignal]);

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
      statusMessage: '🔍 다음 시그널 대기...',
    }));

    toast.info(`⏭️ ${symbol} 패스됨`);
  }, [state.pendingSignal, addLog]);

  // AI 분석 토글
  const toggleAiAnalysis = useCallback(() => {
    setState(prev => ({
      ...prev,
      aiEnabled: !prev.aiEnabled,
    }));
    if (!state.aiEnabled) {
      resetAnalysis();
    }
  }, [state.aiEnabled, resetAnalysis]);

  // AI 분석 수동 실행
  const runAiAnalysis = useCallback(async (
    symbol: string,
    indicators: TechnicalIndicators,
    price: number,
    priceChange24h: number,
    volume24h: number
  ) => {
    if (!state.aiEnabled || !state.isEnabled) return;
    await analyzeMarket(symbol, indicators, price, priceChange24h, volume24h);
  }, [state.aiEnabled, state.isEnabled, analyzeMarket]);

  // TP/SL 가격 계산 (UI용)
  const calculateTpSlPrices = useCallback(() => {
    if (!state.currentPosition) return { tpPrice: 0, slPrice: 0 };
    
    const { avgPrice, side } = state.currentPosition;
    const direction = side === 'long' ? 1 : -1;
    
    const tpPrice = avgPrice * (1 + direction * (SWING_CONFIG.TP_PERCENT / 100));
    const slPrice = avgPrice * (1 - direction * (SWING_CONFIG.SL_PERCENT / 100));
    
    return { tpPrice, slPrice };
  }, [state.currentPosition]);

  return {
    state,
    toggleAutoTrading,
    handleSignal: handleBBSignal,
    handleTechnicalSignal: handleSignal,
    closePosition,
    checkTpSl,
    skipSignal,
    toggleAiAnalysis,
    runAiAnalysis,
    dynamicConfig,
    shouldAnalyze,
    processPendingSignal,
    calculateTpSlPrices,
    // 설정값 노출
    config: SWING_CONFIG,
  };
}
