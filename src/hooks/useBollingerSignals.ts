import { useState, useEffect, useCallback, useRef } from 'react';

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
  const tolerance = 0.003; // 0.3%
  
  const upperDiff = Math.abs(price - upper) / upper;
  const lowerDiff = Math.abs(price - lower) / lower;
  
  if (upperDiff <= tolerance || price >= upper) return 'upper';
  if (lowerDiff <= tolerance || price <= lower) return 'lower';
  
  return null;
}

export function useBollingerSignals(symbols: string[]) {
  const [signals, setSignals] = useState<BBSignal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const lastFetchRef = useRef<number>(0);
  const cacheRef = useRef<Map<string, { data: KlineData[]; timestamp: number }>>(new Map());
  
  const fetchKlines = useCallback(async (symbol: string): Promise<KlineData[] | null> => {
    // Check cache (valid for 30 seconds)
    const cached = cacheRef.current.get(symbol);
    if (cached && Date.now() - cached.timestamp < 30000) {
      return cached.data;
    }
    
    try {
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=3m&limit=25`
      );
      
      if (!response.ok) return null;
      
      const data = await response.json();
      const klines: KlineData[] = data.map((k: any) => ({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));
      
      // Cache the result
      cacheRef.current.set(symbol, { data: klines, timestamp: Date.now() });
      
      return klines;
    } catch (error) {
      console.error(`Failed to fetch klines for ${symbol}:`, error);
      return null;
    }
  }, []);
  
  const scanForSignals = useCallback(async () => {
    if (symbols.length === 0) return;
    
    // Throttle: minimum 10 seconds between scans
    const now = Date.now();
    if (now - lastFetchRef.current < 10000) return;
    lastFetchRef.current = now;
    
    setIsLoading(true);
    
    const newSignals: BBSignal[] = [];
    
    // Process in batches of 5 to avoid rate limiting
    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      
      const results = await Promise.all(
        batch.map(async (symbol) => {
          const klines = await fetchKlines(symbol);
          if (!klines || klines.length < 20) return null;
          
          const closes = klines.map(k => k.close);
          const bb = calculateBB(closes);
          if (!bb) return null;
          
          const currentPrice = closes[closes.length - 1];
          const touchType = checkBandTouch(currentPrice, bb.upper, bb.lower);
          
          if (touchType) {
            // Get price change from first and last kline
            const firstClose = klines[0].close;
            const priceChangePercent = ((currentPrice - firstClose) / firstClose) * 100;
            const totalVolume = klines.reduce((sum, k) => sum + k.volume * k.close, 0);
            
            return {
              symbol,
              price: currentPrice,
              priceChangePercent,
              volume: totalVolume,
              touchType,
              upperBand: bb.upper,
              lowerBand: bb.lower,
              sma: bb.sma,
              timestamp: Date.now()
            } as BBSignal;
          }
          
          return null;
        })
      );
      
      results.forEach(r => {
        if (r) newSignals.push(r);
      });
      
      // Small delay between batches
      if (i + batchSize < symbols.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    // Sort by timestamp (most recent first), then by touch type
    newSignals.sort((a, b) => b.timestamp - a.timestamp);
    
    setSignals(newSignals);
    setIsLoading(false);
  }, [symbols, fetchKlines]);
  
  // Initial scan and periodic refresh
  useEffect(() => {
    scanForSignals();
    
    const interval = setInterval(scanForSignals, 30000); // Refresh every 30 seconds
    
    return () => clearInterval(interval);
  }, [scanForSignals]);
  
  return { signals, isLoading, refresh: scanForSignals };
}
