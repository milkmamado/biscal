import { useState, useEffect, useRef, useCallback } from 'react';

export interface MomentumSignal {
  symbol: string;
  price: number;
  changePercent: number; // 1분 내 변화율
  priceChangePercent: number; // 24시간 변화율
  direction: 'up' | 'down';
  volume: number;
  detectedAt: number;
}

interface TickerData {
  symbol: string;
  price: number;
  priceChangePercent: number;
  volume: number;
}

const MOMENTUM_THRESHOLD = 2; // 1분 내 2% 이상
const MIN_VOLUME = 50_000_000; // 최소 거래대금 $50M
const SCAN_INTERVAL = 10000; // 10초마다 스캔

export function useMomentumSignals(tickers: TickerData[]) {
  const [signals, setSignals] = useState<MomentumSignal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const lastScanRef = useRef(0);
  const priceHistoryRef = useRef<Map<string, { price: number; time: number }[]>>(new Map());

  // 1분봉 데이터로 급등/급락 체크
  const fetchAndCheckMomentum = useCallback(async (symbol: string): Promise<MomentumSignal | null> => {
    try {
      // 최근 2개 1분봉 가져오기
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=2`
      );
      if (!response.ok) return null;
      
      const data = await response.json();
      if (!data || data.length < 2) return null;
      
      const currentCandle = data[data.length - 1];
      const prevCandle = data[data.length - 2];
      
      const currentOpen = parseFloat(currentCandle[1]);
      const currentClose = parseFloat(currentCandle[4]);
      const currentHigh = parseFloat(currentCandle[2]);
      const currentLow = parseFloat(currentCandle[3]);
      const prevClose = parseFloat(prevCandle[4]);
      
      // 현재 봉의 시가 대비 현재가 변화율 (실시간)
      const changeFromOpen = ((currentClose - currentOpen) / currentOpen) * 100;
      
      // 전 봉 종가 대비 현재가 변화율 (봉 간 점프)
      const changeFromPrev = ((currentClose - prevClose) / prevClose) * 100;
      
      // 현재 봉 내에서의 고저 변동폭
      const rangePercent = ((currentHigh - currentLow) / currentLow) * 100;
      
      // 가장 큰 변화 사용
      const maxChange = Math.max(Math.abs(changeFromOpen), Math.abs(changeFromPrev));
      
      if (maxChange >= MOMENTUM_THRESHOLD) {
        const ticker = tickers.find(t => t.symbol === symbol);
        return {
          symbol,
          price: currentClose,
          changePercent: changeFromOpen > 0 ? maxChange : -maxChange,
          priceChangePercent: ticker?.priceChangePercent || 0,
          direction: changeFromOpen > 0 ? 'up' : 'down',
          volume: ticker?.volume || 0,
          detectedAt: Date.now()
        };
      }
      
      return null;
    } catch {
      return null;
    }
  }, [tickers]);

  // 전체 스캔
  const runScan = useCallback(async () => {
    if (tickers.length === 0) return;
    
    const now = Date.now();
    if (now - lastScanRef.current < SCAN_INTERVAL) return;
    
    setIsLoading(true);
    lastScanRef.current = now;
    
    // 거래량 상위 종목만 스캔 (효율성)
    const topVolume = tickers
      .filter(t => t.volume >= MIN_VOLUME)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 50);
    
    const results: MomentumSignal[] = [];
    
    // 병렬로 체크 (10개씩 배치)
    const batchSize = 10;
    for (let i = 0; i < topVolume.length; i += batchSize) {
      const batch = topVolume.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(t => fetchAndCheckMomentum(t.symbol))
      );
      batchResults.forEach(r => {
        if (r) results.push(r);
      });
      
      // API 속도 제한 방지
      if (i + batchSize < topVolume.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    // 변화율 절대값으로 정렬
    results.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
    
    setSignals(results);
    setIsLoading(false);
  }, [tickers, fetchAndCheckMomentum]);

  // 주기적 스캔
  useEffect(() => {
    if (tickers.length === 0) return;
    
    runScan();
    const interval = setInterval(runScan, SCAN_INTERVAL);
    
    return () => clearInterval(interval);
  }, [tickers.length > 0, runScan]);

  return { signals, isLoading, runScan };
}
