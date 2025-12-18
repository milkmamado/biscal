/**
 * 종목 자동 스크리닝 훅
 * 거래량, 변동성, 유동성 기반 최적 종목 선정
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  calculateAllIndicators, 
  checkLongSignal, 
  checkShortSignal,
  fetch5mKlines,
  TradingSignal,
  TechnicalIndicators
} from './useTechnicalIndicators';

interface TickerData {
  symbol: string;
  price: number;
  priceChangePercent: number;
  volume: number;
  volatilityRange: number;
}

// 스크리닝 기준
interface ScreeningCriteria {
  minVolume: number;         // 최소 거래량 (USD)
  minVolatility: number;     // 최소 일중 변동성 (%)
  maxVolatility: number;     // 최대 일중 변동성 (%)
  minPrice: number;          // 최소 가격
  maxPrice: number;          // 최대 가격
  spreadThreshold: number;   // 스프레드 임계값 (%)
}

const DEFAULT_CRITERIA: ScreeningCriteria = {
  minVolume: 50_000_000,    // $50M 이상
  minVolatility: 3,          // 3% 이상
  maxVolatility: 15,         // 15% 이하
  minPrice: 0.01,            // $0.01 이상
  maxPrice: 100,             // $100 이하 (레버리지 고려)
  spreadThreshold: 0.05,     // 0.05% 이하 스프레드
};

// 변동성 스코어 계산
function calculateVolatilityScore(volatility: number, volume: number): number {
  // 최적 범위: 3-8% 변동성, 높은 거래량
  let volScore = 0;
  
  if (volatility >= 3 && volatility <= 8) {
    volScore = 100;
  } else if (volatility < 3) {
    volScore = (volatility / 3) * 100;
  } else if (volatility > 8 && volatility <= 15) {
    volScore = 100 - ((volatility - 8) / 7) * 50;
  } else {
    volScore = 50 - Math.min(volatility - 15, 50);
  }
  
  // 거래량 보너스
  const volumeScore = Math.min(volume / 100_000_000 * 50, 50); // 최대 50점 보너스
  
  return Math.max(0, Math.min(100, volScore + volumeScore));
}

// ATR 기반 변동성 체크
async function checkATRVolatility(symbol: string): Promise<{ atr: number; atrPercent: number; isOptimal: boolean }> {
  try {
    const klines = await fetch5mKlines(symbol, 30);
    if (!klines || klines.length < 20) {
      return { atr: 0, atrPercent: 0, isOptimal: false };
    }
    
    // ATR 계산
    const tr: number[] = [];
    for (let i = 1; i < klines.length; i++) {
      const curr = klines[i];
      const prev = klines[i - 1];
      const trVal = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );
      tr.push(trVal);
    }
    
    const atr = tr.slice(-14).reduce((a, b) => a + b, 0) / 14;
    const currentPrice = klines[klines.length - 1].close;
    const atrPercent = (atr / currentPrice) * 100;
    
    // 5분봉 ATR 0.5% - 1.5% 범위가 최적
    const isOptimal = atrPercent >= 0.3 && atrPercent <= 2;
    
    return { atr, atrPercent, isOptimal };
  } catch {
    return { atr: 0, atrPercent: 0, isOptimal: false };
  }
}

// 스크리닝된 종목
export interface ScreenedSymbol {
  symbol: string;
  price: number;
  volume: number;
  volatilityRange: number;
  volatilityScore: number;
  atrPercent: number;
  signal: TradingSignal | null;
  indicators: TechnicalIndicators | null;
  rank: number;
}

export function useCoinScreening(tickers: TickerData[], criteria: Partial<ScreeningCriteria> = {}) {
  const [screenedSymbols, setScreenedSymbols] = useState<ScreenedSymbol[]>([]);
  const [activeSignals, setActiveSignals] = useState<TradingSignal[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState(0);
  
  const tickersRef = useRef<TickerData[]>([]);
  const isMountedRef = useRef(true);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Merge criteria
  const fullCriteria = { ...DEFAULT_CRITERIA, ...criteria };
  
  // Update tickers ref
  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);
  
  // 종목 스크리닝 함수
  const runScreening = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (isScanning) return;
    
    const currentTickers = tickersRef.current;
    if (currentTickers.length === 0) return;
    
    setIsScanning(true);
    
    try {
      // 1차 필터링: 기본 조건
      const eligible = currentTickers.filter(t => 
        t.price >= fullCriteria.minPrice &&
        t.price <= fullCriteria.maxPrice &&
        t.volume >= fullCriteria.minVolume &&
        t.volatilityRange >= fullCriteria.minVolatility &&
        t.volatilityRange <= fullCriteria.maxVolatility
      );
      
      // 변동성 스코어 기준 정렬
      const scored = eligible
        .map(t => ({
          ...t,
          volatilityScore: calculateVolatilityScore(t.volatilityRange, t.volume),
        }))
        .sort((a, b) => b.volatilityScore - a.volatilityScore)
        .slice(0, 20); // 상위 20개만
      
      // 2차 분석: 기술적 지표 + ATR
      const analyzed: ScreenedSymbol[] = [];
      const signals: TradingSignal[] = [];
      
      for (let i = 0; i < scored.length; i++) {
        if (!isMountedRef.current) break;
        
        const t = scored[i];
        
        try {
          // ATR 체크
          const atrData = await checkATRVolatility(t.symbol);
          if (!atrData.isOptimal) continue;
          
          // 5분봉 기술적 분석
          const klines = await fetch5mKlines(t.symbol, 50);
          if (!klines || klines.length < 30) continue;
          
          const indicators = calculateAllIndicators(klines);
          if (!indicators) continue;
          
          // 🆕 ADX 시장 환경 필터 - 횡보장 차단
          if (indicators.adx < 20) continue;
          
          // 시그널 체크
          const longCheck = checkLongSignal(indicators, t.price);
          const shortCheck = checkShortSignal(indicators, t.price);
          
          let signal: TradingSignal | null = null;
          
          if (longCheck.valid) {
            signal = {
              symbol: t.symbol,
              direction: 'long',
              strength: longCheck.strength,
              price: t.price,
              reasons: longCheck.reasons,
              indicators,
              timestamp: Date.now(),
            };
            signals.push(signal);
          } else if (shortCheck.valid) {
            signal = {
              symbol: t.symbol,
              direction: 'short',
              strength: shortCheck.strength,
              price: t.price,
              reasons: shortCheck.reasons,
              indicators,
              timestamp: Date.now(),
            };
            signals.push(signal);
          }
          
          analyzed.push({
            symbol: t.symbol,
            price: t.price,
            volume: t.volume,
            volatilityRange: t.volatilityRange,
            volatilityScore: t.volatilityScore,
            atrPercent: atrData.atrPercent,
            signal,
            indicators,
            rank: analyzed.length + 1,
          });
          
        } catch (err) {
          console.error(`Screening error for ${t.symbol}:`, err);
        }
        
        // API 부하 방지
        if (i < scored.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      if (!isMountedRef.current) return;
      
      // 시그널 강도 기준 정렬
      signals.sort((a, b) => {
        const strengthOrder = { strong: 3, medium: 2, weak: 1 };
        return strengthOrder[b.strength] - strengthOrder[a.strength];
      });
      
      setScreenedSymbols(analyzed);
      setActiveSignals(signals);
      setLastScanTime(Date.now());
      
    } catch (error) {
      console.error('Screening error:', error);
    } finally {
      setIsScanning(false);
    }
  }, [isScanning, fullCriteria]);
  
  // 주기적 스캔 (30초)
  useEffect(() => {
    isMountedRef.current = true;
    
    // 초기 스캔
    const initialDelay = setTimeout(() => {
      runScreening();
    }, 2000);
    
    // 30초 간격 스캔
    scanIntervalRef.current = setInterval(runScreening, 30000);
    
    return () => {
      isMountedRef.current = false;
      clearTimeout(initialDelay);
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
    };
  }, []); // 의존성 없음 - 마운트 시 한 번만
  
  // 수동 스캔
  const manualScan = useCallback(() => {
    runScreening();
  }, [runScreening]);
  
  // 특정 심볼 기술적 분석
  const analyzeSymbol = useCallback(async (symbol: string): Promise<TradingSignal | null> => {
    try {
      const klines = await fetch5mKlines(symbol, 50);
      if (!klines || klines.length < 30) return null;
      
      const indicators = calculateAllIndicators(klines);
      if (!indicators) return null;
      
      const currentPrice = klines[klines.length - 1].close;
      
      const longCheck = checkLongSignal(indicators, currentPrice);
      const shortCheck = checkShortSignal(indicators, currentPrice);
      
      if (longCheck.valid) {
        return {
          symbol,
          direction: 'long',
          strength: longCheck.strength,
          price: currentPrice,
          reasons: longCheck.reasons,
          indicators,
          timestamp: Date.now(),
        };
      }
      
      if (shortCheck.valid) {
        return {
          symbol,
          direction: 'short',
          strength: shortCheck.strength,
          price: currentPrice,
          reasons: shortCheck.reasons,
          indicators,
          timestamp: Date.now(),
        };
      }
      
      return null;
    } catch {
      return null;
    }
  }, []);
  
  return {
    screenedSymbols,
    activeSignals,
    isScanning,
    lastScanTime,
    manualScan,
    analyzeSymbol,
  };
}
