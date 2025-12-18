import { useState, useEffect, useRef, useCallback } from 'react';
import { useBinanceApi } from './useBinanceApi';
import { useAuth } from './useAuth';
import { fetchSymbolPrecision, roundQuantity } from '@/lib/binance';
import { toast } from 'sonner';

export interface AutoTradeLog {
  id: string;
  timestamp: number;
  symbol: string;
  action: 'entry' | 'exit' | 'tp' | 'sl' | 'error' | 'pending' | 'cancel';
  side: 'long' | 'short';
  price: number;
  quantity: number;
  pnl?: number;
  reason: string;
}

// 대기 중인 시그널
interface PendingSignal {
  symbol: string;
  touchType: 'upper' | 'lower';
  signalTime: number;
  signalPrice: number;
  signalCandleOpen: number;
  signalCandleHigh: number;
  signalCandleLow: number;
}

// 진입 시 저장할 봉 정보
interface EntryCandleInfo {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface AutoTradingState {
  isEnabled: boolean;
  isProcessing: boolean;
  currentSymbol: string | null;
  pendingSignal: PendingSignal | null;
  currentPosition: {
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    quantity: number;
    entryTime: number;
    entryCandle: EntryCandleInfo; // 진입 시점 봉 정보
  } | null;
  todayStats: {
    trades: number;
    wins: number;
    losses: number;
    totalPnL: number;
  };
  tradeLogs: AutoTradeLog[];
  consecutiveLosses: number;
  cooldownUntil: number | null;
  tpPercent: number; // 동적 익절 퍼센트
}

interface UseAutoTradingProps {
  balanceUSD: number;
  leverage: number;
  krwRate: number;
  onTradeComplete?: () => void; // 청산 완료 시 호출
}

// 1분봉 데이터 가져오기
async function fetch1mKlines(symbol: string, limit: number = 20) {
  try {
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=${limit}`
    );
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data.map((k: any[]) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
    }));
  } catch {
    return null;
  }
}

// 변동성 급등 체크 (최근 5분 vs 이전 20분 평균)
async function checkVolatilitySpike(symbol: string): Promise<{ isSpike: boolean; ratio: number }> {
  try {
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=25`
    );
    const data = await res.json();
    if (!Array.isArray(data) || data.length < 25) {
      return { isSpike: false, ratio: 1 };
    }
    
    // 최근 5분 변동성 (고가-저가 비율)
    const recent5 = data.slice(-5);
    const recent5Vol = recent5.reduce((sum: number, k: any[]) => {
      const range = (parseFloat(k[2]) - parseFloat(k[3])) / parseFloat(k[3]) * 100;
      return sum + range;
    }, 0) / 5;
    
    // 이전 20분 평균 변동성
    const prev20 = data.slice(0, 20);
    const prev20Vol = prev20.reduce((sum: number, k: any[]) => {
      const range = (parseFloat(k[2]) - parseFloat(k[3])) / parseFloat(k[3]) * 100;
      return sum + range;
    }, 0) / 20;
    
    const ratio = prev20Vol > 0 ? recent5Vol / prev20Vol : 1;
    
    return { isSpike: ratio >= 3, ratio };
  } catch (error) {
    console.error('Volatility check error:', error);
    return { isSpike: false, ratio: 1 };
  }
}

// 현재 분이 바뀌었는지 체크 (봉 완성 감지)
function getMinuteTimestamp() {
  return Math.floor(Date.now() / 60000);
}

export function useAutoTrading({ balanceUSD, leverage, krwRate, onTradeComplete }: UseAutoTradingProps) {
  const { user } = useAuth();
  const { 
    placeMarketOrder, 
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
    todayStats: { trades: 0, wins: 0, losses: 0, totalPnL: 0 },
    tradeLogs: [],
    consecutiveLosses: 0,
    cooldownUntil: null,
    tpPercent: 0.3, // 기본값, 진입 시 동적으로 업데이트됨
  });
  
  const processingRef = useRef(false);
  const lastMinuteRef = useRef(getMinuteTimestamp());
  const lastEntryTimeRef = useRef(0);
  
  // 쿨다운 설정
  const ENTRY_COOLDOWN_MS = 60000; // 1분
  const CONSECUTIVE_LOSS_LIMIT = 3;
  const LOSS_COOLDOWN_MS = 30 * 60 * 1000; // 30분
  
  // 자동매매 토글
  const toggleAutoTrading = useCallback(() => {
    setState(prev => {
      const newEnabled = !prev.isEnabled;
      if (newEnabled) {
        toast.success('🤖 자동매매 시작 (확인 진입 모드)');
      } else {
        toast.info('자동매매 중지');
      }
      return { ...prev, isEnabled: newEnabled, pendingSignal: null };
    });
  }, []);
  
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
  
  // BB 시그널 감지 → 대기 상태로 저장 (바로 진입 X)
  const handleSignal = useCallback(async (
    symbol: string, 
    touchType: 'upper' | 'lower',
    currentPrice: number
  ) => {
    if (!state.isEnabled) return;
    if (processingRef.current) return;
    if (!user) return;
    if (balanceUSD <= 0) return;
    
    // 이미 포지션이 있으면 무시
    if (state.currentPosition) return;
    
    // 이미 대기 중인 시그널이 있으면 무시
    if (state.pendingSignal) return;
    
    // 쿨다운 체크
    if (state.cooldownUntil && Date.now() < state.cooldownUntil) return;
    if (Date.now() - lastEntryTimeRef.current < ENTRY_COOLDOWN_MS) return;
    
    try {
      // 변동성 급등 체크
      const volatilityCheck = await checkVolatilitySpike(symbol);
      if (volatilityCheck.isSpike) {
        addLog({
          symbol,
          action: 'cancel',
          side: touchType === 'upper' ? 'short' : 'long',
          price: currentPrice,
          quantity: 0,
          reason: `변동성 급등 (${volatilityCheck.ratio.toFixed(1)}x) - 진입 보류`,
        });
        toast.warning(`⚠️ ${symbol} 변동성 급등 (${volatilityCheck.ratio.toFixed(1)}x) - 진입 보류`);
        return;
      }
      
      // 현재 봉 정보 가져오기
      const klines = await fetch1mKlines(symbol, 2);
      if (!klines || klines.length < 2) return;
      
      const currentCandle = klines[klines.length - 1]; // 진행 중인 봉
      
      // 대기 상태로 저장
      const pendingSignal: PendingSignal = {
        symbol,
        touchType,
        signalTime: Date.now(),
        signalPrice: currentPrice,
        signalCandleOpen: currentCandle.open,
        signalCandleHigh: currentCandle.high,
        signalCandleLow: currentCandle.low,
      };
      
      setState(prev => ({ ...prev, pendingSignal, currentSymbol: symbol }));
      
      const side = touchType === 'upper' ? '숏' : '롱';
      addLog({
        symbol,
        action: 'pending',
        side: touchType === 'upper' ? 'short' : 'long',
        price: currentPrice,
        quantity: 0,
        reason: `BB ${touchType === 'upper' ? '상단' : '하단'} 터치 - 다음 봉 확인 대기`,
      });
      
      toast.info(`⏳ ${symbol} ${side} 시그널 - 봉 완성 대기 중`);
      
    } catch (error) {
      console.error('Signal handling error:', error);
    }
  }, [state.isEnabled, state.currentPosition, state.pendingSignal, state.cooldownUntil, user, balanceUSD, addLog]);
  
  // 실제 진입 실행
  const executeEntry = useCallback(async (
    symbol: string,
    side: 'long' | 'short',
    currentPrice: number,
    entryCandle: EntryCandleInfo
  ) => {
    if (processingRef.current) return;
    
    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));
    
    try {
      // 동적 TP 계산: 최근 20봉 평균 크기의 60%
      const klines = await fetch1mKlines(symbol, 20);
      let dynamicTpPercent = 0.3; // 기본값
      
      if (klines && klines.length >= 20) {
        const candleSizes = klines.map(k => ((k.high - k.low) / k.low) * 100);
        const avgCandleSize = candleSizes.reduce((a, b) => a + b, 0) / candleSizes.length;
        dynamicTpPercent = avgCandleSize * 0.6; // 평균 봉 크기의 60%
        
        // 최소 0.1%, 최대 2%로 제한
        dynamicTpPercent = Math.max(0.1, Math.min(2, dynamicTpPercent));
      }
      
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
      let orderResult;
      try {
        orderResult = await placeMarketOrder(symbol, orderSide, quantity, false, currentPrice);
      } catch (orderError: any) {
        // 주문 실패 시에도 실제 포지션 확인 (이미 체결됐을 수 있음)
        console.log('Order error, checking actual position...', orderError);
        const positions = await getPositions(symbol);
        const actualPosition = positions?.find((p: any) => 
          p.symbol === symbol && Math.abs(parseFloat(p.positionAmt)) > 0
        );
        
        if (actualPosition) {
          // 실제로 체결됨 - 포지션 저장
          const actualQty = Math.abs(parseFloat(actualPosition.positionAmt));
          const actualEntryPrice = parseFloat(actualPosition.entryPrice);
          
          lastEntryTimeRef.current = Date.now();
          setState(prev => ({
            ...prev,
            pendingSignal: null,
            currentPosition: {
              symbol,
              side,
              entryPrice: actualEntryPrice,
              quantity: actualQty,
              entryTime: Date.now(),
              entryCandle,
            },
            currentSymbol: symbol,
            tpPercent: dynamicTpPercent,
          }));
          
          addLog({
            symbol,
            action: 'entry',
            side,
            price: actualEntryPrice,
            quantity: actualQty,
            reason: `확인 진입 (TP ${dynamicTpPercent.toFixed(2)}%)`,
          });
          
          toast.success(`🤖 ${side === 'long' ? '롱' : '숏'} 진입 | ${symbol} @ $${actualEntryPrice.toFixed(2)}`);
          return;
        }
        
        throw orderError;
      }
      
      if (!orderResult || orderResult.error) {
        throw new Error(orderResult?.error || '주문 실패');
      }
      
      const executedQty = parseFloat(orderResult.executedQty || orderResult.origQty || quantity);
      const avgPrice = parseFloat(orderResult.avgPrice || orderResult.price || currentPrice);
      
      if (executedQty <= 0) {
        // 체결 수량 0이어도 실제 포지션 확인
        const positions = await getPositions(symbol);
        const actualPosition = positions?.find((p: any) => 
          p.symbol === symbol && Math.abs(parseFloat(p.positionAmt)) > 0
        );
        
        if (actualPosition) {
          const actualQty = Math.abs(parseFloat(actualPosition.positionAmt));
          const actualEntryPrice = parseFloat(actualPosition.entryPrice);
          
          lastEntryTimeRef.current = Date.now();
          setState(prev => ({
            ...prev,
            pendingSignal: null,
            currentPosition: {
              symbol,
              side,
              entryPrice: actualEntryPrice,
              quantity: actualQty,
              entryTime: Date.now(),
              entryCandle,
            },
            currentSymbol: symbol,
            tpPercent: dynamicTpPercent,
          }));
          
          addLog({
            symbol,
            action: 'entry',
            side,
            price: actualEntryPrice,
            quantity: actualQty,
            reason: `확인 진입 (TP ${dynamicTpPercent.toFixed(2)}%)`,
          });
          
          toast.success(`🤖 ${side === 'long' ? '롱' : '숏'} 진입 | ${symbol} @ $${actualEntryPrice.toFixed(2)}`);
          return;
        }
        
        throw new Error('주문 체결 수량 0');
      }
      
      lastEntryTimeRef.current = Date.now();
      
      // 포지션 저장 (진입 봉 정보 + 동적 TP 포함)
      setState(prev => ({
        ...prev,
        pendingSignal: null,
        currentPosition: {
          symbol,
          side,
          entryPrice: avgPrice > 0 ? avgPrice : currentPrice,
          quantity: executedQty,
          entryTime: Date.now(),
          entryCandle,
        },
        currentSymbol: symbol,
        tpPercent: dynamicTpPercent,
      }));
      
      addLog({
        symbol,
        action: 'entry',
        side,
        price: avgPrice > 0 ? avgPrice : currentPrice,
        quantity: executedQty,
        reason: `확인 진입 (TP ${dynamicTpPercent.toFixed(2)}%)`,
      });
      
      toast.success(`🤖 ${side === 'long' ? '롱' : '숏'} 진입 | ${symbol} @ $${(avgPrice > 0 ? avgPrice : currentPrice).toFixed(2)} (TP ${dynamicTpPercent.toFixed(2)}%)`);
      
    } catch (error: any) {
      console.error('Entry error:', error);
      lastEntryTimeRef.current = Date.now();
      setState(prev => ({ ...prev, pendingSignal: null }));
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
  }, [balanceUSD, leverage, placeMarketOrder, setLeverage, getPositions, addLog]);
  
  // 포지션 청산
  const closePosition = useCallback(async (reason: 'tp' | 'sl' | 'exit', currentPrice: number) => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;
    
    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));
    
    const position = state.currentPosition;
    
    try {
      // 실제 포지션 확인
      const positions = await getPositions(position.symbol);
      const actualPosition = positions?.find((p: any) => 
        p.symbol === position.symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );
      
      if (!actualPosition) {
        setState(prev => ({ ...prev, currentPosition: null, currentSymbol: null }));
        addLog({
          symbol: position.symbol,
          action: 'error',
          side: position.side,
          price: currentPrice,
          quantity: position.quantity,
          reason: '실제 포지션 없음',
        });
        return;
      }
      
      const actualQty = Math.abs(parseFloat(actualPosition.positionAmt));
      const actualEntryPrice = parseFloat(actualPosition.entryPrice);
      
      // 청산 주문
      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';
      const closeResult = await placeMarketOrder(position.symbol, orderSide, actualQty, true, currentPrice);
      
      if (!closeResult || closeResult.error) {
        throw new Error(closeResult?.error || '청산 실패');
      }
      
      // PnL 계산
      const direction = position.side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - actualEntryPrice) * direction;
      const pnl = priceDiff * actualQty;
      const isWin = pnl > 0;
      
      // 통계 업데이트
      setState(prev => {
        const newConsecutiveLosses = isWin ? 0 : prev.consecutiveLosses + 1;
        const newCooldownUntil = newConsecutiveLosses >= CONSECUTIVE_LOSS_LIMIT
          ? Date.now() + LOSS_COOLDOWN_MS
          : null;
        
        if (newCooldownUntil) {
          toast.warning(`⏸️ ${CONSECUTIVE_LOSS_LIMIT}연패로 30분 휴식`);
        }
        
        return {
          ...prev,
          currentPosition: null,
          currentSymbol: null,
          todayStats: {
            trades: prev.todayStats.trades + 1,
            wins: prev.todayStats.wins + (isWin ? 1 : 0),
            losses: prev.todayStats.losses + (isWin ? 0 : 1),
            totalPnL: prev.todayStats.totalPnL + pnl,
          },
          consecutiveLosses: newConsecutiveLosses,
          cooldownUntil: newCooldownUntil,
        };
      });
      
      addLog({
        symbol: position.symbol,
        action: reason === 'exit' ? 'exit' : reason,
        side: position.side,
        price: currentPrice,
        quantity: actualQty,
        pnl,
        reason: reason === 'tp' ? '익절' : reason === 'sl' ? '봉 기준 손절' : '청산',
      });
      
      const pnlKRW = Math.round(pnl * krwRate);
      toast[isWin ? 'success' : 'error'](
        `${isWin ? '✅' : '❌'} ${reason === 'tp' ? '익절' : reason === 'sl' ? '손절' : '청산'} | ${pnl >= 0 ? '+' : ''}₩${pnlKRW.toLocaleString()}`
      );
      
      // 청산 완료 콜백 (잔고 즉시 업데이트)
      onTradeComplete?.();
      
    } catch (error: any) {
      console.error('Close error:', error);
      addLog({
        symbol: position.symbol,
        action: 'error',
        side: position.side,
        price: currentPrice,
        quantity: position.quantity,
        reason: error.message || '청산 실패',
      });
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [state.currentPosition, placeMarketOrder, getPositions, krwRate, addLog, onTradeComplete]);
  
  // 봉 완성 체크 및 진입/손절 판단 (매 초 실행)
  const checkCandleCompletion = useCallback(async () => {
    if (!state.isEnabled) return;
    if (processingRef.current) return;
    
    const currentMinute = getMinuteTimestamp();
    
    // 분이 바뀌지 않았으면 스킵
    if (currentMinute === lastMinuteRef.current) return;
    
    lastMinuteRef.current = currentMinute;
    
    // 대기 중인 시그널이 있으면 확인 진입 체크
    if (state.pendingSignal && !state.currentPosition) {
      const { symbol, touchType } = state.pendingSignal;
      
      try {
        const klines = await fetch1mKlines(symbol, 3);
        if (!klines || klines.length < 2) return;
        
        // 직전 완성된 봉 (시그널 발생 후 완성된 봉)
        const completedCandle = klines[klines.length - 2];
        const isBullish = completedCandle.close > completedCandle.open; // 양봉
        const isBearish = completedCandle.close < completedCandle.open; // 음봉
        
        const expectedSide = touchType === 'upper' ? 'short' : 'long';
        
        // 상단 터치 → 음봉 확인 → 숏 진입
        // 하단 터치 → 양봉 확인 → 롱 진입
        if (touchType === 'upper' && isBearish) {
          // 숏 진입
          await executeEntry(symbol, 'short', completedCandle.close, completedCandle);
        } else if (touchType === 'lower' && isBullish) {
          // 롱 진입
          await executeEntry(symbol, 'long', completedCandle.close, completedCandle);
        } else {
          // 조건 불충족 - 시그널 취소
          setState(prev => ({ ...prev, pendingSignal: null }));
          addLog({
            symbol,
            action: 'cancel',
            side: expectedSide,
            price: completedCandle.close,
            quantity: 0,
            reason: `확인 실패 (${isBullish ? '양봉' : isBearish ? '음봉' : '도지'})`,
          });
          toast.info(`❌ ${symbol} 시그널 취소 - 봉 방향 불일치`);
        }
      } catch (error) {
        console.error('Candle check error:', error);
      }
    }
    
    // 포지션 보유 중이면 봉 기준 손절 체크
    if (state.currentPosition) {
      const { symbol, side, entryCandle } = state.currentPosition;
      
      try {
        const klines = await fetch1mKlines(symbol, 2);
        if (!klines || klines.length < 2) return;
        
        const completedCandle = klines[klines.length - 2];
        
        // 손절 조건 체크
        // 롱: 현재 봉 저가가 진입봉 저가보다 낮으면 손절
        // 숏: 현재 봉 고가가 진입봉 고가보다 높으면 손절
        if (side === 'long' && completedCandle.low < entryCandle.low) {
          await closePosition('sl', completedCandle.close);
        } else if (side === 'short' && completedCandle.high > entryCandle.high) {
          await closePosition('sl', completedCandle.close);
        }
      } catch (error) {
        console.error('Stop loss check error:', error);
      }
    }
  }, [state.isEnabled, state.pendingSignal, state.currentPosition, executeEntry, closePosition, addLog]);
  
  // 실시간 TP 체크 (봉 완성 기다리지 않고 퍼센트 기준)
  const checkTpSl = useCallback((currentPrice: number, tpPercent: number, _slPercent: number) => {
    if (!state.currentPosition || !state.isEnabled) return;
    
    const position = state.currentPosition;
    const direction = position.side === 'long' ? 1 : -1;
    const priceDiff = (currentPrice - position.entryPrice) * direction;
    const pnlPercent = (priceDiff / position.entryPrice) * 100;
    
    // 익절만 퍼센트 기준으로 체크 (손절은 봉 기준)
    if (pnlPercent >= tpPercent) {
      closePosition('tp', currentPrice);
    }
  }, [state.currentPosition, state.isEnabled, closePosition]);
  
  // 봉 완성 체크 interval
  useEffect(() => {
    if (!state.isEnabled) return;
    
    const interval = setInterval(checkCandleCompletion, 1000); // 매 초 체크
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
  
  return {
    state,
    toggleAutoTrading,
    handleSignal,
    closePosition,
    checkTpSl,
    updatePrice: useCallback(() => {}, []), // 더 이상 사용 안 함
  };
}
