/**
 * 기술적 지표 계산 훅
 * RSI, EMA, MACD, 볼린저밴드, ADX, CCI, 스토캐스틱, Williams %R
 */

// 기술적 지표 인터페이스
export interface TechnicalIndicators {
  rsi: number;         // RSI(14)
  ema8: number;        // EMA(8)
  ema21: number;       // EMA(21)
  macd: number;        // MACD
  macdSignal: number;  // MACD 시그널
  macdHistogram: number; // MACD 히스토그램
  upperBand: number;   // 볼린저밴드 상단
  lowerBand: number;   // 볼린저밴드 하단
  sma20: number;       // 볼린저밴드 중앙
  adx: number;         // ADX(14)
  cci: number;         // CCI(20)
  stochK: number;      // 스토캐스틱 %K
  stochD: number;      // 스토캐스틱 %D
  williamsR: number;   // Williams %R
  atr: number;         // ATR(14)
  volumeRatio: number; // 현재 거래량 / 20일 평균
}

// 캔들 데이터 인터페이스
export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

// EMA 계산
function calculateEMA(closes: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  
  // 첫 EMA는 SMA
  const sma = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(sma);
  
  for (let i = period; i < closes.length; i++) {
    const newEma = (closes[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
    ema.push(newEma);
  }
  
  return ema;
}

// SMA 계산
function calculateSMA(data: number[], period: number): number {
  if (data.length < period) return 0;
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// RSI 계산 (14 기간)
function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;
  
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }
  
  const recentChanges = changes.slice(-period);
  let gains = 0;
  let losses = 0;
  
  recentChanges.forEach(change => {
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  });
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// MACD 계산 (12, 26, 9)
function calculateMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  
  // MACD = EMA12 - EMA26
  const macdLine: number[] = [];
  const minLen = Math.min(ema12.length, ema26.length);
  for (let i = 0; i < minLen; i++) {
    const ema12Val = ema12[ema12.length - minLen + i];
    const ema26Val = ema26[ema26.length - minLen + i];
    macdLine.push(ema12Val - ema26Val);
  }
  
  if (macdLine.length < 9) {
    const lastMacd = macdLine[macdLine.length - 1] || 0;
    return { macd: lastMacd, signal: lastMacd, histogram: 0 };
  }
  
  // Signal Line = EMA(MACD, 9)
  const signalLine = calculateEMA(macdLine, 9);
  
  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  
  return {
    macd,
    signal,
    histogram: macd - signal,
  };
}

// 볼린저밴드 계산 (20, 2)
function calculateBollingerBands(closes: number[], period: number = 20, multiplier: number = 2): { upper: number; lower: number; sma: number } {
  if (closes.length < period) return { upper: 0, lower: 0, sma: 0 };
  
  const slice = closes.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;
  
  const squaredDiffs = slice.map(c => Math.pow(c - sma, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(variance);
  
  return {
    upper: sma + (multiplier * stdDev),
    lower: sma - (multiplier * stdDev),
    sma,
  };
}

// ADX 계산 (14 기간)
function calculateADX(klines: Kline[], period: number = 14): number {
  if (klines.length < period * 2) return 25; // 기본값
  
  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  
  for (let i = 1; i < klines.length; i++) {
    const curr = klines[i];
    const prev = klines[i - 1];
    
    // True Range
    const trVal = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    tr.push(trVal);
    
    // +DM, -DM
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  
  if (tr.length < period) return 25;
  
  // 평활화
  const smoothTR = calculateSMA(tr.slice(-period), period) * period;
  const smoothPlusDM = calculateSMA(plusDM.slice(-period), period) * period;
  const smoothMinusDM = calculateSMA(minusDM.slice(-period), period) * period;
  
  if (smoothTR === 0) return 25;
  
  const plusDI = (smoothPlusDM / smoothTR) * 100;
  const minusDI = (smoothMinusDM / smoothTR) * 100;
  
  const diSum = plusDI + minusDI;
  if (diSum === 0) return 25;
  
  const dx = Math.abs(plusDI - minusDI) / diSum * 100;
  
  return dx;
}

// CCI 계산 (20 기간)
function calculateCCI(klines: Kline[], period: number = 20): number {
  if (klines.length < period) return 0;
  
  const typicalPrices = klines.slice(-period).map(k => (k.high + k.low + k.close) / 3);
  const sma = typicalPrices.reduce((a, b) => a + b, 0) / period;
  
  const meanDeviation = typicalPrices.reduce((sum, tp) => sum + Math.abs(tp - sma), 0) / period;
  
  if (meanDeviation === 0) return 0;
  
  const latestTP = typicalPrices[typicalPrices.length - 1];
  return (latestTP - sma) / (0.015 * meanDeviation);
}

// 스토캐스틱 계산 (14, 3, 3)
function calculateStochastic(klines: Kline[], kPeriod: number = 14, dPeriod: number = 3): { k: number; d: number } {
  if (klines.length < kPeriod) return { k: 50, d: 50 };
  
  const kValues: number[] = [];
  
  for (let i = kPeriod - 1; i < klines.length; i++) {
    const slice = klines.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...slice.map(k => k.high));
    const low = Math.min(...slice.map(k => k.low));
    const close = slice[slice.length - 1].close;
    
    const k = high === low ? 50 : ((close - low) / (high - low)) * 100;
    kValues.push(k);
  }
  
  const k = kValues[kValues.length - 1];
  const d = kValues.length >= dPeriod 
    ? calculateSMA(kValues.slice(-dPeriod), dPeriod)
    : k;
  
  return { k, d };
}

// Williams %R 계산 (14 기간)
function calculateWilliamsR(klines: Kline[], period: number = 14): number {
  if (klines.length < period) return -50;
  
  const slice = klines.slice(-period);
  const high = Math.max(...slice.map(k => k.high));
  const low = Math.min(...slice.map(k => k.low));
  const close = slice[slice.length - 1].close;
  
  if (high === low) return -50;
  
  return ((high - close) / (high - low)) * -100;
}

// ATR 계산 (14 기간)
function calculateATR(klines: Kline[], period: number = 14): number {
  if (klines.length < period + 1) return 0;
  
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
  
  return calculateSMA(tr.slice(-period), period);
}

// 거래량 비율 계산
function calculateVolumeRatio(klines: Kline[], period: number = 20): number {
  if (klines.length < period) return 1;
  
  const volumes = klines.slice(-period - 1, -1).map(k => k.volume);
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const currentVolume = klines[klines.length - 1].volume;
  
  return avgVolume > 0 ? currentVolume / avgVolume : 1;
}

// 종합 기술적 지표 계산
export function calculateAllIndicators(klines: Kline[]): TechnicalIndicators | null {
  if (klines.length < 30) return null;
  
  const closes = klines.map(k => k.close);
  
  // EMA 계산
  const ema8Array = calculateEMA(closes, 8);
  const ema21Array = calculateEMA(closes, 21);
  
  // MACD
  const macdData = calculateMACD(closes);
  
  // 볼린저밴드
  const bb = calculateBollingerBands(closes, 20, 2);
  
  // 스토캐스틱
  const stoch = calculateStochastic(klines, 14, 3);
  
  return {
    rsi: calculateRSI(closes, 14),
    ema8: ema8Array[ema8Array.length - 1] || closes[closes.length - 1],
    ema21: ema21Array[ema21Array.length - 1] || closes[closes.length - 1],
    macd: macdData.macd,
    macdSignal: macdData.signal,
    macdHistogram: macdData.histogram,
    upperBand: bb.upper,
    lowerBand: bb.lower,
    sma20: bb.sma,
    adx: calculateADX(klines, 14),
    cci: calculateCCI(klines, 20),
    stochK: stoch.k,
    stochD: stoch.d,
    williamsR: calculateWilliamsR(klines, 14),
    atr: calculateATR(klines, 14),
    volumeRatio: calculateVolumeRatio(klines, 20),
  };
}

// 트레이딩 시그널 타입
export interface TradingSignal {
  symbol: string;
  direction: 'long' | 'short';
  strength: 'weak' | 'medium' | 'strong';
  price: number;
  reasons: string[];
  indicators: TechnicalIndicators;
  timestamp: number;
}

// 롱 시그널 체크
export function checkLongSignal(indicators: TechnicalIndicators, price: number): { valid: boolean; strength: 'weak' | 'medium' | 'strong'; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  
  // 1. RSI < 30 (과매도) - 핵심
  if (indicators.rsi < 30) {
    reasons.push(`RSI 과매도 (${indicators.rsi.toFixed(1)})`);
    score += 2;
  } else if (indicators.rsi < 40) {
    reasons.push(`RSI 약세 (${indicators.rsi.toFixed(1)})`);
    score += 1;
  }
  
  // 2. EMA 골든크로스 (EMA8 > EMA21)
  if (indicators.ema8 > indicators.ema21) {
    const crossStrength = ((indicators.ema8 - indicators.ema21) / indicators.ema21) * 100;
    if (crossStrength > 0.1) {
      reasons.push(`EMA 골든크로스 (+${crossStrength.toFixed(2)}%)`);
      score += 2;
    }
  }
  
  // 3. MACD 히스토그램 상승 전환
  if (indicators.macdHistogram > 0 && indicators.macd > indicators.macdSignal) {
    reasons.push('MACD 상승 전환');
    score += 2;
  }
  
  // 4. 볼린저밴드 하단 터치
  const lowerBandDist = ((price - indicators.lowerBand) / indicators.lowerBand) * 100;
  if (lowerBandDist <= 0.3) {
    reasons.push(`BB 하단 터치 (${lowerBandDist.toFixed(2)}%)`);
    score += 2;
  }
  
  // 5. 거래량 200% 이상
  if (indicators.volumeRatio >= 2.0) {
    reasons.push(`거래량 급증 (${(indicators.volumeRatio * 100).toFixed(0)}%)`);
    score += 1;
  }
  
  // 6. ADX > 20 (강한 추세)
  if (indicators.adx > 20) {
    reasons.push(`강한 추세 (ADX ${indicators.adx.toFixed(1)})`);
    score += 1;
  }
  
  // 7. Williams %R < -80 (과매도)
  if (indicators.williamsR < -80) {
    reasons.push(`Williams %R 과매도 (${indicators.williamsR.toFixed(1)})`);
    score += 1;
  }
  
  // 8. CCI < -100 (강한 과매도)
  if (indicators.cci < -100) {
    reasons.push(`CCI 과매도 (${indicators.cci.toFixed(0)})`);
    score += 1;
  }
  
  // 9. 스토캐스틱 과매도
  if (indicators.stochK < 20 && indicators.stochD < 20) {
    reasons.push(`스토캐스틱 과매도 (%K ${indicators.stochK.toFixed(1)})`);
    score += 1;
  }
  
  // 최소 3개 이상 조건 충족 필요
  const valid = reasons.length >= 3 && score >= 5;
  
  let strength: 'weak' | 'medium' | 'strong' = 'weak';
  if (score >= 8) strength = 'strong';
  else if (score >= 6) strength = 'medium';
  
  return { valid, strength, reasons };
}

// 숏 시그널 체크
export function checkShortSignal(indicators: TechnicalIndicators, price: number): { valid: boolean; strength: 'weak' | 'medium' | 'strong'; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  
  // 1. RSI > 70 (과매수) - 핵심
  if (indicators.rsi > 70) {
    reasons.push(`RSI 과매수 (${indicators.rsi.toFixed(1)})`);
    score += 2;
  } else if (indicators.rsi > 60) {
    reasons.push(`RSI 강세 (${indicators.rsi.toFixed(1)})`);
    score += 1;
  }
  
  // 2. EMA 데드크로스 (EMA8 < EMA21)
  if (indicators.ema8 < indicators.ema21) {
    const crossStrength = ((indicators.ema21 - indicators.ema8) / indicators.ema21) * 100;
    if (crossStrength > 0.1) {
      reasons.push(`EMA 데드크로스 (-${crossStrength.toFixed(2)}%)`);
      score += 2;
    }
  }
  
  // 3. MACD 히스토그램 하락 전환
  if (indicators.macdHistogram < 0 && indicators.macd < indicators.macdSignal) {
    reasons.push('MACD 하락 전환');
    score += 2;
  }
  
  // 4. 볼린저밴드 상단 터치
  const upperBandDist = ((indicators.upperBand - price) / indicators.upperBand) * 100;
  if (upperBandDist <= 0.3) {
    reasons.push(`BB 상단 터치 (${upperBandDist.toFixed(2)}%)`);
    score += 2;
  }
  
  // 5. 거래량 200% 이상
  if (indicators.volumeRatio >= 2.0) {
    reasons.push(`거래량 급증 (${(indicators.volumeRatio * 100).toFixed(0)}%)`);
    score += 1;
  }
  
  // 6. ADX > 20 (강한 추세)
  if (indicators.adx > 20) {
    reasons.push(`강한 추세 (ADX ${indicators.adx.toFixed(1)})`);
    score += 1;
  }
  
  // 7. Williams %R > -20 (과매수)
  if (indicators.williamsR > -20) {
    reasons.push(`Williams %R 과매수 (${indicators.williamsR.toFixed(1)})`);
    score += 1;
  }
  
  // 8. CCI > +100 (강한 과매수)
  if (indicators.cci > 100) {
    reasons.push(`CCI 과매수 (${indicators.cci.toFixed(0)})`);
    score += 1;
  }
  
  // 9. 스토캐스틱 과매수
  if (indicators.stochK > 80 && indicators.stochD > 80) {
    reasons.push(`스토캐스틱 과매수 (%K ${indicators.stochK.toFixed(1)})`);
    score += 1;
  }
  
  // 최소 3개 이상 조건 충족 필요
  const valid = reasons.length >= 3 && score >= 5;
  
  let strength: 'weak' | 'medium' | 'strong' = 'weak';
  if (score >= 8) strength = 'strong';
  else if (score >= 6) strength = 'medium';
  
  return { valid, strength, reasons };
}

// 5분봉 데이터 가져오기 (기술적 분석용)
export async function fetch5mKlines(symbol: string, limit: number = 50): Promise<Kline[] | null> {
  try {
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=5m&limit=${limit}`
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

// 1분봉 데이터 가져오기 (실시간 모니터링용)
export async function fetch1mKlines(symbol: string, limit: number = 30): Promise<Kline[] | null> {
  try {
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=${limit}`
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
