import { useState, useEffect, useRef, useCallback } from 'react';
import { useBinanceApi } from './useBinanceApi';
import { useAuth } from './useAuth';
import { fetchSymbolPrecision, roundQuantity } from '@/lib/binance';
import { toast } from 'sonner';

export interface AutoTradeLog {
  id: string;
  timestamp: number;
  symbol: string;
  action: 'entry' | 'exit' | 'tp' | 'sl' | 'error';
  side: 'long' | 'short';
  price: number;
  quantity: number;
  pnl?: number;
  reason: string;
}

export interface AutoTradingState {
  isEnabled: boolean;
  isProcessing: boolean;
  currentSymbol: string | null;
  currentPosition: {
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    quantity: number;
    entryTime: number;
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
}

interface UseAutoTradingProps {
  balanceUSD: number;
  leverage: number;
  krwRate: number;
}

// 1분봉 평균 크기 계산을 위한 klines 가져오기
async function fetch1mKlines(symbol: string, limit: number = 20) {
  try {
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=${limit}`
    );
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data.map((k: any[]) => ({
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));
  } catch {
    return null;
  }
}

// 동적 TP/SL 계산 (1분봉 평균 크기 기반)
function calculateDynamicTpSl(klines: { high: number; low: number; close: number }[]) {
  if (!klines || klines.length < 10) {
    return { tpPercent: 0.3, slPercent: 0.5 }; // 기본값
  }
  
  // 최근 20봉의 평균 변동폭 (%)
  const avgRangePercent = klines.reduce((sum, k) => {
    const range = ((k.high - k.low) / k.low) * 100;
    return sum + range;
  }, 0) / klines.length;
  
  // 익절: 평균 봉 크기의 60%
  // 손절: 평균 봉 크기의 120%
  return {
    tpPercent: avgRangePercent * 0.6,
    slPercent: avgRangePercent * 1.2,
  };
}

export function useAutoTrading({ balanceUSD, leverage, krwRate }: UseAutoTradingProps) {
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
    currentPosition: null,
    todayStats: { trades: 0, wins: 0, losses: 0, totalPnL: 0 },
    tradeLogs: [],
    consecutiveLosses: 0,
    cooldownUntil: null,
  });
  
  // Refs for real-time data
  const currentPriceRef = useRef<Map<string, number>>(new Map());
  const processingRef = useRef(false);
  const lastEntryTimeRef = useRef(0);
  
  // 진입 쿨다운 (같은 종목 재진입 방지)
  const ENTRY_COOLDOWN_MS = 60000; // 1분
  // 연속 손실 시 쿨다운
  const CONSECUTIVE_LOSS_LIMIT = 3;
  const LOSS_COOLDOWN_MS = 30 * 60 * 1000; // 30분
  
  // 가격 업데이트 (외부에서 호출)
  const updatePrice = useCallback((symbol: string, price: number) => {
    currentPriceRef.current.set(symbol, price);
  }, []);
  
  // 자동매매 토글
  const toggleAutoTrading = useCallback(() => {
    setState(prev => {
      const newEnabled = !prev.isEnabled;
      if (newEnabled) {
        toast.success('🤖 자동매매 시작');
      } else {
        toast.info('자동매매 중지');
      }
      return { ...prev, isEnabled: newEnabled };
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
      tradeLogs: [newLog, ...prev.tradeLogs].slice(0, 50), // 최근 50개만 유지
    }));
    return newLog;
  }, []);
  
  // BB 시그널로 자동 진입
  const handleSignal = useCallback(async (
    symbol: string, 
    touchType: 'upper' | 'lower',
    currentPrice: number
  ) => {
    // 조건 체크
    if (!state.isEnabled) return;
    if (processingRef.current) return;
    if (!user) return;
    if (balanceUSD <= 0) return;
    
    // 이미 포지션이 있으면 무시
    if (state.currentPosition) return;
    
    // 쿨다운 체크
    if (state.cooldownUntil && Date.now() < state.cooldownUntil) {
      return;
    }
    
    // 진입 쿨다운 체크
    if (Date.now() - lastEntryTimeRef.current < ENTRY_COOLDOWN_MS) {
      return;
    }
    
    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));
    
    try {
      // 1분봉 데이터로 동적 TP/SL 계산
      const klines = await fetch1mKlines(symbol);
      const { tpPercent, slPercent } = calculateDynamicTpSl(klines || []);
      
      // 주문 수량 계산 (잔고의 90% 사용)
      const safeBalance = balanceUSD * 0.9;
      const buyingPower = safeBalance * leverage;
      const rawQty = buyingPower / currentPrice;
      
      // 심볼 정밀도 가져오기
      const precision = await fetchSymbolPrecision(symbol);
      const quantity = roundQuantity(rawQty, precision);
      
      // 최소 주문금액 체크
      if (quantity * currentPrice < 5.5) {
        addLog({
          symbol,
          action: 'error',
          side: touchType === 'upper' ? 'short' : 'long',
          price: currentPrice,
          quantity: 0,
          reason: '최소 주문금액 미달',
        });
        return;
      }
      
      // 진입 방향 결정
      // 상단밴드 터치 → 숏 (가격이 내려갈 것으로 예상)
      // 하단밴드 터치 → 롱 (가격이 올라갈 것으로 예상)
      const side: 'long' | 'short' = touchType === 'upper' ? 'short' : 'long';
      const orderSide = side === 'long' ? 'BUY' : 'SELL';
      
      // 레버리지 설정 (주문 전 필수)
      try {
        await setLeverage(symbol, leverage);
      } catch (levError: any) {
        // -4028: 레버리지 설정 불가 (포지션 존재 등)
        // -4046: 이미 설정된 레버리지와 동일
        if (!levError.message?.includes('-4046') && !levError.message?.includes('already')) {
          console.warn('레버리지 설정 실패:', levError.message);
        }
      }
      
      // 시장가 주문 실행
      const orderResult = await placeMarketOrder(symbol, orderSide, quantity, false, currentPrice);
      
      // 주문 결과 검증
      if (!orderResult || orderResult.error) {
        throw new Error(orderResult?.error || '주문 실패');
      }
      
      // 실제 포지션 확인
      await new Promise(resolve => setTimeout(resolve, 500)); // 바이낸스 반영 대기
      const positions = await getPositions(symbol);
      const actualPosition = positions?.find((p: any) => 
        p.symbol === symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );
      
      if (!actualPosition) {
        throw new Error('포지션 생성 확인 실패');
      }
      
      const actualQty = Math.abs(parseFloat(actualPosition.positionAmt));
      const actualEntryPrice = parseFloat(actualPosition.entryPrice);
      
      lastEntryTimeRef.current = Date.now();
      
      // 실제 포지션 정보로 저장
      setState(prev => ({
        ...prev,
        currentPosition: {
          symbol,
          side,
          entryPrice: actualEntryPrice,
          quantity: actualQty,
          entryTime: Date.now(),
        },
        currentSymbol: symbol,
      }));
      
      addLog({
        symbol,
        action: 'entry',
        side,
        price: actualEntryPrice,
        quantity: actualQty,
        reason: `BB ${touchType === 'upper' ? '상단' : '하단'} 터치 (TP: ${tpPercent.toFixed(2)}%, SL: ${slPercent.toFixed(2)}%)`,
      });
      
      toast.success(`🤖 ${side === 'long' ? '롱' : '숏'} 진입 | ${symbol} @ $${actualEntryPrice.toFixed(2)}`);
      
      // TP/SL 저장 (state에)
      setState(prev => ({
        ...prev,
        tpPercent,
        slPercent,
      } as any));
      
    } catch (error: any) {
      console.error('Auto trade entry error:', error);
      addLog({
        symbol,
        action: 'error',
        side: touchType === 'upper' ? 'short' : 'long',
        price: currentPrice,
        quantity: 0,
        reason: error.message || '진입 실패',
      });
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [state.isEnabled, state.currentPosition, state.cooldownUntil, user, balanceUSD, leverage, placeMarketOrder, addLog]);
  
  // 포지션 청산 (TP/SL 또는 수동)
  const closePosition = useCallback(async (reason: 'tp' | 'sl' | 'exit', currentPrice: number) => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;
    
    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));
    
    const position = state.currentPosition;
    
    try {
      // 청산 주문
      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';
      await placeMarketOrder(position.symbol, orderSide, position.quantity, true, currentPrice);
      
      // PnL 계산
      const direction = position.side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - position.entryPrice) * direction;
      const pnl = priceDiff * position.quantity;
      
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
        quantity: position.quantity,
        pnl,
        reason: reason === 'tp' ? '익절' : reason === 'sl' ? '손절' : '청산',
      });
      
      const pnlKRW = Math.round(pnl * krwRate);
      toast[isWin ? 'success' : 'error'](
        `${isWin ? '✅' : '❌'} ${reason === 'tp' ? '익절' : reason === 'sl' ? '손절' : '청산'} | ${pnl >= 0 ? '+' : ''}₩${pnlKRW.toLocaleString()}`
      );
      
    } catch (error: any) {
      console.error('Auto trade close error:', error);
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
  }, [state.currentPosition, placeMarketOrder, krwRate, addLog]);
  
  // 실시간 TP/SL 체크
  const checkTpSl = useCallback((currentPrice: number, tpPercent: number, slPercent: number) => {
    if (!state.currentPosition || !state.isEnabled) return;
    
    const position = state.currentPosition;
    const direction = position.side === 'long' ? 1 : -1;
    const priceDiff = (currentPrice - position.entryPrice) * direction;
    const pnlPercent = (priceDiff / position.entryPrice) * 100;
    
    if (pnlPercent >= tpPercent) {
      closePosition('tp', currentPrice);
    } else if (pnlPercent <= -slPercent) {
      closePosition('sl', currentPrice);
    }
  }, [state.currentPosition, state.isEnabled, closePosition]);
  
  // 오늘 통계 리셋 (자정에)
  useEffect(() => {
    const checkDayChange = () => {
      const now = new Date();
      const koreaTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const hours = koreaTime.getUTCHours();
      const minutes = koreaTime.getUTCMinutes();
      
      // 자정이면 리셋
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
    updatePrice,
  };
}
