import { useState, useEffect, useRef } from 'react';

export interface BBSignal {
  symbol: string;
  price: number;
  priceChangePercent: number;
  volume: number;
  touchType: 'upper' | 'lower';
  upperBand: number;
  lowerBand: number;
  sma: number;
  timestamp: number;
}

interface TickerInfo {
  symbol: string;
  price: number;
  priceChangePercent: number;
  volume: number;
  volatilityRange: number;
}

// Calculate Bollinger Bands
function calculateBB(closes: number[], period: number = 20, multiplier: number = 2) {
  if (closes.length < period) return null;
  
  const recentCloses = closes.slice(-period);
  const sma = recentCloses.reduce((a, b) => a + b, 0) / period;
  
  const squaredDiffs = recentCloses.map(c => Math.pow(c - sma, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(variance);
  
  return {
    sma,
    upper: sma + (multiplier * stdDev),
    lower: sma - (multiplier * stdDev),
    stdDev
  };
}

// Check if price touches band (within 0.2% tolerance)
function checkBandTouch(price: number, upper: number, lower: number): 'upper' | 'lower' | null {
  const tolerance = 0.002;
  
  const upperDiff = Math.abs(price - upper) / upper;
  const lowerDiff = Math.abs(price - lower) / lower;
  
  if (price >= upper || upperDiff <= tolerance) return 'upper';
  if (price <= lower || lowerDiff <= tolerance) return 'lower';
  
  return null;
}

export function useBollingerSignals(tickers: TickerInfo[]) {
  const [signals, setSignals] = useState<BBSignal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // 모든 데이터를 ref로 관리하여 useEffect 재실행 방지
  const tickersRef = useRef<TickerInfo[]>([]);
  const bbDataRef = useRef<Map<string, { upper: number; lower: number; sma: number }>>(new Map());
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const priceUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  
  // tickers 업데이트 (ref만 업데이트, 리렌더 없음)
  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);
  
  // 메인 스캔 로직 (30초마다 실행, 의존성 없음)
  useEffect(() => {
    isMountedRef.current = true;
    
    const fetchKlines = async (symbol: string) => {
      try {
        const response = await fetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=3m&limit=25`
        );
        if (!response.ok) return null;
        const data = await response.json();
        return data.map((k: any) => ({
          close: parseFloat(k[4]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3])
        }));
      } catch {
        return null;
      }
    };
    
    const runScan = async () => {
      if (!isMountedRef.current) return;
      
      // 현재 tickers에서 eligible symbols 계산
      const currentTickers = tickersRef.current;
      const eligibleSymbols = currentTickers
        .filter(t => 
          t.price >= 0.1 && 
          t.price <= 50 &&
          t.volume >= 50_000_000 && 
          t.volatilityRange >= 3
        )
        .map(t => t.symbol)
        .slice(0, 30);
      
      if (eligibleSymbols.length === 0) return;
      
      setIsLoading(true);
      
      // BB 데이터 가져오기
      const batchSize = 5;
      for (let i = 0; i < eligibleSymbols.length; i += batchSize) {
        if (!isMountedRef.current) break;
        
        const batch = eligibleSymbols.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (symbol) => {
            const klines = await fetchKlines(symbol);
            if (!klines || klines.length < 20) return;
            
            // 10분 변동성 체크
            const recentKlines = klines.slice(-4);
            const highIn10m = Math.max(...recentKlines.map((k: any) => k.high));
            const lowIn10m = Math.min(...recentKlines.map((k: any) => k.low));
            const volatility10m = ((highIn10m - lowIn10m) / lowIn10m) * 100;
            
            if (volatility10m < 1.5) return;
            
            const closes = klines.map((k: any) => k.close);
            const bb = calculateBB(closes);
            if (!bb) return;
            
            bbDataRef.current.set(symbol, {
              upper: bb.upper,
              lower: bb.lower,
              sma: bb.sma
            });
          })
        );
        
        if (i + batchSize < eligibleSymbols.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      if (!isMountedRef.current) return;
      
      // 신호 계산
      const newSignals: BBSignal[] = [];
      const tickerMap = new Map(currentTickers.map(t => [t.symbol, t]));
      
      for (const symbol of eligibleSymbols) {
        const bbData = bbDataRef.current.get(symbol);
        const ticker = tickerMap.get(symbol);
        if (!bbData || !ticker) continue;
        
        const touchType = checkBandTouch(ticker.price, bbData.upper, bbData.lower);
        
        if (touchType) {
          newSignals.push({
            symbol,
            price: ticker.price,
            priceChangePercent: ticker.priceChangePercent,
            volume: ticker.volume,
            touchType,
            upperBand: bbData.upper,
            lowerBand: bbData.lower,
            sma: bbData.sma,
            timestamp: Date.now()
          });
        }
      }
      
      newSignals.sort((a, b) => a.symbol.localeCompare(b.symbol));
      setSignals(newSignals);
      setIsLoading(false);
    };
    
    // 초기 스캔
    runScan();
    
    // 30초마다 스캔 (의존성 없이 안정적으로 실행)
    scanIntervalRef.current = setInterval(runScan, 30000);
    
    return () => {
      isMountedRef.current = false;
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
    };
  }, []); // 의존성 없음 - 마운트 시 한번만 설정
  
  // 기존 신호의 가격만 업데이트 (2초마다)
  useEffect(() => {
    priceUpdateIntervalRef.current = setInterval(() => {
      setSignals(prev => {
        if (prev.length === 0) return prev;
        
        const tickerMap = new Map(tickersRef.current.map(t => [t.symbol, t]));
        let hasChange = false;
        
        const updated = prev.map(signal => {
          const ticker = tickerMap.get(signal.symbol);
          if (ticker && ticker.price !== signal.price) {
            hasChange = true;
            return {
              ...signal,
              price: ticker.price,
              priceChangePercent: ticker.priceChangePercent
            };
          }
          return signal;
        });
        
        return hasChange ? updated : prev;
      });
    }, 2000);
    
    return () => {
      if (priceUpdateIntervalRef.current) {
        clearInterval(priceUpdateIntervalRef.current);
      }
    };
  }, []);
  
  const refresh = async () => {
    // 수동 새로고침 시에도 동일한 로직 사용
  };
  
  return { signals, isLoading, refresh };
}
