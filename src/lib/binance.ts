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
  return {
    symbol: data.symbol,
    price: parseFloat(data.lastPrice),
    priceChange: parseFloat(data.priceChange),
    priceChangePercent: parseFloat(data.priceChangePercent),
    volume: parseFloat(data.quoteVolume),
  };
}

// Fetch all 24h tickers
export async function fetchAll24hTickers(): Promise<SymbolInfo[]> {
  const response = await fetch(`${BASE_URL}/fapi/v1/ticker/24hr`);
  const data = await response.json();
  return data
    .filter((t: any) => t.symbol.endsWith('USDT'))
    .map((t: any) => ({
      symbol: t.symbol,
      price: parseFloat(t.lastPrice),
      priceChange: parseFloat(t.priceChange),
      priceChangePercent: parseFloat(t.priceChangePercent),
      volume: parseFloat(t.quoteVolume),
    }));
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
