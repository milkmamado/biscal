/**
 * 종목 자동 스크리닝 훅
 * 스캘퍼 시스템: 1분봉 변동폭 기반 단순 스캐닝
 * - 현재 완성 중인 캔들 + 직전 2봉까지만 검출 (총 3봉)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { TradingSignal } from './useTechnicalIndicators';
import { addScreeningLog, clearScreeningLogs } from '@/components/ScreeningLogPanel';
import { playSignalAlertSound } from '@/lib/sounds';
import { 
  MAJOR_COIN_CRITERIA,
  isMajorCoin,
  getCoinTier,
} from '@/lib/majorCoins';

interface TickerData {
  symbol: string;
  price: number;
  priceChangePercent: number;
  volume: number;
  volatilityRange: number;
}

// 1분봉 캔들 타입
interface Candle1m {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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

// 1분봉 변동폭 기준 (캔들 고저폭 %)
const MIN_CANDLE_RANGE_PERCENT = 0.5; // 1분봉 캔들 변동폭 0.5% 이상

// 잡코인 모드 기본값
const ALTCOIN_CRITERIA: ScreeningCriteria = {
  minVolume: 10_000_000,    // $10M 이상 (완화)
  minVolatility: 1,          // 1% 이상 (완화)
  maxVolatility: 20,         // 20% 이하 (완화)
  minPrice: 0.01,            // $0.01 이상 (저가 코인 타겟)
  maxPrice: 1,               // $1 이하 (저가 코인만)
  spreadThreshold: 0.1,      // 0.1% 이하 스프레드
};

// 메이저 코인 모드 기본값
const MAJOR_CRITERIA: ScreeningCriteria = {
  minVolume: MAJOR_COIN_CRITERIA.minVolume,
  minVolatility: MAJOR_COIN_CRITERIA.minVolatility,
  maxVolatility: MAJOR_COIN_CRITERIA.maxVolatility,
  minPrice: MAJOR_COIN_CRITERIA.minPrice,
  maxPrice: MAJOR_COIN_CRITERIA.maxPrice,
  spreadThreshold: 0.05,     // 0.05% 이하 (메이저는 스프레드 적음)
};

const DEFAULT_CRITERIA = ALTCOIN_CRITERIA;

// 1분봉 데이터 조회 함수
const fetch1mKlines = async (symbol: string, limit: number = 5): Promise<Candle1m[] | null> => {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=${limit}`);
    const data = await res.json();
    return data.map((k: any) => ({
      time: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch { return null; }
};

// 1분봉 캔들 변동폭 계산 (고가-저가 / 저가 * 100)
function calculateCandleRangePercent(candle: Candle1m): number {
  if (candle.low <= 0) return 0;
  return ((candle.high - candle.low) / candle.low) * 100;
}

// 최근 3봉 중 변동폭 큰 캔들 찾기 (현재 + 직전 2봉)
async function findRecentVolatileCandle(symbol: string): Promise<{
  hasVolatileCandle: boolean;
  maxRangePercent: number;
  candleIndex: number; // 0 = 현재, 1 = 직전1봉, 2 = 직전2봉
  direction: 'long' | 'short';
} | null> {
  const klines = await fetch1mKlines(symbol, 5); // 최근 5봉 가져오기 (안전하게)
  if (!klines || klines.length < 3) return null;
  
  // 최근 3봉만 체크 (인덱스: length-1=현재, length-2=직전1봉, length-3=직전2봉)
  let maxRange = 0;
  let maxIndex = -1;
  let direction: 'long' | 'short' = 'long';
  
  for (let i = 0; i < 3; i++) {
    const idx = klines.length - 1 - i; // 현재, 직전1, 직전2
    if (idx < 0) break;
    
    const candle = klines[idx];
    const range = calculateCandleRangePercent(candle);
    
    if (range > maxRange) {
      maxRange = range;
      maxIndex = i;
      // 캔들 방향: 종가 > 시가면 양봉(롱), 아니면 음봉(숏)
      direction = candle.close >= candle.open ? 'long' : 'short';
    }
  }
  
  return {
    hasVolatileCandle: maxRange >= MIN_CANDLE_RANGE_PERCENT,
    maxRangePercent: maxRange,
    candleIndex: maxIndex,
    direction,
  };
}

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


// 스크리닝된 종목
export interface ScreenedSymbol {
  symbol: string;
  price: number;
  volume: number;
  volatilityRange: number;
  volatilityScore: number;
  signal: TradingSignal | null;
  rank: number;
}

export function useCoinScreening(
  tickers: TickerData[], 
  criteria: Partial<ScreeningCriteria> = {},
  majorCoinMode: boolean = false  // 🆕 메이저 코인 모드
) {
  const [screenedSymbols, setScreenedSymbols] = useState<ScreenedSymbol[]>([]);
  const [activeSignals, setActiveSignals] = useState<TradingSignal[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState(0);
  const [isPaused, setIsPaused] = useState(false); // 🆕 시그널 발견 시 일시정지

  const tickersRef = useRef<TickerData[]>([]);
  const isMountedRef = useRef(true);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 🆕 refs (interval/async에서 최신 상태 보장)
  const isScanningRef = useRef(false);
  const majorCoinModeRef = useRef(majorCoinMode);
  const isPausedRef = useRef(false);
  
  // 🆕 메이저 코인 모드에 따라 기준 선택
  const baseCriteria = majorCoinMode ? MAJOR_CRITERIA : ALTCOIN_CRITERIA;
  const criteriaRef = useRef<ScreeningCriteria>({ ...baseCriteria, ...criteria });

  // criteria 업데이트 (메이저 코인 모드에 따라 기본값 변경)
  useEffect(() => {
    const newBaseCriteria = majorCoinMode ? MAJOR_CRITERIA : ALTCOIN_CRITERIA;
    criteriaRef.current = { ...newBaseCriteria, ...criteria };
    majorCoinModeRef.current = majorCoinMode;
  }, [criteria, majorCoinMode]);
  
  // isPaused ref 동기화
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);
  
  // Update tickers ref
  useEffect(() => {
    tickersRef.current = tickers;
  }, [tickers]);
  
  // 종목 스크리닝 함수
  const runScreening = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (isScanningRef.current) return;
    if (isPausedRef.current) return; // 🆕 일시정지 중이면 스캔 안함

    const currentTickers = tickersRef.current;
    if (currentTickers.length === 0) return;

    isScanningRef.current = true;
    setIsScanning(true);

    const fullCriteria = criteriaRef.current;
    const isMajorMode = majorCoinModeRef.current;
    
    // UI 로그 초기화 및 시작
    clearScreeningLogs();
    addScreeningLog('start', isMajorMode ? '메이저 코인 스크리닝 시작' : '스크리닝 시작');

    try {
      // 🆕 메이저 코인 모드: 화이트리스트 필터링
      let eligible: TickerData[];
      
      if (isMajorMode) {
        // 메이저 코인 화이트리스트만 필터링
        eligible = currentTickers.filter(t => 
          isMajorCoin(t.symbol) &&
          t.volume >= fullCriteria.minVolume &&
          t.volatilityRange >= fullCriteria.minVolatility &&
          t.volatilityRange <= fullCriteria.maxVolatility
        );
        
        const tierInfo = eligible.map(t => {
          const tier = getCoinTier(t.symbol);
          return `${t.symbol.replace('USDT', '')}(T${tier})`;
        }).join(', ');
        addScreeningLog('filter', `메이저 코인: ${eligible.length}개 [${tierInfo}]`);
      } else {
        // 잡코인 모드: 기존 필터링
        eligible = currentTickers.filter(t => 
          t.price >= fullCriteria.minPrice &&
          t.price <= fullCriteria.maxPrice &&
          t.volume >= fullCriteria.minVolume &&
          t.volatilityRange >= fullCriteria.minVolatility &&
          t.volatilityRange <= fullCriteria.maxVolatility
        );
        addScreeningLog('filter', `1차 필터 통과: ${eligible.length}/${currentTickers.length}개`);
      }

      // 변동성 스코어 기준 정렬
      const scored = eligible
        .map(t => ({
          ...t,
          volatilityScore: calculateVolatilityScore(t.volatilityRange, t.volume),
          tier: isMajorMode ? getCoinTier(t.symbol) : null,
        }))
        // 메이저 모드: 티어 우선 정렬, 그 다음 변동성 스코어
        .sort((a, b) => {
          if (isMajorMode && a.tier && b.tier) {
            if (a.tier !== b.tier) return a.tier - b.tier; // 티어 낮을수록 우선
          }
          return b.volatilityScore - a.volatilityScore;
        })
        .slice(0, isMajorMode ? 10 : 20); // 메이저는 최대 10개
      
      const displaySymbols = scored.slice(0, 8).map(s => s.symbol.replace('USDT', '')).join(', ');
      addScreeningLog('filter', `분석 대상: ${displaySymbols}${scored.length > 8 ? '...' : ''}`)

      // 🆕 1분봉 변동폭 기준 시그널 생성 (최근 3봉만 체크)
      const analyzed: ScreenedSymbol[] = [];
      const signals: TradingSignal[] = [];

      addScreeningLog('analyze', `1분봉 변동폭 분석 중... (최근 3봉)`);

      // 상위 거래량/변동성 종목들에서 1분봉 변동폭 체크
      for (let i = 0; i < Math.min(scored.length, 15); i++) {
        const t = scored[i];
        
        // 1분봉 변동폭 체크 (현재 + 직전 2봉)
        const volatileResult = await findRecentVolatileCandle(t.symbol);
        
        if (!volatileResult || !volatileResult.hasVolatileCandle) {
          continue; // 최근 3봉에 변동폭 캔들 없으면 스킵
        }
        
        const { maxRangePercent, candleIndex, direction } = volatileResult;
        const candleLabel = candleIndex === 0 ? '현재봉' : `직전${candleIndex}봉`;
        const strength = maxRangePercent >= 1.0 ? 'strong' : maxRangePercent >= 0.7 ? 'medium' : 'weak';
        
        const signal: TradingSignal = {
          symbol: t.symbol,
          direction,
          strength,
          price: t.price,
          reasons: [
            `🕐 ${candleLabel} 변동폭 ${maxRangePercent.toFixed(2)}%`,
            `거래량 $${(t.volume / 1_000_000).toFixed(1)}M`,
          ],
          indicators: null as any,
          timestamp: Date.now(),
        };
        
        signals.push(signal);
        addScreeningLog('approve', `${direction.toUpperCase()} ${candleLabel} ${maxRangePercent.toFixed(2)}%`, t.symbol);

        analyzed.push({
          symbol: t.symbol,
          price: t.price,
          volume: t.volume,
          volatilityRange: maxRangePercent, // 1분봉 변동폭으로 대체
          volatilityScore: maxRangePercent * 100, // 변동폭 기반 스코어
          signal,
          rank: analyzed.length + 1,
        });
        
        // 최대 5개까지만 수집
        if (analyzed.length >= 5) break;
        
        // API 부하 방지
        await new Promise(resolve => setTimeout(resolve, 30));
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
      
      // 🆕 시그널 발견 시 자동 일시정지 + 알림 사운드
      if (signals.length > 0) {
        setIsPaused(true);
        playSignalAlertSound(); // 페이드 인/아웃 5초 알림음
        addScreeningLog('complete', `⏸️ 시그널 발견! 자동 스캔 일시정지 (패스하면 재개)`);
        addScreeningLog('approve', `${signals.map(s => `${s.symbol.replace('USDT', '')} ${s.direction.toUpperCase()}`).join(', ')}`);
      } else {
        addScreeningLog('complete', `완료 - 최근 3봉 변동폭 시그널 없음 (${scored.length}개 분석)`);
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
  
  // 🆕 패스: 현재 시그널 무시하고 다음 시그널로 이동 (또는 스캔 재개)
  const passSignal = useCallback((): string | null => {
    let nextSymbol: string | null = null;
    
    setActiveSignals(prev => {
      if (prev.length > 1) {
        // 다음 시그널이 있으면 첫 번째 제거하고 두 번째로 이동
        const remaining = prev.slice(1);
        nextSymbol = remaining[0]?.symbol || null;
        addScreeningLog('start', `패스! 다음 시그널: ${nextSymbol?.replace('USDT', '')}`);
        return remaining;
      } else {
        // 시그널이 하나뿐이면 전부 비우고 스캔 재개
        nextSymbol = null;
        return [];
      }
    });
    
    setScreenedSymbols(prev => {
      if (prev.length > 1) {
        return prev.slice(1);
      }
      return [];
    });
    
    // 시그널이 더 없으면 스캔 재개
    if (nextSymbol === null) {
      setIsPaused(false);
      addScreeningLog('start', '패스! 시그널 없음, 스캔 재개...');
      setTimeout(() => runScreening(), 500);
    }
    
    return nextSymbol;
  }, [runScreening]);
  
  // 🆕 스캔 일시정지/재개
  const togglePause = useCallback(() => {
    setIsPaused(prev => {
      const newValue = !prev;
      if (!newValue) {
        addScreeningLog('start', '스캔 재개');
        setTimeout(() => runScreening(), 500);
      } else {
        addScreeningLog('complete', '스캔 일시정지');
      }
      return newValue;
    });
  }, [runScreening]);
  
  // 특정 심볼 분석 (간소화)
  const analyzeSymbol = useCallback(async (symbol: string): Promise<TradingSignal | null> => {
    const ticker = tickersRef.current.find(t => t.symbol === symbol);
    if (!ticker) return null;
    
    const direction = ticker.priceChangePercent >= 0 ? 'long' : 'short';
    const volatilityScore = calculateVolatilityScore(ticker.volatilityRange, ticker.volume);
    const strength = volatilityScore >= 80 ? 'strong' : volatilityScore >= 60 ? 'medium' : 'weak';
    
    return {
      symbol,
      direction,
      strength,
      price: ticker.price,
      reasons: [
        `📊 변동폭 ${ticker.volatilityRange.toFixed(2)}%`,
        `거래량 $${(ticker.volume / 1_000_000).toFixed(1)}M`,
      ],
      indicators: null as any,
      timestamp: Date.now(),
    };
  }, []);
  
  return {
    screenedSymbols,
    activeSignals,
    isScanning,
    isPaused,
    lastScanTime,
    manualScan,
    passSignal,
    togglePause,
    analyzeSymbol,
  };
}
