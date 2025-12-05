// Binance Futures API utilities

const BASE_URL = 'https://fapi.binance.com';

export interface KlineData {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface SymbolInfo {
  symbol: string;
  price: number;
  priceChange: number;
  priceChangePercent: number;
  volume: number;
  highPrice: number;
  lowPrice: number;
  volatilityRange: number; // (high - low) / low * 100
  hotScore: number; // composite score
}

export interface OrderBookEntry {
  price: number;
  quantity: number;
}

export interface OrderBook {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  lastUpdateId: number;
}

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
  currentPrice: number;
  isAboveUpper: boolean;
}

export interface OpenInterestInfo {
  symbol: string;
  openInterest: number;
}

// Fetch all futures symbols
export async function fetchFuturesSymbols(): Promise<string[]> {
  const response = await fetch(`${BASE_URL}/fapi/v1/exchangeInfo`);
  const data = await response.json();
  return data.symbols
    .filter((s: any) => s.status === 'TRADING' && s.contractType === 'PERPETUAL')
    .map((s: any) => s.symbol)
    .filter((s: string) => s.endsWith('USDT'));
}

// Fetch 5m klines for a symbol
export async function fetchKlines(symbol: string, interval: string = '5m', limit: number = 21): Promise<KlineData[]> {
  const response = await fetch(`${BASE_URL}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const data = await response.json();
  return data.map((k: any[]) => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  }));
}

// Fetch order book
export async function fetchOrderBook(symbol: string, limit: number = 20): Promise<OrderBook> {
  const response = await fetch(`${BASE_URL}/fapi/v1/depth?symbol=${symbol}&limit=${limit}`);
  const data = await response.json();
  return {
    bids: data.bids.map((b: string[]) => ({ price: parseFloat(b[0]), quantity: parseFloat(b[1]) })),
    asks: data.asks.map((a: string[]) => ({ price: parseFloat(a[0]), quantity: parseFloat(a[1]) })),
    lastUpdateId: data.lastUpdateId,
  };
}

// Fetch 24h ticker
export async function fetch24hTicker(symbol: string): Promise<SymbolInfo> {
  const response = await fetch(`${BASE_URL}/fapi/v1/ticker/24hr?symbol=${symbol}`);
  const data = await response.json();
  const highPrice = parseFloat(data.highPrice);
  const lowPrice = parseFloat(data.lowPrice);
  const volatilityRange = lowPrice > 0 ? ((highPrice - lowPrice) / lowPrice) * 100 : 0;
  
  return {
    symbol: data.symbol,
    price: parseFloat(data.lastPrice),
    priceChange: parseFloat(data.priceChange),
    priceChangePercent: parseFloat(data.priceChangePercent),
    volume: parseFloat(data.quoteVolume),
    highPrice,
    lowPrice,
    volatilityRange,
    hotScore: 0,
  };
}

// Fetch all 24h tickers
export async function fetchAll24hTickers(): Promise<SymbolInfo[]> {
  const response = await fetch(`${BASE_URL}/fapi/v1/ticker/24hr`);
  const data = await response.json();
  
  const tickers = data
    .filter((t: any) => t.symbol.endsWith('USDT'))
    .map((t: any) => {
      const highPrice = parseFloat(t.highPrice);
      const lowPrice = parseFloat(t.lowPrice);
      const volume = parseFloat(t.quoteVolume);
      const priceChangePercent = parseFloat(t.priceChangePercent);
      
      // Calculate volatility range: (high - low) / low * 100
      const volatilityRange = lowPrice > 0 ? ((highPrice - lowPrice) / lowPrice) * 100 : 0;
      
      return {
        symbol: t.symbol,
        price: parseFloat(t.lastPrice),
        priceChange: parseFloat(t.priceChange),
        priceChangePercent,
        volume,
        highPrice,
        lowPrice,
        volatilityRange,
        hotScore: 0, // Will be calculated after normalization
      };
    });
  
  // Calculate hot score using normalized values
  // Hot score = (normalized volume * 0.5) + (normalized volatility * 0.5)
  if (tickers.length > 0) {
    const maxVolume = Math.max(...tickers.map((t: SymbolInfo) => t.volume));
    const maxVolatility = Math.max(...tickers.map((t: SymbolInfo) => t.volatilityRange));
    
    tickers.forEach((t: SymbolInfo) => {
      const normalizedVolume = maxVolume > 0 ? t.volume / maxVolume : 0;
      const normalizedVolatility = maxVolatility > 0 ? t.volatilityRange / maxVolatility : 0;
      
      // Composite score: 50% volume + 50% volatility
      t.hotScore = (normalizedVolume * 50) + (normalizedVolatility * 50);
    });
  }
  
  return tickers;
}

// Fetch Open Interest for all symbols
export async function fetchAllOpenInterest(): Promise<OpenInterestInfo[]> {
  const response = await fetch(`${BASE_URL}/fapi/v1/openInterest?symbol=BTCUSDT`);
  // Note: This endpoint requires symbol, so we'll use ticker for now
  return [];
}

// Fetch Open Interest Statistics (top traders)
export async function fetchTopLongShortRatio(): Promise<any[]> {
  try {
    const response = await fetch(`${BASE_URL}/futures/data/topLongShortPositionRatio?symbol=BTCUSDT&period=1h&limit=1`);
    const data = await response.json();
    return data;
  } catch {
    return [];
  }
}

// Calculate Bollinger Bands
export function calculateBollingerBands(klines: KlineData[], period: number = 20, multiplier: number = 2): BollingerBands {
  const closes = klines.map(k => k.close);
  const currentPrice = closes[closes.length - 1];
  
  // Calculate SMA
  const recentCloses = closes.slice(-period);
  const sma = recentCloses.reduce((sum, price) => sum + price, 0) / period;
  
  // Calculate Standard Deviation
  const squaredDiffs = recentCloses.map(price => Math.pow(price - sma, 2));
  const avgSquaredDiff = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / period;
  const stdDev = Math.sqrt(avgSquaredDiff);
  
  const upper = sma + (multiplier * stdDev);
  const lower = sma - (multiplier * stdDev);
  
  return {
    upper,
    middle: sma,
    lower,
    currentPrice,
    isAboveUpper: currentPrice >= upper,
  };
}

// Format price with appropriate decimals
export function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(6);
  return price.toFixed(8);
}

// Format volume
export function formatVolume(volume: number): string {
  if (volume >= 1_000_000_000) return (volume / 1_000_000_000).toFixed(2) + 'B';
  if (volume >= 1_000_000) return (volume / 1_000_000).toFixed(2) + 'M';
  if (volume >= 1_000) return (volume / 1_000).toFixed(2) + 'K';
  return volume.toFixed(2);
}

// Format quantity
export function formatQuantity(qty: number): string {
  if (qty >= 1_000_000) return (qty / 1_000_000).toFixed(3) + 'M';
  if (qty >= 1_000) return (qty / 1_000).toFixed(3) + 'K';
  if (qty >= 1) return qty.toFixed(3);
  return qty.toFixed(6);
}

// Technical Analysis for scalping probability
export interface TechnicalSignal {
  bullishProb: number; // 0-100
  bearishProb: number; // 0-100
  rsi: number;
  macdSignal: 'bullish' | 'bearish' | 'neutral';
  bbPosition: 'upper' | 'middle' | 'lower';
  volumeSignal: 'high' | 'normal' | 'low';
}

// Calculate RSI
function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// Calculate EMA
function calculateEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  
  // First EMA is SMA
  let sum = 0;
  for (let i = 0; i < period && i < data.length; i++) {
    sum += data[i];
  }
  ema.push(sum / Math.min(period, data.length));
  
  for (let i = period; i < data.length; i++) {
    ema.push((data[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1]);
  }
  
  return ema;
}

// Calculate MACD
function calculateMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  
  const macdLine: number[] = [];
  const startIdx = ema26.length - Math.min(ema12.length, ema26.length);
  
  for (let i = 0; i < Math.min(ema12.length, ema26.length); i++) {
    macdLine.push(ema12[ema12.length - Math.min(ema12.length, ema26.length) + i] - ema26[startIdx + i]);
  }
  
  const signalLine = calculateEMA(macdLine, 9);
  const macd = macdLine[macdLine.length - 1] || 0;
  const signal = signalLine[signalLine.length - 1] || 0;
  
  return {
    macd,
    signal,
    histogram: macd - signal
  };
}

// Calculate technical signal for scalping
export async function calculateTechnicalSignal(symbol: string): Promise<TechnicalSignal> {
  try {
    // Fetch 1m klines for scalping (fast signals)
    const klines = await fetchKlines(symbol, '1m', 50);
    const closes = klines.map(k => k.close);
    const volumes = klines.map(k => k.volume);
    const currentPrice = closes[closes.length - 1];
    
    // 1. RSI (14 period)
    const rsi = calculateRSI(closes, 14);
    
    // 2. MACD
    const macd = calculateMACD(closes);
    const macdSignal: 'bullish' | 'bearish' | 'neutral' = 
      macd.histogram > 0 ? 'bullish' : macd.histogram < 0 ? 'bearish' : 'neutral';
    
    // 3. Bollinger Bands position
    const bb = calculateBollingerBands(klines, 20, 2);
    let bbPosition: 'upper' | 'middle' | 'lower' = 'middle';
    const bbRange = bb.upper - bb.lower;
    if (currentPrice > bb.middle + bbRange * 0.25) bbPosition = 'upper';
    else if (currentPrice < bb.middle - bbRange * 0.25) bbPosition = 'lower';
    
    // 4. Volume analysis
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const currentVolume = volumes[volumes.length - 1];
    let volumeSignal: 'high' | 'normal' | 'low' = 'normal';
    if (currentVolume > avgVolume * 1.5) volumeSignal = 'high';
    else if (currentVolume < avgVolume * 0.5) volumeSignal = 'low';
    
    // Calculate probabilities based on multiple signals
    let bullScore = 0;
    let bearScore = 0;
    
    // RSI contribution (30% weight)
    if (rsi < 30) bullScore += 30; // Oversold - bullish
    else if (rsi > 70) bearScore += 30; // Overbought - bearish
    else if (rsi < 45) bullScore += 15;
    else if (rsi > 55) bearScore += 15;
    else { bullScore += 7; bearScore += 7; }
    
    // MACD contribution (30% weight)
    if (macdSignal === 'bullish') bullScore += 30;
    else if (macdSignal === 'bearish') bearScore += 30;
    else { bullScore += 15; bearScore += 15; }
    
    // Bollinger Bands contribution (25% weight)
    if (bbPosition === 'lower') bullScore += 25; // Near lower band - likely bounce
    else if (bbPosition === 'upper') bearScore += 25; // Near upper band - likely pullback
    else { bullScore += 12; bearScore += 12; }
    
    // Volume confirmation (15% weight)
    if (volumeSignal === 'high') {
      // High volume confirms the trend
      if (bullScore > bearScore) bullScore += 15;
      else bearScore += 15;
    } else if (volumeSignal === 'low') {
      // Low volume weakens the signal
      bullScore += 5;
      bearScore += 5;
    } else {
      bullScore += 7;
      bearScore += 7;
    }
    
    // Normalize to ensure total is around 100
    const total = bullScore + bearScore;
    const bullishProb = Math.round((bullScore / total) * 100);
    const bearishProb = 100 - bullishProb;
    
    return {
      bullishProb,
      bearishProb,
      rsi: Math.round(rsi),
      macdSignal,
      bbPosition,
      volumeSignal
    };
  } catch (error) {
    console.error('Failed to calculate technical signal:', error);
    return {
      bullishProb: 50,
      bearishProb: 50,
      rsi: 50,
      macdSignal: 'neutral',
      bbPosition: 'middle',
      volumeSignal: 'normal'
    };
  }
}
