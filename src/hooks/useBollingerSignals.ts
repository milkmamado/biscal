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

// Check if price touches band (within 0.2% tolerance - tighter for accuracy)
function checkBandTouch(price: number, upper: number, lower: number): 'upper' | 'lower' | null {
  const tolerance = 0.002; // 0.2% - tighter tolerance
  
  const upperDiff = Math.abs(price - upper) / upper;
  const lowerDiff = Math.abs(price - lower) / lower;
  
  // Must be AT or BEYOND the band, or very close
  if (price >= upper || upperDiff <= tolerance) return 'upper';
  if (price <= lower || lowerDiff <= tolerance) return 'lower';
  
  return null;
}

export function useBollingerSignals(tickers: TickerInfo[]) {
  const [signals, setSignals] = useState<BBSignal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const lastFetchRef = useRef<number>(0);
  const bbDataRef = useRef<Map<string, { upper: number; lower: number; sma: number }>>(new Map());
  
  // Create a map for quick ticker lookup
  const tickerMap = useMemo(() => {
    const map = new Map<string, TickerInfo>();
    tickers.forEach(t => map.set(t.symbol, t));
    return map;
  }, [tickers]);
  
  // Get eligible symbols
  const eligibleSymbols = useMemo(() => {
    return tickers
      .filter(t => 
        t.price >= 0.1 && 
        t.price <= 50 &&
        t.volume >= 50_000_000 && 
        t.volatilityRange >= 3
      )
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .slice(0, 30)
      .map(t => t.symbol);
  }, [tickers.length]);
  
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
  
  // Fetch BB data periodically (every 30 seconds)
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
          
          // Check 10-minute volatility (last 4 candles of 3m = 12 min)
          const recentKlines = klines.slice(-4);
          const highIn10m = Math.max(...recentKlines.map(k => k.high));
          const lowIn10m = Math.min(...recentKlines.map(k => k.low));
          const volatility10m = ((highIn10m - lowIn10m) / lowIn10m) * 100;
          
          // Skip if 10-min volatility < 2%
          if (volatility10m < 2) return;
          
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
  
  // Real-time check: Update signals based on CURRENT price touching BB bands
  useEffect(() => {
    if (bbDataRef.current.size === 0) return;
    
    const newSignals: BBSignal[] = [];
    
    for (const symbol of eligibleSymbols) {
      const bbData = bbDataRef.current.get(symbol);
      const ticker = tickerMap.get(symbol);
      if (!bbData || !ticker) continue;
      
      // Check if CURRENT price is touching BB band RIGHT NOW
      const touchType = checkBandTouch(ticker.price, bbData.upper, bbData.lower);
      
      // Only add if currently touching
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
    
    // Sort alphabetically for stable positioning
    newSignals.sort((a, b) => a.symbol.localeCompare(b.symbol));
    
    setSignals(newSignals);
  }, [tickerMap, eligibleSymbols]);
  
  // Initial fetch and periodic refresh
  useEffect(() => {
    fetchBBData();
    const interval = setInterval(fetchBBData, 30000);
    return () => clearInterval(interval);
  }, [fetchBBData]);
  
  return { signals, isLoading, refresh: fetchBBData };
}
