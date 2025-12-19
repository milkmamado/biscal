/**
 * 프로 스캘퍼 포지션 방향 결정 시스템
 * 
 * 4가지 분석을 종합하여 합의(Voting) 기반 의사결정:
 * 1. 다중 시간대 추세 (MTF Confluence)
 * 2. 프라이스 액션 확인 (Price Action Confirmation)
 * 3. 오더북 압력 분석 (이미 별도 훅에서 처리)
 * 4. 모멘텀 방향 측정
 */

import { Kline, TechnicalIndicators, calculateAllIndicators } from './useTechnicalIndicators';

// ===== 타입 정의 =====

export type DirectionVote = 'LONG' | 'SHORT' | 'NO_TRADE';
export type TrendDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface MTFAnalysis {
  trend15m: TrendDirection;
  trend5m: TrendDirection;
  trend1m: TrendDirection;
  aligned: boolean;
  direction: DirectionVote;
  reason: string;
}

export interface PriceActionConfirmation {
  higherLow: boolean;      // 저점 높아짐 (롱)
  lowerHigh: boolean;      // 고점 낮아짐 (숏)
  strongCandle: boolean;   // 강한 캔들
  volumeSurge: boolean;    // 거래량 급증
  breakLevel: boolean;     // 저항/지지 돌파
  confirmed: boolean;
  strength: number;        // 0-4
  direction: DirectionVote;
  details: string[];
}

export interface MomentumAnalysis {
  bullishCandles: number;
  bearishCandles: number;
  priceChange5m: number;
  volumeTrend: 'INCREASING' | 'DECREASING' | 'STABLE';
  direction: DirectionVote;
  strength: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
}

export interface ProDirectionResult {
  position: DirectionVote;
  confidence: number;      // 0-100%
  reason: string;
  votes: {
    mtf: DirectionVote;
    priceAction: DirectionVote;
    momentum: DirectionVote;
  };
  details: {
    mtf: MTFAnalysis;
    priceAction: PriceActionConfirmation;
    momentum: MomentumAnalysis;
  };
}

// ===== 캔들 데이터 가져오기 =====

export async function fetchKlines(symbol: string, interval: string, limit: number = 50): Promise<Kline[] | null> {
  try {
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data.map((k: any[]) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
    }));
  } catch {
    return null;
  }
}

// ===== 1. 다중 시간대 추세 분석 (MTF Confluence) =====

/**
 * EMA 기반 추세 판단
 * - EMA8 > EMA21 > EMA50 + 가격 > EMA8 = BULLISH
 * - EMA8 < EMA21 < EMA50 + 가격 < EMA8 = BEARISH
 */
function getTrendDirection(indicators: TechnicalIndicators, currentPrice: number): TrendDirection {
  const { ema8, ema21, sma20 } = indicators;
  
  // EMA50 대신 SMA20 사용 (볼린저밴드 중앙선)
  const ema50Proxy = sma20;
  
  // 명확한 상승 추세
  if (ema8 > ema21 && ema21 > ema50Proxy && currentPrice > ema8) {
    return 'BULLISH';
  }
  
  // 명확한 하락 추세
  if (ema8 < ema21 && ema21 < ema50Proxy && currentPrice < ema8) {
    return 'BEARISH';
  }
  
  return 'NEUTRAL';
}

/**
 * 다중 시간대 추세 합의 분석
 */
export async function analyzeMTF(symbol: string): Promise<MTFAnalysis> {
  const result: MTFAnalysis = {
    trend15m: 'NEUTRAL',
    trend5m: 'NEUTRAL',
    trend1m: 'NEUTRAL',
    aligned: false,
    direction: 'NO_TRADE',
    reason: '데이터 부족',
  };
  
  try {
    // 병렬로 캔들 데이터 가져오기
    const [klines15m, klines5m, klines1m] = await Promise.all([
      fetchKlines(symbol, '15m', 50),
      fetchKlines(symbol, '5m', 50),
      fetchKlines(symbol, '1m', 30),
    ]);
    
    if (!klines15m || !klines5m || !klines1m) {
      return result;
    }
    
    // 각 시간대별 지표 계산
    const indicators15m = calculateAllIndicators(klines15m);
    const indicators5m = calculateAllIndicators(klines5m);
    const indicators1m = calculateAllIndicators(klines1m);
    
    if (!indicators15m || !indicators5m || !indicators1m) {
      return result;
    }
    
    const price15m = klines15m[klines15m.length - 1].close;
    const price5m = klines5m[klines5m.length - 1].close;
    const price1m = klines1m[klines1m.length - 1].close;
    
    result.trend15m = getTrendDirection(indicators15m, price15m);
    result.trend5m = getTrendDirection(indicators5m, price5m);
    result.trend1m = getTrendDirection(indicators1m, price1m);
    
    // 추세 합의 체크 (C 옵션: NEUTRAL 허용)
    // 완전 합의: 둘 다 같은 방향
    if (result.trend15m === 'BULLISH' && result.trend5m === 'BULLISH') {
      result.aligned = true;
      result.direction = 'LONG';
      result.reason = '15분+5분 상승 추세 합의';
    } else if (result.trend15m === 'BEARISH' && result.trend5m === 'BEARISH') {
      result.aligned = true;
      result.direction = 'SHORT';
      result.reason = '15분+5분 하락 추세 합의';
    }
    // NEUTRAL 허용: 한쪽이 NEUTRAL이고 다른 쪽이 강한 신호일 때
    else if (result.trend15m === 'BULLISH' && result.trend5m === 'NEUTRAL') {
      result.aligned = true;
      result.direction = 'LONG';
      result.reason = '15분 상승 + 5분 중립 (NEUTRAL 허용)';
    } else if (result.trend15m === 'NEUTRAL' && result.trend5m === 'BULLISH') {
      result.aligned = true;
      result.direction = 'LONG';
      result.reason = '15분 중립 + 5분 상승 (NEUTRAL 허용)';
    } else if (result.trend15m === 'BEARISH' && result.trend5m === 'NEUTRAL') {
      result.aligned = true;
      result.direction = 'SHORT';
      result.reason = '15분 하락 + 5분 중립 (NEUTRAL 허용)';
    } else if (result.trend15m === 'NEUTRAL' && result.trend5m === 'BEARISH') {
      result.aligned = true;
      result.direction = 'SHORT';
      result.reason = '15분 중립 + 5분 하락 (NEUTRAL 허용)';
    }
    // 반대 방향이거나 둘 다 NEUTRAL
    else {
      result.aligned = false;
      result.direction = 'NO_TRADE';
      result.reason = `시간대 불일치 (15m: ${result.trend15m}, 5m: ${result.trend5m})`;
    }
    
  } catch (error) {
    console.error('[MTF] 분석 실패:', error);
  }
  
  return result;
}

// ===== 2. 프라이스 액션 확인 (Price Action Confirmation) =====

/**
 * 롱 방향 확인 신호
 */
function checkBullishConfirmation(klines: Kline[]): PriceActionConfirmation {
  const result: PriceActionConfirmation = {
    higherLow: false,
    lowerHigh: false,
    strongCandle: false,
    volumeSurge: false,
    breakLevel: false,
    confirmed: false,
    strength: 0,
    direction: 'NO_TRADE',
    details: [],
  };
  
  if (klines.length < 5) return result;
  
  const lastCandle = klines[klines.length - 1];
  const prevCandle = klines[klines.length - 2];
  
  // 1. 저점 높아짐 (Higher Low)
  if (lastCandle.low > prevCandle.low) {
    result.higherLow = true;
    result.details.push('저점 상승 (Higher Low)');
    result.strength++;
  }
  
  // 2. 강한 양봉 출현 (몸통 60% 이상)
  const bodySize = Math.abs(lastCandle.close - lastCandle.open);
  const candleRange = lastCandle.high - lastCandle.low;
  if (lastCandle.close > lastCandle.open && candleRange > 0 && bodySize > candleRange * 0.6) {
    result.strongCandle = true;
    result.details.push(`강한 양봉 (${((bodySize / candleRange) * 100).toFixed(0)}%)`);
    result.strength++;
  }
  
  // 3. 거래량 급증 (130% 이상)
  const recentVolumes = klines.slice(-20, -1).map(k => k.volume);
  const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
  if (lastCandle.volume > avgVolume * 1.3) {
    result.volumeSurge = true;
    result.details.push(`거래량 급증 (${((lastCandle.volume / avgVolume) * 100).toFixed(0)}%)`);
    result.strength++;
  }
  
  // 4. 단기 저항선 돌파
  const recentHighs = klines.slice(-10, -1).map(k => k.high);
  const resistance = Math.max(...recentHighs);
  if (lastCandle.close > resistance) {
    result.breakLevel = true;
    result.details.push('저항선 돌파');
    result.strength++;
  }
  
  // 3개 이상 충족시 확정
  result.confirmed = result.strength >= 3;
  if (result.confirmed) {
    result.direction = 'LONG';
  }
  
  return result;
}

/**
 * 숏 방향 확인 신호
 */
function checkBearishConfirmation(klines: Kline[]): PriceActionConfirmation {
  const result: PriceActionConfirmation = {
    higherLow: false,
    lowerHigh: false,
    strongCandle: false,
    volumeSurge: false,
    breakLevel: false,
    confirmed: false,
    strength: 0,
    direction: 'NO_TRADE',
    details: [],
  };
  
  if (klines.length < 5) return result;
  
  const lastCandle = klines[klines.length - 1];
  const prevCandle = klines[klines.length - 2];
  
  // 1. 고점 낮아짐 (Lower High)
  if (lastCandle.high < prevCandle.high) {
    result.lowerHigh = true;
    result.details.push('고점 하락 (Lower High)');
    result.strength++;
  }
  
  // 2. 강한 음봉 출현 (몸통 60% 이상)
  const bodySize = Math.abs(lastCandle.open - lastCandle.close);
  const candleRange = lastCandle.high - lastCandle.low;
  if (lastCandle.close < lastCandle.open && candleRange > 0 && bodySize > candleRange * 0.6) {
    result.strongCandle = true;
    result.details.push(`강한 음봉 (${((bodySize / candleRange) * 100).toFixed(0)}%)`);
    result.strength++;
  }
  
  // 3. 거래량 급증 (130% 이상)
  const recentVolumes = klines.slice(-20, -1).map(k => k.volume);
  const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
  if (lastCandle.volume > avgVolume * 1.3) {
    result.volumeSurge = true;
    result.details.push(`거래량 급증 (${((lastCandle.volume / avgVolume) * 100).toFixed(0)}%)`);
    result.strength++;
  }
  
  // 4. 단기 지지선 붕괴
  const recentLows = klines.slice(-10, -1).map(k => k.low);
  const support = Math.min(...recentLows);
  if (lastCandle.close < support) {
    result.breakLevel = true;
    result.details.push('지지선 붕괴');
    result.strength++;
  }
  
  // 3개 이상 충족시 확정
  result.confirmed = result.strength >= 3;
  if (result.confirmed) {
    result.direction = 'SHORT';
  }
  
  return result;
}

/**
 * 프라이스 액션 분석 (MTF 방향에 따라)
 */
export async function analyzePriceAction(symbol: string, expectedDirection: DirectionVote): Promise<PriceActionConfirmation> {
  try {
    const klines = await fetchKlines(symbol, '1m', 30);
    if (!klines) {
      return {
        higherLow: false,
        lowerHigh: false,
        strongCandle: false,
        volumeSurge: false,
        breakLevel: false,
        confirmed: false,
        strength: 0,
        direction: 'NO_TRADE',
        details: ['데이터 부족'],
      };
    }
    
    if (expectedDirection === 'LONG') {
      return checkBullishConfirmation(klines);
    } else if (expectedDirection === 'SHORT') {
      return checkBearishConfirmation(klines);
    }
    
    return {
      higherLow: false,
      lowerHigh: false,
      strongCandle: false,
      volumeSurge: false,
      breakLevel: false,
      confirmed: false,
      strength: 0,
      direction: 'NO_TRADE',
      details: ['방향 미정'],
    };
  } catch {
    return {
      higherLow: false,
      lowerHigh: false,
      strongCandle: false,
      volumeSurge: false,
      breakLevel: false,
      confirmed: false,
      strength: 0,
      direction: 'NO_TRADE',
      details: ['분석 실패'],
    };
  }
}

// ===== 3. 모멘텀 방향 측정 =====

/**
 * 모멘텀 기반 방향 결정
 * "이미 움직이는 방향으로 타라"
 */
export async function analyzeMomentum(symbol: string): Promise<MomentumAnalysis> {
  const result: MomentumAnalysis = {
    bullishCandles: 0,
    bearishCandles: 0,
    priceChange5m: 0,
    volumeTrend: 'STABLE',
    direction: 'NO_TRADE',
    strength: 'LOW',
    reason: '데이터 부족',
  };
  
  try {
    const klines = await fetchKlines(symbol, '1m', 10);
    if (!klines || klines.length < 5) return result;
    
    // 최근 5개 캔들 분석
    const recent5 = klines.slice(-5);
    
    // 상승/하락 캔들 카운트
    recent5.forEach(k => {
      if (k.close > k.open) result.bullishCandles++;
      else if (k.close < k.open) result.bearishCandles++;
    });
    
    // 5분간 가격 변화율
    const firstPrice = recent5[0].open;
    const lastPrice = recent5[recent5.length - 1].close;
    result.priceChange5m = ((lastPrice - firstPrice) / firstPrice) * 100;
    
    // 거래량 트렌드
    const firstVolume = recent5[0].volume;
    const lastVolume = recent5[recent5.length - 1].volume;
    if (lastVolume > firstVolume * 1.2) {
      result.volumeTrend = 'INCREASING';
    } else if (lastVolume < firstVolume * 0.8) {
      result.volumeTrend = 'DECREASING';
    } else {
      result.volumeTrend = 'STABLE';
    }
    
    // 모멘텀 강도 판단
    // 강한 상승 모멘텀: 4/5 양봉 + 0.2% 이상 상승 + 거래량 증가
    if (result.bullishCandles >= 4 && result.priceChange5m > 0.2 && result.volumeTrend === 'INCREASING') {
      result.direction = 'LONG';
      result.strength = 'HIGH';
      result.reason = `강한 상승 모멘텀 (${result.bullishCandles}/5 양봉, +${result.priceChange5m.toFixed(2)}%)`;
    }
    // 강한 하락 모멘텀: 4/5 음봉 + 0.2% 이상 하락 + 거래량 증가
    else if (result.bearishCandles >= 4 && result.priceChange5m < -0.2 && result.volumeTrend === 'INCREASING') {
      result.direction = 'SHORT';
      result.strength = 'HIGH';
      result.reason = `강한 하락 모멘텀 (${result.bearishCandles}/5 음봉, ${result.priceChange5m.toFixed(2)}%)`;
    }
    // 약한 상승 모멘텀
    else if (result.bullishCandles >= 3 && result.priceChange5m > 0.1) {
      result.direction = 'LONG';
      result.strength = 'MEDIUM';
      result.reason = `상승 모멘텀 (${result.bullishCandles}/5 양봉)`;
    }
    // 약한 하락 모멘텀
    else if (result.bearishCandles >= 3 && result.priceChange5m < -0.1) {
      result.direction = 'SHORT';
      result.strength = 'MEDIUM';
      result.reason = `하락 모멘텀 (${result.bearishCandles}/5 음봉)`;
    }
    else {
      result.direction = 'NO_TRADE';
      result.strength = 'LOW';
      result.reason = '모멘텀 약함/혼조';
    }
    
  } catch (error) {
    console.error('[Momentum] 분석 실패:', error);
  }
  
  return result;
}

// ===== 4. 통합 투표 시스템 =====

/**
 * 최종 포지션 방향 결정 (프로 시스템)
 * 4개 중 3개 이상 합의 필요
 */
export async function getProDirection(symbol: string): Promise<ProDirectionResult> {
  const result: ProDirectionResult = {
    position: 'NO_TRADE',
    confidence: 0,
    reason: '분석 중...',
    votes: {
      mtf: 'NO_TRADE',
      priceAction: 'NO_TRADE',
      momentum: 'NO_TRADE',
    },
    details: {
      mtf: {
        trend15m: 'NEUTRAL',
        trend5m: 'NEUTRAL',
        trend1m: 'NEUTRAL',
        aligned: false,
        direction: 'NO_TRADE',
        reason: '분석 중',
      },
      priceAction: {
        higherLow: false,
        lowerHigh: false,
        strongCandle: false,
        volumeSurge: false,
        breakLevel: false,
        confirmed: false,
        strength: 0,
        direction: 'NO_TRADE',
        details: [],
      },
      momentum: {
        bullishCandles: 0,
        bearishCandles: 0,
        priceChange5m: 0,
        volumeTrend: 'STABLE',
        direction: 'NO_TRADE',
        strength: 'LOW',
        reason: '분석 중',
      },
    },
  };
  
  try {
    // 1. MTF 분석 (가장 중요)
    const mtf = await analyzeMTF(symbol);
    result.details.mtf = mtf;
    result.votes.mtf = mtf.direction;
    
    // MTF 추세 불일치면 즉시 NO_TRADE
    if (mtf.direction === 'NO_TRADE') {
      result.position = 'NO_TRADE';
      result.confidence = 0;
      result.reason = `MTF 추세 불일치: ${mtf.reason}`;
      console.log(`[PRO] ${symbol} MTF 불일치 → NO_TRADE`);
      return result;
    }
    
    // 2. 프라이스 액션 확인 (MTF 방향에 맞춰)
    const priceAction = await analyzePriceAction(symbol, mtf.direction);
    result.details.priceAction = priceAction;
    result.votes.priceAction = priceAction.direction;
    
    // 3. 모멘텀 분석
    const momentum = await analyzeMomentum(symbol);
    result.details.momentum = momentum;
    result.votes.momentum = momentum.direction;
    
    // === 투표 집계 ===
    const votes = {
      LONG: 0,
      SHORT: 0,
      NO_TRADE: 0,
    };
    
    // MTF는 가중치 2 (더 중요)
    if (mtf.direction === 'LONG') votes.LONG += 2;
    else if (mtf.direction === 'SHORT') votes.SHORT += 2;
    else votes.NO_TRADE += 2;
    
    // 프라이스 액션
    if (priceAction.direction === 'LONG') votes.LONG += 1;
    else if (priceAction.direction === 'SHORT') votes.SHORT += 1;
    else votes.NO_TRADE += 1;
    
    // 모멘텀
    if (momentum.direction === 'LONG') votes.LONG += 1;
    else if (momentum.direction === 'SHORT') votes.SHORT += 1;
    else votes.NO_TRADE += 1;
    
    // 총 4점 중 최소 3점 이상 필요 (MTF 2점 + 나머지 1점 이상)
    const totalVotes = votes.LONG + votes.SHORT + votes.NO_TRADE; // 항상 4
    
    if (votes.LONG >= 3) {
      result.position = 'LONG';
      result.confidence = (votes.LONG / totalVotes) * 100;
      result.reason = '롱 합의 (MTF + 추가 확인)';
    } else if (votes.SHORT >= 3) {
      result.position = 'SHORT';
      result.confidence = (votes.SHORT / totalVotes) * 100;
      result.reason = '숏 합의 (MTF + 추가 확인)';
    } else {
      result.position = 'NO_TRADE';
      result.confidence = 0;
      result.reason = `합의 부족 (롱: ${votes.LONG}, 숏: ${votes.SHORT})`;
    }
    
    console.log(`[PRO] ${symbol} 투표: LONG=${votes.LONG} SHORT=${votes.SHORT} → ${result.position} (${result.confidence.toFixed(0)}%)`);
    
  } catch (error) {
    console.error('[PRO] 분석 실패:', error);
    result.reason = '분석 실패';
  }
  
  return result;
}

// ===== 진입 금지 조건 체크 =====

export interface ForbiddenCheckResult {
  allowed: boolean;
  reason: string;
}

/**
 * 진입 금지 조건 체크
 */
export async function checkForbiddenConditions(
  symbol: string, 
  indicators: TechnicalIndicators,
  currentPrice: number
): Promise<ForbiddenCheckResult> {
  // 1. 변동성 극단 (ATR 2.5배 이상)
  const atrPercent = (indicators.atr / currentPrice) * 100;
  if (atrPercent > 2.0) {
    return { allowed: false, reason: `극단적 변동성 (ATR ${atrPercent.toFixed(2)}%)` };
  }
  
  // 2. 유동성 고갈 (거래량 30% 미만)
  if (indicators.volumeRatio < 0.3) {
    return { allowed: false, reason: `유동성 부족 (거래량 ${(indicators.volumeRatio * 100).toFixed(0)}%)` };
  }
  
  // 3. ADX 극단 (추세 없음 또는 너무 강함)
  if (indicators.adx < 15) {
    return { allowed: false, reason: `횡보장 (ADX ${indicators.adx.toFixed(1)})` };
  }
  if (indicators.adx > 50) {
    return { allowed: false, reason: `과열 추세 (ADX ${indicators.adx.toFixed(1)})` };
  }
  
  return { allowed: true, reason: '조건 충족' };
}
