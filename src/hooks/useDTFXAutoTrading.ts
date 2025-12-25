/**
 * DTFX 자동매매 훅
 * - 1분, 3분, 5분봉에서 DTFX 신호 감지
 * - 롱/숏 진입 시 시드 95% 시장가 진입
 * - 청산 신호 시 즉시 시장가 청산
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useBinanceApi } from './useBinanceApi';
import { analyzeDTFX, checkDTFXEntrySignal, Candle } from './useDTFX';
import { fetchSymbolPrecision, roundQuantity } from '@/lib/binance';
import { toast } from 'sonner';

interface DTFXAutoTradingState {
  isEnabled: boolean;
  isProcessing: boolean;
  currentPosition: {
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    quantity: number;
    timestamp: number;
  } | null;
  lastSignal: {
    direction: 'long' | 'short';
    timeframe: string;
    price: number;
    timestamp: number;
  } | null;
  logs: string[];
}

interface CandleData {
  timeframe: '1m' | '3m' | '5m';
  candles: Candle[];
  lastUpdate: number;
}

interface UseDTFXAutoTradingProps {
  symbol: string;
  balanceUSD: number;
  leverage: number;
  enabled: boolean;
}

export const useDTFXAutoTrading = ({
  symbol,
  balanceUSD,
  leverage,
  enabled,
}: UseDTFXAutoTradingProps) => {
  const [state, setState] = useState<DTFXAutoTradingState>({
    isEnabled: false,
    isProcessing: false,
    currentPosition: null,
    lastSignal: null,
    logs: [],
  });

  const candleDataRef = useRef<Map<string, CandleData>>(new Map());
  const lastEntryTimeRef = useRef<number>(0);
  const lastExitTimeRef = useRef<number>(0);
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const { placeMarketOrder, getPositions, setLeverage } = useBinanceApi();

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString('ko-KR');
    setState(prev => ({
      ...prev,
      logs: [`[${timestamp}] ${message}`, ...prev.logs.slice(0, 49)],
    }));
    console.log(`🎯 [DTFX] ${message}`);
  }, []);

  // Binance에서 캔들 데이터 가져오기
  const fetchCandles = useCallback(async (
    sym: string, 
    interval: '1m' | '3m' | '5m', 
    limit: number = 100
  ): Promise<Candle[]> => {
    try {
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`
      );
      const data = await response.json();
      
      return data.map((k: any[]) => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
    } catch (error) {
      console.error(`캔들 데이터 가져오기 실패: ${sym} ${interval}`, error);
      return [];
    }
  }, []);

  // DTFX 분석 및 신호 감지
  const analyzeAllTimeframes = useCallback(async () => {
    if (!enabled || state.isProcessing) return;

    const timeframes: ('1m' | '3m' | '5m')[] = ['1m', '3m', '5m'];
    const results: { timeframe: string; direction: 'long' | 'short' | null; price: number }[] = [];

    for (const tf of timeframes) {
      const candles = await fetchCandles(symbol, tf, 100);
      if (candles.length < 30) continue;

      candleDataRef.current.set(`${symbol}_${tf}`, {
        timeframe: tf,
        candles,
        lastUpdate: Date.now(),
      });

      const analysis = analyzeDTFX(candles, 5);
      const currentPrice = candles[candles.length - 1].close;
      const signal = checkDTFXEntrySignal(currentPrice, analysis.zones);

      results.push({
        timeframe: tf,
        direction: signal.direction,
        price: currentPrice,
      });
    }

    // 진입 신호 체크 (1분, 3분, 5분 중 하나라도 신호가 있으면)
    const entrySignals = results.filter(r => r.direction !== null);
    
    if (entrySignals.length > 0 && !state.currentPosition) {
      const now = Date.now();
      // 5초 이내 중복 진입 방지
      if (now - lastEntryTimeRef.current < 5000) return;

      const signal = entrySignals[0];
      setState(prev => ({
        ...prev,
        lastSignal: {
          direction: signal.direction!,
          timeframe: signal.timeframe,
          price: signal.price,
          timestamp: now,
        },
      }));

      addLog(`🎯 ${signal.timeframe}봉 ${signal.direction === 'long' ? '롱' : '숏'} 진입 신호 감지 @ ${signal.price.toFixed(4)}`);
      
      // 즉시 시장가 진입
      await executeEntry(signal.direction!, signal.price);
    }

    // 청산은 수동으로 처리 (자동 청산 로직 제거됨)
  }, [enabled, symbol, state.currentPosition, state.isProcessing, fetchCandles, addLog]);

  // 시장가 진입 실행
  const executeEntry = useCallback(async (direction: 'long' | 'short', price: number) => {
    if (state.isProcessing) return;

    setState(prev => ({ ...prev, isProcessing: true }));
    lastEntryTimeRef.current = Date.now();

    try {
      // 레버리지 설정
      await setLeverage(symbol, leverage);
      
      // 시드 95%로 수량 계산
      const positionValue = balanceUSD * 0.95 * leverage;
      const precision = await fetchSymbolPrecision(symbol);
      const quantity = roundQuantity(positionValue / price, precision);

      addLog(`⚡ ${direction === 'long' ? '롱' : '숏'} 진입 시도: ${quantity} ${symbol.replace('USDT', '')} @ ${price.toFixed(4)}`);

      const side = direction === 'long' ? 'BUY' : 'SELL';
      const result = await placeMarketOrder(symbol, side, quantity, false, price);

      if (result && !result.error) {
        setState(prev => ({
          ...prev,
          currentPosition: {
            symbol,
            side: direction,
            entryPrice: price,
            quantity,
            timestamp: Date.now(),
          },
          isProcessing: false,
        }));

        toast.success(`DTFX ${direction === 'long' ? '롱' : '숏'} 진입 완료!`);
        addLog(`✅ 진입 성공! ${direction === 'long' ? '롱' : '숏'} ${quantity} @ ${price.toFixed(4)}`);
      } else {
        throw new Error(result?.error || '주문 실패');
      }
    } catch (error: any) {
      addLog(`❌ 진입 실패: ${error.message}`);
      toast.error(`DTFX 진입 실패: ${error.message}`);
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [symbol, balanceUSD, leverage, placeMarketOrder, setLeverage, addLog, state.isProcessing]);

  // 시장가 청산 실행
  const executeExit = useCallback(async (currentPrice: number) => {
    if (!state.currentPosition || state.isProcessing) return;

    setState(prev => ({ ...prev, isProcessing: true }));
    lastExitTimeRef.current = Date.now();

    try {
      const { side, quantity } = state.currentPosition;
      const closeSide = side === 'long' ? 'SELL' : 'BUY';

      addLog(`⚡ 청산 시도: ${quantity} ${symbol.replace('USDT', '')} @ ${currentPrice.toFixed(4)}`);

      const result = await placeMarketOrder(symbol, closeSide, quantity, true, currentPrice);

      if (result && !result.error) {
        const pnl = side === 'long' 
          ? (currentPrice - state.currentPosition.entryPrice) * quantity
          : (state.currentPosition.entryPrice - currentPrice) * quantity;

        toast.success(`DTFX 청산 완료! PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);
        addLog(`✅ 청산 성공! PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`);

        setState(prev => ({
          ...prev,
          currentPosition: null,
          isProcessing: false,
        }));
      } else {
        throw new Error(result?.error || '청산 실패');
      }
    } catch (error: any) {
      addLog(`❌ 청산 실패: ${error.message}`);
      toast.error(`DTFX 청산 실패: ${error.message}`);
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [state.currentPosition, state.isProcessing, symbol, placeMarketOrder, addLog]);

  // DTFX 자동매매 토글
  const toggleDTFXAutoTrading = useCallback(() => {
    setState(prev => {
      const newEnabled = !prev.isEnabled;
      if (newEnabled) {
        toast.success('DTFX 자동매매 활성화');
        addLog('🚀 DTFX 자동매매 시작');
      } else {
        toast.info('DTFX 자동매매 비활성화');
        addLog('⏹️ DTFX 자동매매 중지');
      }
      return { ...prev, isEnabled: newEnabled };
    });
  }, [addLog]);

  // 분석 루프 (3초마다)
  useEffect(() => {
    if (state.isEnabled && enabled) {
      // 즉시 한번 실행
      analyzeAllTimeframes();

      // 3초마다 반복
      analysisIntervalRef.current = setInterval(() => {
        analyzeAllTimeframes();
      }, 3000);

      return () => {
        if (analysisIntervalRef.current) {
          clearInterval(analysisIntervalRef.current);
        }
      };
    } else {
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
      }
    }
  }, [state.isEnabled, enabled, analyzeAllTimeframes]);

  // 기존 포지션 동기화
  useEffect(() => {
    if (!state.isEnabled || !enabled) return;

    const syncPosition = async () => {
      try {
        const positions = await getPositions(symbol);
        if (!positions) return;

        const activePosition = positions.find((p: any) => 
          p.symbol === symbol && parseFloat(p.positionAmt) !== 0
        );

        if (activePosition) {
          const positionAmt = parseFloat(activePosition.positionAmt);
          const entryPrice = parseFloat(activePosition.entryPrice);

          setState(prev => ({
            ...prev,
            currentPosition: {
              symbol,
              side: positionAmt > 0 ? 'long' : 'short',
              entryPrice,
              quantity: Math.abs(positionAmt),
              timestamp: Date.now(),
            },
          }));

          addLog(`📊 기존 포지션 감지: ${positionAmt > 0 ? '롱' : '숏'} ${Math.abs(positionAmt)} @ ${entryPrice.toFixed(4)}`);
        }
      } catch (error) {
        console.error('포지션 동기화 실패:', error);
      }
    };

    syncPosition();
  }, [state.isEnabled, enabled, symbol, getPositions, addLog]);

  return {
    state,
    toggleDTFXAutoTrading,
    executeEntry,
    executeExit,
  };
};
