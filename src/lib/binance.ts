// Binance Futures API utilities

const BASE_URL = 'https://fapi.binance.com';

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

export interface SymbolPrecision {
  symbol: string;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: number;
  stepSize: number;
  minQty: number;
  maxQty: number;
  minNotional: number;
  notFound?: boolean; // 심볼이 거래소에 없음
}

// Cache for symbol precision info
const symbolPrecisionCache: Map<string, SymbolPrecision> = new Map();

// Fetch symbol precision info
export async function fetchSymbolPrecision(symbol: string): Promise<SymbolPrecision> {
  // Check cache first
  if (symbolPrecisionCache.has(symbol)) {
    return symbolPrecisionCache.get(symbol)!;
  }

  try {
    const response = await fetch(`${BASE_URL}/fapi/v1/exchangeInfo`);
    const data = await response.json();
    
    const symbolInfo = data.symbols.find((s: any) => s.symbol === symbol);
    
    if (!symbolInfo) {
      console.warn(`[fetchSymbolPrecision] ${symbol} not found`);
      // Return with notFound flag
      return {
        symbol,
        pricePrecision: 2,
        quantityPrecision: 0,
        tickSize: 0.01,
        stepSize: 1,
        minQty: 1,
        maxQty: 10000000, // 기본값: 매우 큰 값
        minNotional: 5,
        notFound: true, // 심볼 없음 표시
      };
    }

    // Extract filters
    const priceFilter = symbolInfo.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
    const lotSizeFilter = symbolInfo.filters.find((f: any) => f.filterType === 'LOT_SIZE');
    const minNotionalFilter = symbolInfo.filters.find((f: any) => f.filterType === 'MIN_NOTIONAL');

    const precision: SymbolPrecision = {
      symbol,
      pricePrecision: symbolInfo.pricePrecision,
      quantityPrecision: symbolInfo.quantityPrecision,
      tickSize: parseFloat(priceFilter?.tickSize || '0.01'),
      stepSize: parseFloat(lotSizeFilter?.stepSize || '1'),
      minQty: parseFloat(lotSizeFilter?.minQty || '1'),
      maxQty: parseFloat(lotSizeFilter?.maxQty || '10000000'),
      minNotional: parseFloat(minNotionalFilter?.notional || '5'),
    };

    console.log(`[fetchSymbolPrecision] ${symbol}: qtyPrec=${precision.quantityPrecision}, stepSize=${precision.stepSize}`);

    // Cache the result
    symbolPrecisionCache.set(symbol, precision);

    return precision;
  } catch (error) {
    console.error(`[fetchSymbolPrecision] Error fetching ${symbol}:`, error);
    // 에러 시 안전한 기본값 (정수)
    return {
      symbol,
      pricePrecision: 2,
      quantityPrecision: 0,
      tickSize: 0.01,
      stepSize: 1,
      minQty: 1,
      maxQty: 10000000,
      minNotional: 5,
    };
  }
}

// Round quantity to valid precision
export function roundQuantity(quantity: number, precision: SymbolPrecision): number {
  const stepSize = precision.stepSize;
  // stepSize로 나눈 후 내림하여 정확한 정밀도 보장
  const rounded = Math.floor(quantity / stepSize) * stepSize;
  
  // quantityPrecision에 맞게 반올림 (0이면 정수)
  const decimalPlaces = precision.quantityPrecision;
  const factor = Math.pow(10, decimalPlaces);
  const finalQty = Math.floor(rounded * factor) / factor;
  
  // 최소 수량 보장
  if (finalQty < precision.minQty) {
    return precision.minQty;
  }
  
  return finalQty;
}

// Round price to valid precision
export function roundPrice(price: number, precision: SymbolPrecision): number {
  const tickSize = precision.tickSize;
  const rounded = Math.round(price / tickSize) * tickSize;
  return parseFloat(rounded.toFixed(precision.pricePrecision));
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
