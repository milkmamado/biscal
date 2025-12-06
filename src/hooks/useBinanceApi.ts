import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

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

  const callBinanceApi = useCallback(async (action: string, params: Record<string, any> = {}, retryCount: number = 0): Promise<any> => {
    setLoading(true);
    setError(null);

    const maxRetries = 3;

    try {
      const { data, error: fnError } = await supabase.functions.invoke('binance-api', {
        body: { action, params }
      });

      if (fnError) {
        throw new Error(fnError.message);
      }

      if (data?.error) {
        // Check if it's an IP error
        if (data.code === -2015 && data.error?.includes('request ip:')) {
          const ipMatch = data.error.match(/request ip: ([\d.]+)/);
          const blockedIp = ipMatch ? ipMatch[1] : 'unknown';
          setIpError(blockedIp);
          
          // Retry automatically up to maxRetries times
          if (retryCount < maxRetries) {
            console.log(`IP error, retrying... (${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms
            return callBinanceApi(action, params, retryCount + 1);
          }
          
          throw new Error(`IP 제한: ${blockedIp} 추가 필요`);
        }
        throw new Error(data.error);
      }

      setIpError(null); // Clear IP error on success
      return data;
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const getAccountInfo = useCallback(async (): Promise<BinanceAccountInfo> => {
    return callBinanceApi('getAccountInfo');
  }, [callBinanceApi]);

  const getBalances = useCallback(async (): Promise<BinanceBalance[]> => {
    return callBinanceApi('getBalance');
  }, [callBinanceApi]);

  const getPositions = useCallback(async (symbol?: string): Promise<BinancePosition[]> => {
    return callBinanceApi('getPositions', symbol ? { symbol } : {});
  }, [callBinanceApi]);

  const placeMarketOrder = useCallback(async (
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    reduceOnly: boolean = false
  ) => {
    return callBinanceApi('placeOrder', {
      symbol,
      side,
      type: 'MARKET',
      quantity,
      reduceOnly,
    });
  }, [callBinanceApi]);

  const placeLimitOrder = useCallback(async (
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    price: number,
    reduceOnly: boolean = false
  ) => {
    return callBinanceApi('placeOrder', {
      symbol,
      side,
      type: 'LIMIT',
      quantity,
      price,
      timeInForce: 'GTC',
      reduceOnly,
    });
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

  return {
    loading,
    error,
    ipError,
    callBinanceApi,
    getAccountInfo,
    getBalances,
    getPositions,
    placeMarketOrder,
    placeLimitOrder,
    cancelOrder,
    cancelAllOrders,
    setLeverage,
    setMarginType,
  };
};
