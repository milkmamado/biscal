/**
 * 종목 자동 스크리닝 훅
 * 프로 스캘퍼 시스템: 다중 시간대 + 프라이스 액션 + 모멘텀 합의 기반
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
import { 
  getProDirection, 
  checkForbiddenConditions,
  ProDirectionResult 
} from './useProDirection';
import { addScreeningLog, clearScreeningLogs } from '@/components/ScreeningLogPanel';

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
  minVolume: 10_000_000,    // $10M 이상 (완화)
  minVolatility: 1,          // 1% 이상 (완화)
  maxVolatility: 20,         // 20% 이하 (완화)
  minPrice: 0.001,           // $0.001 이상 (완화)
  maxPrice: 500,             // $500 이하 (완화)
  spreadThreshold: 0.1,      // 0.1% 이하 스프레드
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
    
    // 5분봉 ATR 범위 완화
    const isOptimal = atrPercent >= 0.1 && atrPercent <= 5;
    
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
  proDirection?: ProDirectionResult; // 🆕 프로 방향 분석 결과
}

export function useCoinScreening(tickers: TickerData[], criteria: Partial<ScreeningCriteria> = {}) {
  const [screenedSymbols, setScreenedSymbols] = useState<ScreenedSymbol[]>([]);
  const [activeSignals, setActiveSignals] = useState<TradingSignal[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState(0);

  const tickersRef = useRef<TickerData[]>([]);
  const isMountedRef = useRef(true);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 🆕 refs (interval/async에서 최신 상태 보장)
  const isScanningRef = useRef(false);
  const criteriaRef = useRef<ScreeningCriteria>({ ...DEFAULT_CRITERIA, ...criteria });

  // criteria 업데이트 (기본값 + 오버라이드)
  useEffect(() => {
    criteriaRef.current = { ...DEFAULT_CRITERIA, ...criteria };
  }, [criteria]);
  
  // Update tickers ref
  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);
  
  // 종목 스크리닝 함수
  const runScreening = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (isScanningRef.current) return;

    const currentTickers = tickersRef.current;
    if (currentTickers.length === 0) return;

    isScanningRef.current = true;
    setIsScanning(true);

    const fullCriteria = criteriaRef.current;
    
    // UI 로그 초기화 및 시작
    clearScreeningLogs();
    addScreeningLog('start', '스크리닝 시작');

    try {
      // 1차 필터링: 기본 조건
      const eligible = currentTickers.filter(t => 
        t.price >= fullCriteria.minPrice &&
        t.price <= fullCriteria.maxPrice &&
        t.volume >= fullCriteria.minVolume &&
        t.volatilityRange >= fullCriteria.minVolatility &&
        t.volatilityRange <= fullCriteria.maxVolatility
      );
      
      addScreeningLog('filter', `1차 필터 통과: ${eligible.length}/${currentTickers.length}개`);

      // 변동성 스코어 기준 정렬
      const scored = eligible
        .map(t => ({
          ...t,
          volatilityScore: calculateVolatilityScore(t.volatilityRange, t.volume),
        }))
        .sort((a, b) => b.volatilityScore - a.volatilityScore)
        .slice(0, 20); // 상위 20개만
      
      addScreeningLog('filter', `분석 대상: ${scored.slice(0, 8).map(s => s.symbol.replace('USDT', '')).join(', ')}${scored.length > 8 ? '...' : ''}`)

      // 2차 분석: 기술적 지표 + ATR
      const analyzed: ScreenedSymbol[] = [];
      const signals: TradingSignal[] = [];

      for (let i = 0; i < scored.length; i++) {
        if (!isMountedRef.current) break;

        const t = scored[i];

        try {
          // ATR 체크
          const atrData = await checkATRVolatility(t.symbol);
          if (!atrData.isOptimal) {
            addScreeningLog('reject', `ATR 부적합 (${atrData.atrPercent.toFixed(2)}%)`, t.symbol);
            continue;
          }

          // 5분봉 기술적 분석
          const klines = await fetch5mKlines(t.symbol, 50);
          if (!klines || klines.length < 30) {
            addScreeningLog('reject', '캔들 데이터 부족', t.symbol);
            continue;
          }

          const indicators = calculateAllIndicators(klines);
          if (!indicators) {
            addScreeningLog('reject', '지표 계산 실패', t.symbol);
            continue;
          }

          // ADX 시장 환경 필터 - 횡보장 차단
          if (indicators.adx < 15) {
            addScreeningLog('reject', `횡보장 (ADX ${indicators.adx.toFixed(1)})`, t.symbol);
            continue;
          }
          
          // 🆕 진입 금지 조건 체크
          const forbidden = await checkForbiddenConditions(t.symbol, indicators, t.price);
          if (!forbidden.allowed) {
            addScreeningLog('reject', forbidden.reason, t.symbol);
            continue;
          }

          // 시그널 체크 (기존 로직)
          const longCheck = checkLongSignal(indicators, t.price);
          const shortCheck = checkShortSignal(indicators, t.price);

          let signal: TradingSignal | null = null;
          let proDirection: ProDirectionResult | undefined;

          if (longCheck.valid || shortCheck.valid) {
            const signalType = longCheck.valid ? 'LONG' : 'SHORT';
            addScreeningLog('signal', `${signalType} 시그널 감지 → 프로 분석중`, t.symbol);
            
            // 🆕 프로 방향 분석 (기존 시그널이 있을 때만)
            proDirection = await getProDirection(t.symbol);
            
            // 프로 시스템 합의 체크
            if (proDirection.position === 'NO_TRADE') {
              addScreeningLog('reject', `PRO NO_TRADE: ${proDirection.reason}`, t.symbol);
              continue;
            }
            
            // 프로 방향과 기존 시그널 방향 일치 확인
            if (proDirection.position === 'LONG' && longCheck.valid) {
              signal = {
                symbol: t.symbol,
                direction: 'long',
                strength: longCheck.strength,
                price: t.price,
                reasons: [
                  `🎯 프로 합의 (${proDirection.confidence.toFixed(0)}%)`,
                  `MTF: ${proDirection.details.mtf.reason}`,
                  ...longCheck.reasons.slice(0, 2),
                ],
                indicators,
                timestamp: Date.now(),
              };
              signals.push(signal);
              addScreeningLog('approve', `LONG 합의 완료! (${proDirection.confidence.toFixed(0)}%)`, t.symbol);
            } else if (proDirection.position === 'SHORT' && shortCheck.valid) {
              signal = {
                symbol: t.symbol,
                direction: 'short',
                strength: shortCheck.strength,
                price: t.price,
                reasons: [
                  `🎯 프로 합의 (${proDirection.confidence.toFixed(0)}%)`,
                  `MTF: ${proDirection.details.mtf.reason}`,
                  ...shortCheck.reasons.slice(0, 2),
                ],
                indicators,
                timestamp: Date.now(),
              };
              signals.push(signal);
              addScreeningLog('approve', `SHORT 합의 완료! (${proDirection.confidence.toFixed(0)}%)`, t.symbol);
            } else {
              // 프로 방향과 기존 시그널 불일치
              addScreeningLog('reject', `방향 불일치 (PRO: ${proDirection.position}, 시그널: ${signalType})`, t.symbol);
              continue;
            }
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
            proDirection, // 🆕 프로 방향 분석 결과
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
      
      // 스크리닝 결과 요약
      if (signals.length > 0) {
        addScreeningLog('complete', `완료! 시그널: ${signals.map(s => `${s.symbol.replace('USDT', '')} ${s.direction.toUpperCase()}`).join(', ')}`);
      } else {
        addScreeningLog('complete', `완료 - 진입 조건 충족 종목 없음 (${analyzed.length}개 분석)`);
      }

    } catch (error) {
      console.error('Screening error:', error);
    } finally {
      isScanningRef.current = false;
      setIsScanning(false);
    }
  }, []);
  
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
