import { useState, useCallback, useRef } from 'react';
import { fetchSymbolPrecision, roundQuantity, roundPrice } from '@/lib/binance';
import { useAuth } from '@/hooks/useAuth';

// VPS 직접 호출 (Edge Function 우회로 ~300ms 단축)
const VPS_DIRECT_URL = 'https://api.biscal.me/api/direct';
const VPS_AUTH_TOKEN = 'biscal2024secure';

export interface BinanceBalance {
  asset: string;
  balance: string;
  availableBalance: string;
  crossWalletBalance: string;
  crossUnPnl: string;
}

export interface BinancePosition {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  marginType: string;
  isolatedMargin: string;
  isAutoAddMargin: string;
  positionSide: string;
  notional: string;
  isolatedWallet: string;
  updateTime: number;
}

export interface BinanceAccountInfo {
  totalWalletBalance: string;
  totalUnrealizedProfit: string;
  totalMarginBalance: string;
  availableBalance: string;
  positions: BinancePosition[];
}

export const useBinanceApi = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ipError, setIpError] = useState<string | null>(null);
  const [apiLatency, setApiLatency] = useState<number>(0);
  const latencyHistoryRef = useRef<number[]>([]);
  const { user } = useAuth();

  // VPS 직접 호출 (Edge Function 우회)
  const callVpsDirect = useCallback(async (action: string, params: Record<string, any> = {}): Promise<any> => {
    const startTime = performance.now();
    
    const body: Record<string, any> = { action, params };
    
    const response = await fetch(VPS_DIRECT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VPS_AUTH_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    
    const latency = Math.round(performance.now() - startTime);
    console.log(`[VPS Direct] ${action}: ${latency}ms`);
    
    // 최근 10개 레이턴시의 평균 계산
    latencyHistoryRef.current.push(latency);
    if (latencyHistoryRef.current.length > 10) {
      latencyHistoryRef.current.shift();
    }
    const avgLatency = Math.round(
      latencyHistoryRef.current.reduce((a, b) => a + b, 0) / latencyHistoryRef.current.length
    );
    setApiLatency(avgLatency);
    
    if (!response.ok) {
      throw new Error(`VPS 호출 실패: ${response.status}`);
    }
    
    return response.json();
  }, []);

  const callBinanceApi = useCallback(async (action: string, params: Record<string, any> = {}, retryCount: number = 0): Promise<any> => {
    // Skip API call if user is not logged in
    if (!user) {
      return null;
    }
    
    setLoading(true);
    setError(null);

    const maxRetries = 3;

    try {
      // VPS 직접 호출 (Edge Function 우회로 빠른 속도)
      const data = await callVpsDirect(action, params);

      if (data?.error) {
        // Handle specific error codes with friendly messages
        if (data.code === -2022) {
          throw new Error('청산할 포지션이 없습니다');
        }
        if (data.code === -2019) {
          throw new Error('마진 부족: 주문 수량을 줄이거나 레버리지를 낮춰주세요');
        }
        if (data.code === -4061) {
          throw new Error('주문 수량이 최소 단위보다 작습니다');
        }
        if (data.code === -4164) {
          throw new Error('최소 주문 금액은 $5 이상이어야 합니다');
        }
        if (data.code === -4028) {
          throw new Error(`LEVERAGE_NOT_VALID:-4028`);
        }
        if (data.code === -4046) {
          return { success: true, alreadySet: true };
        }
        if (data.code === -2015 && data.error?.includes('request ip:')) {
          const ipMatch = data.error.match(/request ip: ([\d.]+)/);
          const blockedIp = ipMatch ? ipMatch[1] : 'unknown';
          setIpError(blockedIp);
          
          if (retryCount < maxRetries) {
            console.log(`IP error, retrying... (${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 500));
            return callBinanceApi(action, params, retryCount + 1);
          }
          
          throw new Error(`IP 제한: ${blockedIp} 추가 필요`);
        }
        throw new Error(data.error);
      }

      setIpError(null);
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [user, callVpsDirect]);

  const getAccountInfo = useCallback(async (): Promise<BinanceAccountInfo> => {
    return callBinanceApi('getAccountInfo');
  }, [callBinanceApi]);

  const getBalances = useCallback(async (): Promise<BinanceBalance[]> => {
    return callBinanceApi('getBalance');
  }, [callBinanceApi]);

  const getPositions = useCallback(async (symbol?: string): Promise<BinancePosition[]> => {
    return callBinanceApi('getPositions', symbol ? { symbol } : {});
  }, [callBinanceApi]);

  const getOpenOrders = useCallback(async (symbol?: string): Promise<any[]> => {
    return callBinanceApi('getOpenOrders', symbol ? { symbol } : {});
  }, [callBinanceApi]);

  const placeMarketOrder = useCallback(async (
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    reduceOnly: boolean = false,
    currentPrice?: number
  ) => {
    // Fetch precision and round quantity
    const precision = await fetchSymbolPrecision(symbol);
    const roundedQuantity = roundQuantity(quantity, precision);
    
    // Validate minimum notional (skip for reduceOnly orders)
    if (!reduceOnly && currentPrice) {
      const notional = roundedQuantity * currentPrice;
      if (notional < precision.minNotional) {
        throw new Error(`주문 금액이 최소 ${precision.minNotional} USDT 이상이어야 합니다. 현재: ${notional.toFixed(2)} USDT`);
      }
    }
    
    // maxQty 초과 시 분할 주문 (청산 시 필요)
    if (roundedQuantity > precision.maxQty) {
      console.log(`⚡ [분할주문] ${symbol} 수량 ${roundedQuantity} > maxQty ${precision.maxQty} → 분할 처리`);
      
      let remainingQty = roundedQuantity;
      let lastResult: any = null;
      
      while (remainingQty > 0) {
        const orderQty = Math.min(remainingQty, precision.maxQty);
        const finalQty = roundQuantity(orderQty, precision);
        
        if (finalQty <= 0) break;
        
        const params: Record<string, any> = {
          symbol,
          side,
          type: 'MARKET',
          quantity: finalQty,
        };
        if (reduceOnly) {
          params.reduceOnly = true;
        }
        
        console.log(`📦 [분할주문] ${symbol} ${side} 수량=${finalQty} (남은: ${(remainingQty - finalQty).toFixed(4)})`);
        lastResult = await callBinanceApi('placeOrder', params);
        
        if (lastResult?.error || lastResult?.code) {
          console.error(`분할주문 실패:`, lastResult);
          break;
        }
        
        remainingQty -= finalQty;
        
        // 다음 주문 전 짧은 대기
        if (remainingQty > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      return lastResult;
    }
    
    // Only include reduceOnly if true (Binance rejects reduceOnly: false for new positions)
    const params: Record<string, any> = {
      symbol,
      side,
      type: 'MARKET',
      quantity: roundedQuantity,
    };
    if (reduceOnly) {
      params.reduceOnly = true;
    }
    
    return callBinanceApi('placeOrder', params);
  }, [callBinanceApi]);

  const placeLimitOrder = useCallback(async (
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    price: number,
    reduceOnly: boolean = false
  ) => {
    // Fetch precision and round quantity/price
    const precision = await fetchSymbolPrecision(symbol);
    const roundedQuantity = roundQuantity(quantity, precision);
    const roundedPrice = roundPrice(price, precision);
    
    // Validate minimum notional (skip for reduceOnly orders)
    if (!reduceOnly) {
      const notional = roundedQuantity * roundedPrice;
      if (notional < precision.minNotional) {
        throw new Error(`주문 금액이 최소 ${precision.minNotional} USDT 이상이어야 합니다. 현재: ${notional.toFixed(2)} USDT`);
      }
    }
    
    // Only include reduceOnly if true
    const params: Record<string, any> = {
      symbol,
      side,
      type: 'LIMIT',
      quantity: roundedQuantity,
      price: roundedPrice,
      timeInForce: 'GTC',
    };
    if (reduceOnly) {
      params.reduceOnly = true;
    }
    
    return callBinanceApi('placeOrder', params);
  }, [callBinanceApi]);

  // STOP_MARKET 주문 (손절용)
  const placeStopMarketOrder = useCallback(async (
    symbol: string,
    side: 'BUY' | 'SELL', // 롱 포지션 손절: SELL, 숏 포지션 손절: BUY
    quantity: number,
    stopPrice: number,
    positionSide?: 'LONG' | 'SHORT'
  ) => {
    const precision = await fetchSymbolPrecision(symbol);
    const roundedStopPrice = roundPrice(stopPrice, precision);
    const roundedQuantity = roundQuantity(quantity, precision);

    const params: Record<string, any> = {
      symbol,
      side,
      type: 'STOP_MARKET',
      stopPrice: roundedStopPrice,
      quantity: roundedQuantity,
      reduceOnly: 'true', // 문자열로 전달 (바이낸스 API 요구사항)
      ...(positionSide ? { positionSide } : {}),
    };

    console.log(
      `🛑 [STOP_MARKET] ${symbol} ${side} qty=${roundedQuantity} 손절가=${roundedStopPrice}${positionSide ? ` positionSide=${positionSide}` : ''}`
    );

    return callBinanceApi('placeOrder', params);
  }, [callBinanceApi]);

  // TAKE_PROFIT_MARKET 주문 (익절용)
  const placeTakeProfitMarketOrder = useCallback(async (
    symbol: string,
    side: 'BUY' | 'SELL', // 롱 포지션 익절: SELL, 숏 포지션 익절: BUY
    quantity: number,
    stopPrice: number,
    positionSide?: 'LONG' | 'SHORT'
  ) => {
    const precision = await fetchSymbolPrecision(symbol);
    const roundedStopPrice = roundPrice(stopPrice, precision);
    const roundedQuantity = roundQuantity(quantity, precision);

    const params: Record<string, any> = {
      symbol,
      side,
      type: 'TAKE_PROFIT_MARKET',
      stopPrice: roundedStopPrice,
      quantity: roundedQuantity,
      reduceOnly: 'true', // 문자열로 전달 (바이낸스 API 요구사항)
      ...(positionSide ? { positionSide } : {}),
    };

    console.log(
      `💰 [TAKE_PROFIT_MARKET] ${symbol} ${side} qty=${roundedQuantity} 익절가=${roundedStopPrice}${positionSide ? ` positionSide=${positionSide}` : ''}`
    );

    return callBinanceApi('placeOrder', params);
  }, [callBinanceApi]);

  const cancelOrder = useCallback(async (symbol: string, orderId: number) => {
    return callBinanceApi('cancelOrder', { symbol, orderId });
  }, [callBinanceApi]);

  const cancelAllOrders = useCallback(async (symbol: string) => {
    return callBinanceApi('cancelAllOrders', { symbol });
  }, [callBinanceApi]);

  const setLeverage = useCallback(async (symbol: string, leverage: number) => {
    return callBinanceApi('setLeverage', { symbol, leverage });
  }, [callBinanceApi]);

  const setMarginType = useCallback(async (symbol: string, marginType: 'ISOLATED' | 'CROSSED') => {
    return callBinanceApi('setMarginType', { symbol, marginType });
  }, [callBinanceApi]);

  // Get income history since a specific timestamp (auto-pagination; Binance returns max 1000 rows per call)
  const getIncomeHistory = useCallback(
    async (startTime: number, endTime?: number, incomeType?: string) => {
      // Skip API call if user is not logged in
      if (!user) {
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const all: any[] = [];
        const hardEndTime = endTime ?? Date.now();

        let cursor = startTime;
        let lastCursor = -1;

        // Safety guard: up to 50 pages (50,000 rows)
        for (let page = 0; page < 50; page++) {
          const params: Record<string, any> = { startTime: cursor, endTime: hardEndTime, limit: 1000 };
          if (incomeType) params.incomeType = incomeType;

          const data = await callVpsDirect('getIncomeHistory', params);

          if (data?.error || (data?.code && data.code < 0)) {
            throw new Error(data.msg || data.error || 'Binance API error');
          }

          if (!Array.isArray(data)) {
            break;
          }

          all.push(...data);

          // Done if this page isn't full
          if (data.length < 1000) {
            break;
          }

          const lastTime = data[data.length - 1]?.time;
          if (typeof lastTime !== 'number') {
            break;
          }

          // Prevent infinite loop if cursor doesn't advance
          if (lastTime <= lastCursor) {
            break;
          }
          lastCursor = lastTime;

          // If we've reached the end window, stop
          if (lastTime >= hardEndTime) {
            break;
          }

          cursor = lastTime + 1;
        }

        return all;
      } catch (err: any) {
        setError(err?.message ?? '오류 발생. 다시 시도해주세요.');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [user, callVpsDirect]
  );

  return {
    loading,
    error,
    ipError,
    apiLatency,
    callBinanceApi,
    getAccountInfo,
    getBalances,
    getPositions,
    getOpenOrders,
    placeMarketOrder,
    placeLimitOrder,
    placeStopMarketOrder,
    placeTakeProfitMarketOrder,
    cancelOrder,
    cancelAllOrders,
    setLeverage,
    setMarginType,
    getIncomeHistory,
  };
};
