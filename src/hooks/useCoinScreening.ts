/**
 * ⚡ HFT 스캘핑 종목 스크리닝 훅
 * SOLUSDT 전용 초고빈도 스캘핑
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

// ⚡ HFT 타겟: 5종목 (ETH, SOL, XRP, DOGE, SUI)
const HFT_TARGET_SYMBOLS = ['ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'SUIUSDT'];

interface TickerData {
  symbol: string;
  price: number;
  priceChangePercent: number;
  volume: number;
  volatilityRange: number;
}

// 스크리닝 기준 (SOLUSDT 최적화)
interface ScreeningCriteria {
  minVolume: number;
  minVolatility: number;
  maxVolatility: number;
  minPrice: number;
  maxPrice: number;
  spreadThreshold: number;
}

const DEFAULT_CRITERIA: ScreeningCriteria = {
  minVolume: 50_000_000,     // $50M 이상 (SOL은 대량 거래량)
  minVolatility: 0.5,        // 0.5% 이상
  maxVolatility: 5,          // 5% 이하 (HFT 최적)
  minPrice: 10,              // $10 이상
  maxPrice: 500,             // $500 이하
  spreadThreshold: 0.08,     // 0.08% 이하 스프레드
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
  
  // ⚡ HFT 스크리닝: SOLUSDT 전용
  const runScreening = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (isScanningRef.current) return;

    const currentTickers = tickersRef.current;
    if (currentTickers.length === 0) return;

    isScanningRef.current = true;
    setIsScanning(true);
    
    // UI 로그 초기화 및 시작
    clearScreeningLogs();
    addScreeningLog('start', `⚡ HFT 스캔: ${HFT_TARGET_SYMBOLS.join(', ')}`);

    try {
      // ⚡ 타겟 코인들만 찾기
      const targetTickers = currentTickers.filter(t => HFT_TARGET_SYMBOLS.includes(t.symbol));
      
      if (targetTickers.length === 0) {
        addScreeningLog('reject', `타겟 코인 티커 없음`);
        isScanningRef.current = false;
        setIsScanning(false);
        return;
      }
      
      targetTickers.forEach(t => {
        addScreeningLog('filter', `🎯 ${t.symbol} 분석 | $${t.price.toFixed(2)}`);
      });
      
      // 타겟 코인들 분석
      const scored = targetTickers.map(ticker => ({
        ...ticker,
        volatilityScore: 100,
      }));
      
      addScreeningLog('filter', `🎯 분석 대상: ${scored.map(s => s.symbol.replace('USDT', '')).join(', ')}`);

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

          // 🆕 MTF 중심 단순화: 볼린저/RSI 체크 제거, MTF 합의만으로 진입
          let signal: TradingSignal | null = null;
          let proDirection: ProDirectionResult | undefined;

          // MTF 분석 먼저 실행
          addScreeningLog('signal', `MTF 추세 분석중...`, t.symbol);
          proDirection = await getProDirection(t.symbol);
          
          // MTF 합의가 있으면 바로 진입 (볼린저/RSI 체크 생략)
          if (proDirection.position === 'NO_TRADE') {
            addScreeningLog('reject', `MTF 불일치: ${proDirection.reason}`, t.symbol);
            continue;
          }
          
          // MTF 합의 → 해당 방향으로 시그널 생성
          const direction = proDirection.position === 'LONG' ? 'long' : 'short';
          const strength = proDirection.confidence >= 70 ? 'strong' : proDirection.confidence >= 50 ? 'medium' : 'weak';
          
          signal = {
            symbol: t.symbol,
            direction,
            strength,
            price: t.price,
            reasons: [
              `🎯 MTF 합의 (${proDirection.confidence.toFixed(0)}%)`,
              `${proDirection.details.mtf.reason}`,
              `모멘텀: ${proDirection.details.momentum.reason}`,
            ],
            indicators,
            timestamp: Date.now(),
          };
          signals.push(signal);
          addScreeningLog('approve', `${direction.toUpperCase()} 진입! MTF(${proDirection.confidence.toFixed(0)}%)`, t.symbol);

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
  
  // ⚡ 주기적 스캔 (15초 - HFT 최적화)
  useEffect(() => {
    isMountedRef.current = true;
    
    // 초기 스캔
    const initialDelay = setTimeout(() => {
      runScreening();
    }, 1000);
    
    // ⚡ 15초 간격 스캔 (기존 30초 → 15초)
    scanIntervalRef.current = setInterval(runScreening, 15000);
    
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
