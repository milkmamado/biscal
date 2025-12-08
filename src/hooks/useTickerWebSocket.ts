import { useEffect, useState, useRef, useCallback } from 'react';
import { SymbolInfo } from '@/lib/binance';

const WS_URL = 'wss://fstream.binance.com/ws/!ticker@arr';

// 전역 캐시 - 모든 컴포넌트가 공유
let globalTickers: SymbolInfo[] = [];
let globalLastUpdate = 0;
let activeConnection: WebSocket | null = null;
let connectionRefCount = 0;

export const useTickerWebSocket = () => {
  const [tickers, setTickers] = useState<SymbolInfo[]>(globalTickers);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const processTickers = useCallback((data: any[]) => {
    const now = Date.now();
    
    // 200ms 쓰로틀링 (현재가 업데이트 빈도 개선)
    if (now - globalLastUpdate < 200) return;
    globalLastUpdate = now;
    
    const processed = data
      .filter((t: any) => t.s?.endsWith('USDT'))
      .map((t: any) => {
        const highPrice = parseFloat(t.h);
        const lowPrice = parseFloat(t.l);
        const volume = parseFloat(t.q); // quote volume
        const priceChangePercent = parseFloat(t.P);
        const volatilityRange = lowPrice > 0 ? ((highPrice - lowPrice) / lowPrice) * 100 : 0;
        
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
      const maxVolume = Math.max(...processed.map(t => t.volume));
      const maxVolatility = Math.max(...processed.map(t => t.volatilityRange));
      
      processed.forEach(t => {
        const normalizedVolume = maxVolume > 0 ? t.volume / maxVolume : 0;
        const normalizedVolatility = maxVolatility > 0 ? t.volatilityRange / maxVolatility : 0;
        t.hotScore = (normalizedVolume * 50) + (normalizedVolatility * 50);
      });
    }
    
    globalTickers = processed;
    
    if (mountedRef.current) {
      setTickers(processed);
    }
  }, []);

  const connect = useCallback(() => {
    // 이미 연결이 있으면 재사용
    if (activeConnection && activeConnection.readyState === WebSocket.OPEN) {
      console.log('[Ticker WS] Reusing existing connection');
      setIsConnected(true);
      return;
    }
    
    if (activeConnection && activeConnection.readyState === WebSocket.CONNECTING) {
      console.log('[Ticker WS] Connection in progress...');
      return;
    }

    try {
      console.log('[Ticker WS] Connecting to', WS_URL);
      const ws = new WebSocket(WS_URL);
      activeConnection = ws;
      
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
      };
      
      ws.onclose = (e) => {
        console.log('[Ticker WS] Closed, code:', e.code, 'reason:', e.reason);
        activeConnection = null;
        if (mountedRef.current) {
          setIsConnected(false);
          // 재연결
          if (connectionRefCount > 0) {
            console.log('[Ticker WS] Scheduling reconnect in 3s...');
            reconnectTimeoutRef.current = setTimeout(connect, 3000);
          }
        }
      };
    } catch (e) {
      console.error('[Ticker WS] Connection error:', e);
    }
  }, [processTickers]);

  useEffect(() => {
    mountedRef.current = true;
    connectionRefCount++;
    
    // 캐시된 데이터가 있으면 즉시 사용
    if (globalTickers.length > 0) {
      setTickers(globalTickers);
    }
    
    connect();
    
    return () => {
      mountedRef.current = false;
      connectionRefCount--;
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      
      // 마지막 구독자가 나가면 연결 종료
      if (connectionRefCount === 0 && activeConnection) {
        activeConnection.close();
        activeConnection = null;
      }
    };
  }, [connect]);

  return { tickers, isConnected };
};
