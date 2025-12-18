import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

export interface EnhancedSignal {
  symbol: string;
  price: number;
  reason: string; // 'momentum' | 'volume' | 'tick'
  strength: number; // 신호 강도 (1-3)
  detectedAt: number;
}

interface TickerData {
  symbol: string;
  price: number;
  priceChangePercent: number;
  volume: number;
}

interface BBSignal {
  symbol: string;
  price: number;
  touchType: 'upper' | 'lower';
}

// 가격 히스토리 (틱 속도 계산용)
const priceHistoryMap = new Map<string, { price: number; time: number }[]>();

// 거래량 히스토리 (거래량 폭발 계산용)
const volumeHistoryMap = new Map<string, number[]>();

const MOMENTUM_THRESHOLD = 2; // 1분 내 2% 이상
const VOLUME_SPIKE_RATIO = 3; // 평균 대비 3배 이상
const TICK_SPEED_THRESHOLD = 0.5; // 10초 내 0.5% 이상
const SCAN_INTERVAL = 10000; // 10초마다 스캔

export function useEnhancedSignals(
  tickers: TickerData[],
  bbSignals: BBSignal[]
) {
  const [enhancedSignals, setEnhancedSignals] = useState<EnhancedSignal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const lastScanRef = useRef(0);

  // BB 시그널이 있는 심볼만 추출
  const bbSymbols = useMemo(() => 
    new Set(bbSignals.map(s => s.symbol)),
    [bbSignals]
  );

  // 1. 모멘텀 체크 (1분봉 급등/급락)
  const checkMomentum = useCallback(async (symbol: string): Promise<{ hit: boolean; change: number }> => {
    try {
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=2`
      );
      if (!response.ok) return { hit: false, change: 0 };
      
      const data = await response.json();
      if (!data || data.length < 2) return { hit: false, change: 0 };
      
      const currentCandle = data[data.length - 1];
      const prevCandle = data[data.length - 2];
      
      const currentClose = parseFloat(currentCandle[4]);
      const prevClose = parseFloat(prevCandle[4]);
      const change = ((currentClose - prevClose) / prevClose) * 100;
      
      return { hit: Math.abs(change) >= MOMENTUM_THRESHOLD, change };
    } catch {
      return { hit: false, change: 0 };
    }
  }, []);

  // 2. 거래량 폭발 체크
  const checkVolumeSpike = useCallback((symbol: string, currentVolume: number): { hit: boolean; ratio: number } => {
    const history = volumeHistoryMap.get(symbol) || [];
    
    // 히스토리 업데이트
    history.push(currentVolume);
    if (history.length > 20) history.shift(); // 최근 20개만 유지
    volumeHistoryMap.set(symbol, history);
    
    if (history.length < 5) return { hit: false, ratio: 1 };
    
    // 이전 평균 대비 현재 거래량
    const avgVolume = history.slice(0, -1).reduce((a, b) => a + b, 0) / (history.length - 1);
    const ratio = avgVolume > 0 ? currentVolume / avgVolume : 1;
    
    return { hit: ratio >= VOLUME_SPIKE_RATIO, ratio };
  }, []);

  // 3. 틱 속도 체크 (10초 내 급변)
  const checkTickSpeed = useCallback((symbol: string, currentPrice: number): { hit: boolean; change: number } => {
    const now = Date.now();
    const history = priceHistoryMap.get(symbol) || [];
    
    // 히스토리 업데이트
    history.push({ price: currentPrice, time: now });
    
    // 30초 이상 된 데이터 제거
    const recentHistory = history.filter(h => now - h.time < 30000);
    priceHistoryMap.set(symbol, recentHistory);
    
    if (recentHistory.length < 2) return { hit: false, change: 0 };
    
    // 10초 전 가격과 비교
    const tenSecondsAgo = now - 10000;
    const oldEntry = recentHistory.find(h => h.time <= tenSecondsAgo);
    
    if (!oldEntry) return { hit: false, change: 0 };
    
    const change = ((currentPrice - oldEntry.price) / oldEntry.price) * 100;
    
    return { hit: Math.abs(change) >= TICK_SPEED_THRESHOLD, change };
  }, []);

  // 종합 스캔
  const runScan = useCallback(async () => {
    if (tickers.length === 0 || bbSignals.length === 0) return;
    
    const now = Date.now();
    if (now - lastScanRef.current < SCAN_INTERVAL) return;
    
    setIsLoading(true);
    lastScanRef.current = now;
    
    const results: EnhancedSignal[] = [];
    
    // BB 시그널이 있는 종목만 체크
    for (const bbSignal of bbSignals) {
      const ticker = tickers.find(t => t.symbol === bbSignal.symbol);
      if (!ticker) continue;
      
      const reasons: string[] = [];
      let strength = 0;
      
      // 1. 모멘텀 체크
      const momentum = await checkMomentum(bbSignal.symbol);
      if (momentum.hit) {
        reasons.push(`급등 ${momentum.change > 0 ? '+' : ''}${momentum.change.toFixed(1)}%`);
        strength++;
      }
      
      // 2. 거래량 폭발 체크
      const volumeSpike = checkVolumeSpike(bbSignal.symbol, ticker.volume);
      if (volumeSpike.hit) {
        reasons.push(`거래량 ${volumeSpike.ratio.toFixed(1)}x`);
        strength++;
      }
      
      // 3. 틱 속도 체크
      const tickSpeed = checkTickSpeed(bbSignal.symbol, ticker.price);
      if (tickSpeed.hit) {
        reasons.push(`틱속도 ${tickSpeed.change > 0 ? '+' : ''}${tickSpeed.change.toFixed(2)}%`);
        strength++;
      }
      
      // 하나라도 만족하면 추가
      if (reasons.length > 0) {
        results.push({
          symbol: bbSignal.symbol,
          price: ticker.price,
          reason: reasons.join(' + '),
          strength,
          detectedAt: now,
        });
      }
    }
    
    // 강도순 정렬
    results.sort((a, b) => b.strength - a.strength);
    
    setEnhancedSignals(results);
    setIsLoading(false);
  }, [tickers, bbSignals, checkMomentum, checkVolumeSpike, checkTickSpeed]);

  // 주기적 스캔
  useEffect(() => {
    if (tickers.length === 0 || bbSignals.length === 0) return;
    
    runScan();
    const interval = setInterval(runScan, SCAN_INTERVAL);
    
    return () => clearInterval(interval);
  }, [tickers.length > 0, bbSignals.length > 0, runScan]);

  return { enhancedSignals, isLoading, runScan, bbSymbols };
}
