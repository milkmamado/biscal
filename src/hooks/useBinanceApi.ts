import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchSymbolPrecision, roundQuantity, roundPrice } from '@/lib/binance';
import { useAuth } from '@/hooks/useAuth';

// VPS 프록시 직접 호출 URL (Lovable Edge Function 우회)
const VPS_PROXY_URL = 'http://158.247.211.233:3000';

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
  const { user } = useAuth();

  // Edge Function을 통해 VPS 프록시 호출 (HTTPS→HTTP 브릿지)
  const callVpsProxy = useCallback(async (action: string, params: Record<string, any> = {}): Promise<any> => {
    const response = await supabase.functions.invoke('binance-api', {
      body: { action, params },
    });
    
    if (response.error) {
      throw new Error(response.error.message || 'API 호출 실패');
    }
    
    return response.data;
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
      // VPS 프록시 직접 호출 (빠른 속도)
      const data = await callVpsProxy(action, params);

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
  }, [user, callVpsProxy]);

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

  // Get income history since a specific timestamp
  const getIncomeHistory = useCallback(async (startTime: number, endTime?: number, incomeType?: string) => {
    const params: Record<string, any> = { startTime, limit: 1000 };
    if (endTime) params.endTime = endTime;
    if (incomeType) params.incomeType = incomeType;
    return callBinanceApi('getIncomeHistory', params);
  }, [callBinanceApi]);

  return {
    loading,
    error,
    ipError,
    callBinanceApi,
    getAccountInfo,
    getBalances,
    getPositions,
    getOpenOrders,
    placeMarketOrder,
    placeLimitOrder,
    cancelOrder,
    cancelAllOrders,
    setLeverage,
    setMarginType,
    getIncomeHistory,
  };
};
