import { useState, useEffect, useRef, useCallback } from 'react';
import { useBinanceApi } from './useBinanceApi';
import { useAuth } from './useAuth';
import { fetchSymbolPrecision, roundQuantity } from '@/lib/binance';
import { playEntrySound, playTpSound, playSlSound, initAudio } from '@/lib/sounds';
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
  waitCount: number; // 도지/망치 등 애매한 캔들 시 추가 대기 횟수
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
    referenceBodySize: number; // 기준 봉 몸통 크기 (손절 판단용)
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
  statusMessage: string; // 현재 상태 메시지
}

interface UseAutoTradingProps {
  balanceUSD: number;
  leverage: number;
  krwRate: number;
  onTradeComplete?: () => void; // 청산 완료 시 호출
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

export function useAutoTrading({ balanceUSD, leverage, krwRate, onTradeComplete, initialStats, logTrade }: UseAutoTradingProps) {
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
    todayStats: initialStats || { trades: 0, wins: 0, losses: 0, totalPnL: 0 },
    tradeLogs: [],
    consecutiveLosses: 0,
    cooldownUntil: null,
    tpPercent: 0.3, // 기본값, 진입 시 동적으로 업데이트됨
    statusMessage: '자동매매 비활성화',
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
  
  // 쿨다운 설정
  const ENTRY_COOLDOWN_MS = 60000; // 1분
  const DAILY_LIMIT_PERCENT = 10; // 원금 대비 ±10% 도달 시 자동 OFF
  
  // 자동매매 토글
  const toggleAutoTrading = useCallback(() => {
    setState(prev => {
      const newEnabled = !prev.isEnabled;
      if (newEnabled) {
        // 자동매매 ON 시 오디오 초기화 (사용자 상호작용)
        initAudio();
        toast.success('🤖 자동매매 시작 (확인 진입 모드)');
      } else {
        toast.info('자동매매 중지');
      }
      return { 
        ...prev, 
        isEnabled: newEnabled, 
        pendingSignal: null,
        statusMessage: newEnabled ? '🔍 BB 시그널 종목 검색 중...' : '자동매매 비활성화',
      };
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
        waitCount: 0, // 첫 대기
      };
      
      setState(prev => ({ ...prev, pendingSignal, currentSymbol: symbol, statusMessage: `✨ ${symbol.replace('USDT', '')} 발견! 봉 완성 대기 중...` }));
      
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
    entryCandle: EntryCandleInfo,
    referenceBodySize?: number // 기준 봉 몸통 크기 (없으면 계산)
  ) => {
    if (processingRef.current) return;
    
    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));
    
    try {
      // 동적 TP 계산: 최근 20봉 평균 크기의 60%
      const klines = await fetch1mKlines(symbol, 21);
      let dynamicTpPercent = 0.3; // 기본값
      let refBodySize = referenceBodySize || 0;
      
      if (klines && klines.length >= 20) {
        const candleSizes = klines.map(k => ((k.high - k.low) / k.low) * 100);
        const avgCandleSize = candleSizes.reduce((a, b) => a + b, 0) / candleSizes.length;
        dynamicTpPercent = avgCandleSize * 0.6; // 평균 봉 크기의 60%
        
        // 최소 0.1%, 최대 2%로 제한
        dynamicTpPercent = Math.max(0.1, Math.min(2, dynamicTpPercent));
        
        // 기준 봉 크기가 없으면 직전 봉에서 계산
        if (!refBodySize && klines.length >= 2) {
          const prevCandle = klines[klines.length - 2];
          refBodySize = Math.abs(prevCandle.close - prevCandle.open);
        }
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
              referenceBodySize: refBodySize,
            },
            currentSymbol: symbol,
            tpPercent: dynamicTpPercent,
            statusMessage: `🎯 ${symbol.replace('USDT', '')} ${side === 'long' ? '롱' : '숏'} 포지션 보유 중`,
          }));
          
          addLog({
            symbol,
            action: 'entry',
            side,
            price: actualEntryPrice,
            quantity: actualQty,
            reason: `확인 진입 (TP ${dynamicTpPercent.toFixed(2)}%)`,
          });
          
          // 귀여운 진입 알림
          playEntrySound();
          const cuteEmojis = ['🚀', '💫', '✨', '🎯', '💰', '🔥', '⚡'];
          const randomEmoji = cuteEmojis[Math.floor(Math.random() * cuteEmojis.length)];
          toast.success(`${randomEmoji} ${side === 'long' ? '롱롱이' : '숏숏이'} 출격! ${symbol.replace('USDT', '')} @ $${actualEntryPrice.toFixed(2)}`);
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
              referenceBodySize: refBodySize,
            },
            currentSymbol: symbol,
            tpPercent: dynamicTpPercent,
            statusMessage: `🎯 ${symbol.replace('USDT', '')} ${side === 'long' ? '롱' : '숏'} 포지션 보유 중`,
          }));
          
          addLog({
            symbol,
            action: 'entry',
            side,
            price: actualEntryPrice,
            quantity: actualQty,
            reason: `확인 진입 (TP ${dynamicTpPercent.toFixed(2)}%)`,
          });
          
          // 귀여운 진입 알림
          playEntrySound();
          const cuteEmojis2 = ['🚀', '💫', '✨', '🎯', '💰', '🔥', '⚡'];
          const randomEmoji2 = cuteEmojis2[Math.floor(Math.random() * cuteEmojis2.length)];
          toast.success(`${randomEmoji2} ${side === 'long' ? '롱롱이' : '숏숏이'} 출격! ${symbol.replace('USDT', '')} @ $${actualEntryPrice.toFixed(2)}`);
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
          referenceBodySize: refBodySize,
        },
        currentSymbol: symbol,
        tpPercent: dynamicTpPercent,
        statusMessage: `🎯 ${symbol.replace('USDT', '')} ${side === 'long' ? '롱' : '숏'} 포지션 보유 중`,
      }));
      
      addLog({
        symbol,
        action: 'entry',
        side,
        price: avgPrice > 0 ? avgPrice : currentPrice,
        quantity: executedQty,
        reason: `확인 진입 (TP ${dynamicTpPercent.toFixed(2)}%)`,
      });
      
      // 귀여운 진입 알림
      playEntrySound();
      const cuteEmojis3 = ['🚀', '💫', '✨', '🎯', '💰', '🔥', '⚡'];
      const randomEmoji3 = cuteEmojis3[Math.floor(Math.random() * cuteEmojis3.length)];
      toast.success(`${randomEmoji3} ${side === 'long' ? '롱롱이' : '숏숏이'} 출격! ${symbol.replace('USDT', '')} @ $${(avgPrice > 0 ? avgPrice : currentPrice).toFixed(2)}`);
      
    } catch (error: any) {
      console.error('Entry error:', error);
      lastEntryTimeRef.current = Date.now();
      setState(prev => ({ ...prev, pendingSignal: null, statusMessage: '🔍 BB 시그널 종목 검색 중...' }));
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
        setState(prev => ({ ...prev, currentPosition: null, currentSymbol: null, statusMessage: '🔍 BB 시그널 종목 검색 중...' }));
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
      const newTotalPnL = state.todayStats.totalPnL + pnl;
      
      // 원금 대비 ±10% 체크
      const pnlPercent = balanceUSD > 0 ? (newTotalPnL / balanceUSD) * 100 : 0;
      const shouldStopTrading = Math.abs(pnlPercent) >= DAILY_LIMIT_PERCENT;
      
      if (shouldStopTrading) {
        const isProfit = pnlPercent > 0;
        toast.info(`🛑 원금 대비 ${isProfit ? '+' : ''}${pnlPercent.toFixed(1)}% 도달 - 자동매매 종료`);
      }
      
      setState(prev => ({
        ...prev,
        isEnabled: shouldStopTrading ? false : prev.isEnabled,
        currentPosition: null,
        currentSymbol: null,
        todayStats: {
          trades: prev.todayStats.trades + 1,
          wins: prev.todayStats.wins + (isWin ? 1 : 0),
          losses: prev.todayStats.losses + (isWin ? 0 : 1),
          totalPnL: newTotalPnL,
        },
        statusMessage: shouldStopTrading 
          ? '🛑 일일 한도 도달 - 자동매매 종료'
          : `${isWin ? '✅ 익절 완료!' : '❌ 손절 완료'} 다음 시그널 대기...`,
      }));
      
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
      
      // 효과음 재생
      if (isWin) {
        playTpSound();
      } else {
        playSlSound();
      }
      
      toast[isWin ? 'success' : 'error'](
        `${isWin ? '✅' : '❌'} ${reason === 'tp' ? '익절' : reason === 'sl' ? '손절' : '청산'} | ${pnl >= 0 ? '+' : ''}₩${pnlKRW.toLocaleString()}`
      );
      
      // DB에 거래 기록 저장
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
  }, [state.currentPosition, placeMarketOrder, getPositions, krwRate, leverage, addLog, onTradeComplete, logTrade]);
  
  // 봉 완성 체크 및 진입/손절 판단 (매 초 실행)
  const checkCandleCompletion = useCallback(async () => {
    if (!state.isEnabled) return;
    if (processingRef.current) return;
    
    const currentMinute = getMinuteTimestamp();
    
    // 분이 바뀌지 않았으면 스킵
    if (currentMinute === lastMinuteRef.current) return;
    
    lastMinuteRef.current = currentMinute;
    
    // 봉 완성 후 2초 대기 (Binance API 데이터 확정 대기)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 대기 중인 시그널이 있으면 확인 진입 체크
    if (state.pendingSignal && !state.currentPosition) {
      const { symbol, touchType, waitCount } = state.pendingSignal;
      const MAX_WAIT_COUNT = 2; // 최대 2번 추가 대기 (도지/망치 시)
      
      try {
        // 20봉 평균을 위해 22개 fetch
        const klines = await fetch1mKlines(symbol, 22);
        if (!klines || klines.length < 21) return;
        
        // 직전 완성된 봉 (시그널 발생 후 완성된 봉)
        const completedCandle = klines[klines.length - 2];
        
        // 디버깅: 실제 캔들 데이터 로그
        const candleType = completedCandle.close > completedCandle.open ? '양봉' : completedCandle.close < completedCandle.open ? '음봉' : '도지';
        console.log(`[${symbol}] 확인 봉: O=${completedCandle.open.toFixed(4)} C=${completedCandle.close.toFixed(4)} (${candleType}) [대기 ${waitCount + 1}회차]`);
        
        // 최근 20봉의 평균 몸통 크기를 기준으로 사용 (안정적인 기준)
        const recentCandles = klines.slice(-22, -2); // 완성된 봉 제외, 그 이전 20봉
        const avgBodySize = recentCandles.reduce((sum, k) => sum + Math.abs(k.close - k.open), 0) / recentCandles.length;
        
        // 최소 기준값 설정 (가격의 0.05% 이상)
        const minThreshold = completedCandle.close * 0.0005;
        const referenceBodySize = Math.max(avgBodySize, minThreshold);
        const threshold = referenceBodySize * 0.2;
        
        // 완성된 봉의 몸통 크기
        const bodyMove = completedCandle.close - completedCandle.open;
        const bodySize = Math.abs(bodyMove);
        const bodyMovePct = (bodySize / (completedCandle.open || completedCandle.close || 1)) * 100;

        // 도지/망치 판단:
        // 1) 20% 임계값 미만이거나
        // 2) 절대 몸통 퍼센트가 너무 작으면(저변동 코인에서 '살짝 양봉' 오판 방지)
        const MIN_CONFIRM_BODY_PCT = 0.3; // 0.3% 미만은 방향성 애매로 간주
        const isAmbiguousCandle = bodySize < threshold || bodyMovePct < MIN_CONFIRM_BODY_PCT;

        // 임계값 이상 + 최소 퍼센트도 만족해야 유효한 양봉/음봉으로 판단
        const isBullish = !isAmbiguousCandle && bodyMove >= threshold;
        const isBearish = !isAmbiguousCandle && bodyMove <= -threshold;
        
        const expectedSide = touchType === 'upper' ? 'short' : 'long';
        
        // 상단 터치 → 음봉 확인 → 숏 진입
        // 하단 터치 → 양봉 확인 → 롱 진입
        if (touchType === 'upper' && isBearish) {
          // 숏 진입 (기준 봉 크기 전달)
          await executeEntry(symbol, 'short', completedCandle.close, completedCandle, referenceBodySize);
        } else if (touchType === 'lower' && isBullish) {
          // 롱 진입 (기준 봉 크기 전달)
          await executeEntry(symbol, 'long', completedCandle.close, completedCandle, referenceBodySize);
        } else if (isAmbiguousCandle && waitCount < MAX_WAIT_COUNT) {
          // 도지/망치 등 애매한 캔들 → 추가 대기
          setState(prev => ({
            ...prev,
            pendingSignal: prev.pendingSignal ? { ...prev.pendingSignal, waitCount: waitCount + 1 } : null,
            statusMessage: `⏳ ${symbol.replace('USDT', '')} 도지/망치 감지 - ${waitCount + 2}번째 봉 대기 중...`,
          }));
          
          addLog({
            symbol,
            action: 'pending',
            side: expectedSide,
            price: completedCandle.close,
            quantity: 0,
            reason: `도지/망치 감지 - 추가 대기 (${waitCount + 1}/${MAX_WAIT_COUNT})`,
          });
          toast.info(`⏳ ${symbol} 도지/망치 → ${waitCount + 2}번째 봉 대기`);
        } else {
          // 조건 불충족 또는 최대 대기 초과 - 시그널 취소
          setState(prev => ({ ...prev, pendingSignal: null, statusMessage: '🔍 BB 시그널 종목 검색 중...' }));
          
          // 직관적인 취소 사유 생성
          const actualCandle = isAmbiguousCandle ? '➖도지/망치' : (bodyMove > 0 ? '🟢양봉' : '🔴음봉');
          const expectedCandle = touchType === 'upper' ? '🔴음봉' : '🟢양봉';
          const cancelReason = waitCount >= MAX_WAIT_COUNT 
            ? `${MAX_WAIT_COUNT}회 대기 후에도 방향 불명확`
            : `${actualCandle} 출현 (기대: ${expectedCandle})`;
          
          addLog({
            symbol,
            action: 'cancel',
            side: expectedSide,
            price: completedCandle.close,
            quantity: 0,
            reason: cancelReason,
          });
          toast.info(`❌ ${symbol} 취소 - ${cancelReason}`);
        }
      } catch (error) {
        console.error('Candle check error:', error);
      }
    }
    
    // 포지션 보유 중이면 봉 기준 손절 체크
    if (state.currentPosition) {
      const { symbol, side, entryCandle, entryTime } = state.currentPosition;
      
      // 진입 후 최소 1분(1봉) 지나야 봉 기준 손절 적용 (즉시 손절 방지)
      const MIN_HOLD_TIME_MS = 60000;
      if (Date.now() - entryTime < MIN_HOLD_TIME_MS) return;
      
      try {
        const klines = await fetch1mKlines(symbol, 2);
        if (!klines || klines.length < 2) return;
        
        const completedCandle = klines[klines.length - 2];
        
        // 손절 여유분: 진입봉 고가/저가의 0.2% 허용
        const SL_TOLERANCE_PCT = 0.002; // 0.2%
        const highTolerance = entryCandle.high * (1 + SL_TOLERANCE_PCT);
        const lowTolerance = entryCandle.low * (1 - SL_TOLERANCE_PCT);
        
        // 손절 조건 체크 (여유분 포함)
        // 롱: 현재 봉 저가가 진입봉 저가보다 0.2% 이상 낮으면 손절
        // 숏: 현재 봉 고가가 진입봉 고가보다 0.2% 이상 높으면 손절
        if (side === 'long' && completedCandle.low < lowTolerance) {
          console.log(`[${symbol}] 봉 기준 SL: 저가 ${completedCandle.low.toFixed(4)} < 기준 ${lowTolerance.toFixed(4)}`);
          await closePosition('sl', completedCandle.close);
        } else if (side === 'short' && completedCandle.high > highTolerance) {
          console.log(`[${symbol}] 봉 기준 SL: 고가 ${completedCandle.high.toFixed(4)} > 기준 ${highTolerance.toFixed(4)}`);
          await closePosition('sl', completedCandle.close);
        }
      } catch (error) {
        console.error('Stop loss check error:', error);
      }
    }
  }, [state.isEnabled, state.pendingSignal, state.currentPosition, executeEntry, closePosition, addLog]);
  
  // 실시간 TP 체크 (손절은 봉 기준으로만 판단)
  const checkTpSl = useCallback((currentPrice: number, tpPercent: number, _slPercent: number) => {
    if (!state.currentPosition || !state.isEnabled) return;
    
    const position = state.currentPosition;
    const direction = position.side === 'long' ? 1 : -1;
    const priceDiff = (currentPrice - position.entryPrice) * direction;
    const pnlPercent = (priceDiff / position.entryPrice) * 100;
    
    // 익절: 퍼센트 기준 (실시간)
    if (pnlPercent >= tpPercent) {
      closePosition('tp', currentPrice);
      return;
    }
    
    // 손절은 봉 기준으로만 판단 (checkCandleCompletion에서 처리)
    // 실시간 손절 제거 - 너무 민감해서 즉시 손절되는 문제 해결
  }, [state.currentPosition, state.isEnabled, closePosition]);
  
  // 기존 포지션 동기화 (로드 시 및 주기적)
  const positionSyncRef = useRef(false);
  
  useEffect(() => {
    if (!user) return;
    
    let isMounted = true;
    
    const syncPositions = async () => {
      // 이미 동기화 중이거나 로컬 포지션이 있으면 스킵
      if (positionSyncRef.current) return;
      if (processingRef.current) return;
      
      positionSyncRef.current = true;
      
      try {
        const positions = await getPositions();
        if (!isMounted) return;
        if (!positions || !Array.isArray(positions)) return;
        
        const activePosition = positions.find((p: any) => 
          Math.abs(parseFloat(p.positionAmt)) > 0
        );
        
        if (activePosition) {
          const posAmt = parseFloat(activePosition.positionAmt);
          const side: 'long' | 'short' = posAmt > 0 ? 'long' : 'short';
          const entryPrice = parseFloat(activePosition.entryPrice);
          
          setState(prev => {
            // 이미 동기화되어 있으면 스킵
            if (prev.currentPosition?.symbol === activePosition.symbol) return prev;
            
            console.log('[AutoTrading] Synced existing position:', activePosition.symbol);
            
            return {
              ...prev,
              currentPosition: {
                symbol: activePosition.symbol,
                side,
                entryPrice,
                quantity: Math.abs(posAmt),
                entryTime: Date.now(),
                entryCandle: { open: entryPrice, high: entryPrice, low: entryPrice, close: entryPrice },
                referenceBodySize: 0, // 동기화된 포지션은 기준값 없음
              },
              currentSymbol: activePosition.symbol,
            };
          });
        }
      } catch (error) {
        console.error('Position sync error:', error);
      } finally {
        positionSyncRef.current = false;
      }
    };
    
    // 최초 동기화
    syncPositions();
    
    // 10초마다 동기화 체크
    const interval = setInterval(syncPositions, 10000);
    
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [user, getPositions]);
  
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
