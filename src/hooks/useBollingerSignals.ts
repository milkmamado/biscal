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

// Check if price touches band (within 0.3% tolerance)
function checkBandTouch(price: number, upper: number, lower: number): 'upper' | 'lower' | null {
  const tolerance = 0.003;
  
  const upperDiff = Math.abs(price - upper) / upper;
  const lowerDiff = Math.abs(price - lower) / lower;
  
  if (upperDiff <= tolerance || price >= upper) return 'upper';
  if (lowerDiff <= tolerance || price <= lower) return 'lower';
  
  return null;
}

export function useBollingerSignals(tickers: TickerInfo[]) {
  const [signals, setSignals] = useState<BBSignal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const lastFetchRef = useRef<number>(0);
  const bbDataRef = useRef<Map<string, { upper: number; lower: number; sma: number }>>(new Map());
  const signalSymbolsRef = useRef<string[]>([]); // Track stable symbol order
  
  // Create a map for quick ticker lookup
  const tickerMap = useMemo(() => {
    const map = new Map<string, TickerInfo>();
    tickers.forEach(t => map.set(t.symbol, t));
    return map;
  }, [tickers]);
  
  // Get eligible symbols (memoized, only changes when ticker list changes significantly)
  const eligibleSymbols = useMemo(() => {
    return tickers
      .filter(t => 
        t.price >= 0.1 && 
        t.price <= 50 &&
        t.volume >= 50_000_000 && 
        t.volatilityRange >= 3
      )
      .sort((a, b) => a.symbol.localeCompare(b.symbol)) // Alphabetical for stability
      .slice(0, 30)
      .map(t => t.symbol);
  }, [tickers.length]); // Only recalculate when ticker count changes
  
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
  
  // Fetch BB data and update signals (every 30 seconds)
  const fetchBBData = useCallback(async () => {
    const now = Date.now();
    if (now - lastFetchRef.current < 30000) return;
    lastFetchRef.current = now;
    
    setIsLoading(true);
    
    const batchSize = 5;
    for (let i = 0; i < eligibleSymbols.length; i += batchSize) {
      const batch = eligibleSymbols.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (symbol) => {
          const klines = await fetchKlines(symbol);
          if (!klines || klines.length < 20) return;
          
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
    
    // Calculate signals ONCE after fetching BB data
    const newSignals: BBSignal[] = [];
    const newSymbolOrder: string[] = [];
    
    for (const symbol of eligibleSymbols) {
      const bbData = bbDataRef.current.get(symbol);
      const ticker = tickerMap.get(symbol);
      if (!bbData || !ticker) continue;
      
      const touchType = checkBandTouch(ticker.price, bbData.upper, bbData.lower);
      
      if (touchType) {
        newSymbolOrder.push(symbol);
        newSignals.push({
          symbol,
          price: ticker.price,
          priceChangePercent: ticker.priceChangePercent,
          volume: ticker.volume,
          touchType,
          upperBand: bbData.upper,
          lowerBand: bbData.lower,
          sma: bbData.sma,
          timestamp: now
        });
      }
    }
    
    // Sort alphabetically and store the order
    newSignals.sort((a, b) => a.symbol.localeCompare(b.symbol));
    signalSymbolsRef.current = newSignals.map(s => s.symbol);
    
    setSignals(newSignals);
    setIsLoading(false);
  }, [eligibleSymbols, fetchKlines, tickerMap]);
  
  // Update prices in existing signals without reordering (real-time)
  useEffect(() => {
    if (signalSymbolsRef.current.length === 0) return;
    
    setSignals(prev => {
      // Keep the same order, just update prices
      return prev.map(signal => {
        const ticker = tickerMap.get(signal.symbol);
        if (!ticker) return signal;
        
        return {
          ...signal,
          price: ticker.price,
          priceChangePercent: ticker.priceChangePercent,
          volume: ticker.volume
        };
      });
    });
  }, [tickerMap]);
  
  // Initial fetch and periodic refresh
  useEffect(() => {
    fetchBBData();
    const interval = setInterval(fetchBBData, 30000);
    return () => clearInterval(interval);
  }, [fetchBBData]);
  
  return { signals, isLoading, refresh: fetchBBData };
}
