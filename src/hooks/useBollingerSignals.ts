import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

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

interface KlineData {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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
  const lastFetchRef = useRef<number>(0);
  const bbDataRef = useRef<Map<string, { upper: number; lower: number; sma: number }>>(new Map());
  const tickerPricesRef = useRef<Map<string, TickerInfo>>(new Map());
  const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Get eligible symbols - stable dependency
  const eligibleSymbolsKey = useMemo(() => {
    return tickers
      .filter(t => 
        t.price >= 0.1 && 
        t.price <= 50 &&
        t.volume >= 50_000_000 && 
        t.volatilityRange >= 3
      )
      .map(t => t.symbol)
      .sort()
      .slice(0, 30)
      .join(',');
  }, [tickers.length > 0 ? tickers.map(t => t.symbol).join(',') : '']);
  
  const eligibleSymbols = useMemo(() => {
    return eligibleSymbolsKey ? eligibleSymbolsKey.split(',') : [];
  }, [eligibleSymbolsKey]);
  
  // Update ticker prices ref (no state change, no re-render)
  useEffect(() => {
    tickers.forEach(t => tickerPricesRef.current.set(t.symbol, t));
  }, [tickers]);
  
  const fetchKlines = useCallback(async (symbol: string): Promise<KlineData[] | null> => {
    try {
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=3m&limit=25`
      );
      
      if (!response.ok) return null;
      
      const data = await response.json();
      return data.map((k: any) => ({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));
    } catch (error) {
      console.error(`Failed to fetch klines for ${symbol}:`, error);
      return null;
    }
  }, []);
  
  // Fetch BB data
  const fetchBBData = useCallback(async () => {
    const now = Date.now();
    if (now - lastFetchRef.current < 30000) return;
    lastFetchRef.current = now;
    
    if (eligibleSymbols.length === 0) return;
    
    setIsLoading(true);
    
    const batchSize = 5;
    for (let i = 0; i < eligibleSymbols.length; i += batchSize) {
      const batch = eligibleSymbols.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (symbol) => {
          const klines = await fetchKlines(symbol);
          if (!klines || klines.length < 20) return;
          
          // Check 10-minute volatility
          const recentKlines = klines.slice(-4);
          const highIn10m = Math.max(...recentKlines.map(k => k.high));
          const lowIn10m = Math.min(...recentKlines.map(k => k.low));
          const volatility10m = ((highIn10m - lowIn10m) / lowIn10m) * 100;
          
          if (volatility10m < 1.5) return;
          
          const closes = klines.map(k => k.close);
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
    
    setIsLoading(false);
  }, [eligibleSymbols, fetchKlines]);
  
  // Check signals function
  const checkSignals = useCallback(() => {
    if (bbDataRef.current.size === 0 || eligibleSymbols.length === 0) return;
    
    const newSignals: BBSignal[] = [];
    
    for (const symbol of eligibleSymbols) {
      const bbData = bbDataRef.current.get(symbol);
      const ticker = tickerPricesRef.current.get(symbol);
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
  }, [eligibleSymbols]);
  
  // Initial fetch and periodic BB data refresh
  useEffect(() => {
    const runScan = async () => {
      // 신호를 먼저 지우지 않고 데이터 가져온 후 업데이트
      await fetchBBData();
      checkSignals();
    };
    
    runScan();
    const interval = setInterval(runScan, 30000);
    return () => clearInterval(interval);
  }, [fetchBBData, checkSignals]);
  
  // Periodic signal check (every 2 seconds)
  useEffect(() => {
    if (checkIntervalRef.current) {
      clearInterval(checkIntervalRef.current);
    }
    
    checkIntervalRef.current = setInterval(checkSignals, 2000);
    
    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, [checkSignals]);
  
  return { signals, isLoading, refresh: fetchBBData };
}
