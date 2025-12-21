import { useEffect, useState, useRef, useCallback } from 'react';
import { SymbolInfo } from '@/lib/binance';
import { toast } from 'sonner';

type ConnectionKey = 'mainnet' | 'testnet';

const WS_URLS: Record<ConnectionKey, string> = {
  mainnet: 'wss://fstream.binance.com/ws/!ticker@arr',
  testnet: 'wss://stream.binancefuture.com/ws/!ticker@arr',
};

function getKey(isTestnet: boolean): ConnectionKey {
  return isTestnet ? 'testnet' : 'mainnet';
}

// 전역 캐시/연결 - key별 분리 (메인/테스트넷 가격 혼선 방지)
let globalTickersByKey: Record<ConnectionKey, SymbolInfo[]> = {
  mainnet: [],
  testnet: [],
};
let globalLastUpdateByKey: Record<ConnectionKey, number> = {
  mainnet: 0,
  testnet: 0,
};
let activeConnectionByKey: Record<ConnectionKey, WebSocket | null> = {
  mainnet: null,
  testnet: null,
};
let connectionRefCountByKey: Record<ConnectionKey, number> = {
  mainnet: 0,
  testnet: 0,
};
let lastDisconnectNotificationByKey: Record<ConnectionKey, number> = {
  mainnet: 0,
  testnet: 0,
};

export const useTickerWebSocket = (
  enabled: boolean = true,
  options?: { isTestnet?: boolean }
) => {
  const isTestnet = options?.isTestnet ?? false;
  const key = getKey(isTestnet);
  const WS_URL = WS_URLS[key];

  const [tickers, setTickers] = useState<SymbolInfo[]>(globalTickersByKey[key]);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const processTickers = useCallback(
    (data: any[]) => {
      const now = Date.now();

      // 100ms 쓰로틀링 (최대 속도)
      if (now - globalLastUpdateByKey[key] < 100) return;
      globalLastUpdateByKey[key] = now;

      const processed: SymbolInfo[] = data
        .filter((t: any) => t.s?.endsWith('USDT'))
        .map((t: any) => {
          const highPrice = parseFloat(t.h);
          const lowPrice = parseFloat(t.l);
          const volume = parseFloat(t.q); // quote volume
          const priceChangePercent = parseFloat(t.P);
          const volatilityRange =
            lowPrice > 0 ? ((highPrice - lowPrice) / lowPrice) * 100 : 0;

          return {
            symbol: t.s,
            price: parseFloat(t.c),
            priceChange: parseFloat(t.p),
            priceChangePercent,
            volume,
            highPrice,
            lowPrice,
            volatilityRange,
            hotScore: 0,
          };
        });

      // Calculate hot score
      if (processed.length > 0) {
        const maxVolume = Math.max(...processed.map((t) => t.volume));
        const maxVolatility = Math.max(...processed.map((t) => t.volatilityRange));

        processed.forEach((t) => {
          const normalizedVolume = maxVolume > 0 ? t.volume / maxVolume : 0;
          const normalizedVolatility =
            maxVolatility > 0 ? t.volatilityRange / maxVolatility : 0;
          t.hotScore = normalizedVolume * 50 + normalizedVolatility * 50;
        });
      }

      globalTickersByKey[key] = processed;

      if (mountedRef.current) {
        setTickers(processed);
      }
    },
    [key]
  );

  const connect = useCallback(() => {
    const activeConnection = activeConnectionByKey[key];

    // 이미 연결이 있으면 재사용
    if (activeConnection && activeConnection.readyState === WebSocket.OPEN) {
      console.log('[Ticker WS] Reusing existing connection');
      setIsConnected(true);
      return;
    }

    // CONNECTING 상태인데 5초 이상 지나면 강제 종료 후 재연결
    if (activeConnection && activeConnection.readyState === WebSocket.CONNECTING) {
      console.log('[Ticker WS] Connection in progress, will retry if stuck...');
      // 5초 후에 아직도 CONNECTING이면 강제 재연결
      setTimeout(() => {
        const conn = activeConnectionByKey[key];
        if (conn && conn.readyState === WebSocket.CONNECTING) {
          console.log('[Ticker WS] Connection stuck, forcing reconnect...');
          try {
            conn.close();
          } catch (e) {
            // ignore
          }
          activeConnectionByKey[key] = null;
          if (mountedRef.current && connectionRefCountByKey[key] > 0) {
            connect();
          }
        }
      }, 5000);
      return;
    }

    // 이전 연결이 CLOSING 상태면 정리
    if (activeConnection && activeConnection.readyState === WebSocket.CLOSING) {
      console.log('[Ticker WS] Previous connection closing, waiting...');
      activeConnectionByKey[key] = null;
    }

    try {
      console.log('[Ticker WS] Connecting to', WS_URL);
      const ws = new WebSocket(WS_URL);
      activeConnectionByKey[key] = ws;

      ws.onopen = () => {
        console.log('[Ticker WS] Connected successfully');
        if (mountedRef.current) {
          setIsConnected(true);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (Array.isArray(data)) {
            processTickers(data);
          }
        } catch (e) {
          console.error('[Ticker WS] Parse error:', e);
        }
      };

      ws.onerror = (e) => {
        console.error('[Ticker WS] Error:', e);
        // 에러 발생 시 즉시 정리 및 재연결 예약
        if (activeConnectionByKey[key] === ws) {
          activeConnectionByKey[key] = null;
        }
        // 5초 내 중복 알림 방지
        const now = Date.now();
        if (now - lastDisconnectNotificationByKey[key] > 5000) {
          lastDisconnectNotificationByKey[key] = now;
          toast.error('연결 오류 발생, 재연결 중...');
        }
      };

      ws.onclose = (e) => {
        console.log('[Ticker WS] Closed, code:', e.code, 'reason:', e.reason);
        if (activeConnectionByKey[key] === ws) {
          activeConnectionByKey[key] = null;
        }
        if (mountedRef.current) {
          setIsConnected(false);
          // 비정상 종료 시 알림 (1006 = abnormal closure)
          if (e.code === 1006) {
            const now = Date.now();
            if (now - lastDisconnectNotificationByKey[key] > 5000) {
              lastDisconnectNotificationByKey[key] = now;
              toast.error('서버 과부하로 연결 끊김, 재연결 중...');
            }
          }
          // 재연결 (더 빠르게 - 1초)
          if (connectionRefCountByKey[key] > 0) {
            console.log('[Ticker WS] Scheduling reconnect in 1s...');
            reconnectTimeoutRef.current = setTimeout(connect, 1000);
          }
        }
      };
    } catch (e) {
      console.error('[Ticker WS] Connection error:', e);
      activeConnectionByKey[key] = null;
      // 연결 실패 시 2초 후 재시도
      if (mountedRef.current && connectionRefCountByKey[key] > 0) {
        reconnectTimeoutRef.current = setTimeout(connect, 2000);
      }
    }
  }, [WS_URL, key, processTickers]);

  useEffect(() => {
    if (!enabled) {
      setTickers([]);
      setIsConnected(false);
      return;
    }

    mountedRef.current = true;
    connectionRefCountByKey[key]++;

    // 캐시된 데이터가 있으면 즉시 사용
    if (globalTickersByKey[key].length > 0) {
      setTickers(globalTickersByKey[key]);
    }

    connect();

    return () => {
      mountedRef.current = false;
      connectionRefCountByKey[key]--;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      // 마지막 구독자가 나가면 연결 종료
      if (connectionRefCountByKey[key] === 0 && activeConnectionByKey[key]) {
        activeConnectionByKey[key]?.close();
        activeConnectionByKey[key] = null;
      }
    };
  }, [connect, enabled, key]);

  return { tickers, isConnected };
};
