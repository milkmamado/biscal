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

interface TickerInfo {
  symbol: string;
  price: number;
  priceChangePercent: number;
  volume: number;
  volatilityRange: number; // (high - low) / low * 100
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

export function useBollingerSignals(tickers: TickerInfo[]) {
  const [signals, setSignals] = useState<BBSignal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const lastFetchRef = useRef<number>(0);
  const bbDataRef = useRef<Map<string, { upper: number; lower: number; sma: number; timestamp: number }>>(new Map());
  
  // Filter symbols: $0.1-$50 price, $50M+ volume, 3%+ volatility (execution speed)
  const eligibleSymbols = tickers
    .filter(t => 
      t.price >= 0.1 && 
      t.price <= 50 && // 스캘핑용 중소형 코인만 (BTC, ETH 등 제외)
      t.volume >= 50_000_000 && 
      t.volatilityRange >= 3 // 최소 3% 일일 변동폭 (체결속도 필터)
    )
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 30);
  
  const fetchKlines = useCallback(async (symbol: string): Promise<KlineData[] | null> => {
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
      
      return klines;
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
        batch.map(async (ticker) => {
          const klines = await fetchKlines(ticker.symbol);
          if (!klines || klines.length < 20) return;
          
          const closes = klines.map(k => k.close);
          const bb = calculateBB(closes);
          if (!bb) return;
          
          bbDataRef.current.set(ticker.symbol, {
            upper: bb.upper,
            lower: bb.lower,
            sma: bb.sma,
            timestamp: now
          });
        })
      );
      
      if (i + batchSize < eligibleSymbols.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    setIsLoading(false);
  }, [eligibleSymbols, fetchKlines]);
  
  // Check current prices against BB bands (real-time)
  useEffect(() => {
    const newSignals: BBSignal[] = [];
    
    for (const ticker of eligibleSymbols) {
      const bbData = bbDataRef.current.get(ticker.symbol);
      if (!bbData) continue;
      
      // Check CURRENT price against BB bands
      const touchType = checkBandTouch(ticker.price, bbData.upper, bbData.lower);
      
      if (touchType) {
        newSignals.push({
          symbol: ticker.symbol,
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
    
    // Sort by symbol name (alphabetical) for stable positioning
    newSignals.sort((a, b) => a.symbol.localeCompare(b.symbol));
    
    setSignals(newSignals);
  }, [eligibleSymbols]);
  
  // Initial fetch and periodic refresh of BB data
  useEffect(() => {
    fetchBBData();
    const interval = setInterval(fetchBBData, 30000);
    return () => clearInterval(interval);
  }, [fetchBBData]);
  
  return { signals, isLoading, refresh: fetchBBData };
}
