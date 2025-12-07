import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { KlineData, OrderBook } from '@/lib/binance';

const BINANCE_WS_URL = 'wss://fstream.binance.com/ws';

interface UseBinanceWebSocketOptions {
  symbol: string;
  streams: ('depth' | 'kline')[];
  klineInterval?: string;
  depthLevel?: number;
}

interface WebSocketData {
  orderBook: OrderBook | null;
  klines: KlineData[];
  currentPrice: number | null;
  isConnected: boolean;
}

// Global connection manager to prevent duplicate connections
const connectionManager = new Map<string, {
  ws: WebSocket | null;
  subscribers: Set<string>;
  reconnectTimeout: NodeJS.Timeout | null;
}>();

export const useBinanceWebSocket = ({
  symbol,
  streams,
  klineInterval = '1m',
  depthLevel = 15,
}: UseBinanceWebSocketOptions): WebSocketData => {
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  const klinesRef = useRef<KlineData[]>([]);
  const initialDataLoadedRef = useRef(false);
  const instanceIdRef = useRef(`${Date.now()}-${Math.random()}`);
  const abortControllerRef = useRef<AbortController | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isCleaningUpRef = useRef(false);
  
  // Stable key for this connection
  const connectionKey = useMemo(() => {
    const sortedStreams = [...streams].sort().join(',');
    return `${symbol}-${klineInterval}-${sortedStreams}`;
  }, [symbol, klineInterval, streams]);

  useEffect(() => {
    const instanceId = instanceIdRef.current;
    isCleaningUpRef.current = false;
    
    // Abort any previous fetch requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    // Reset state when connection key changes
    initialDataLoadedRef.current = false;
    klinesRef.current = [];
    
    const fetchInitialKlines = async (): Promise<boolean> => {
      try {
        const response = await fetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${klineInterval}&limit=120`,
          { signal }
        );
        
        if (!response.ok) {
          console.error(`[WS ${symbol}] Kline fetch failed: ${response.status}`);
          return false;
        }
        
        const data = await response.json();
        
        if (signal.aborted || isCleaningUpRef.current) return false;
        
        const parsed: KlineData[] = data.map((k: any) => ({
          openTime: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          closeTime: k[6],
        }));
        
        klinesRef.current = parsed;
        setKlines(parsed);
        if (parsed.length > 0) {
          setCurrentPrice(parsed[parsed.length - 1].close);
        }
        return true;
      } catch (error: any) {
        if (error.name === 'AbortError') return false;
        console.error(`[WS ${symbol}] Failed to fetch klines:`, error);
        return false;
      }
    };

    const fetchInitialOrderBook = async (): Promise<boolean> => {
      try {
        const response = await fetch(
          `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=${depthLevel}`,
          { signal }
        );
        
        if (!response.ok) {
          console.error(`[WS ${symbol}] Depth fetch failed: ${response.status}`);
          return false;
        }
        
        const data = await response.json();
        
        if (signal.aborted || isCleaningUpRef.current) return false;
        
        const parsed: OrderBook = {
          bids: data.bids.map((b: string[]) => ({
            price: parseFloat(b[0]),
            quantity: parseFloat(b[1]),
          })),
          asks: data.asks.map((a: string[]) => ({
            price: parseFloat(a[0]),
            quantity: parseFloat(a[1]),
          })),
          lastUpdateId: data.lastUpdateId,
        };
        setOrderBook(parsed);
        return true;
      } catch (error: any) {
        if (error.name === 'AbortError') return false;
        console.error(`[WS ${symbol}] Failed to fetch orderbook:`, error);
        return false;
      }
    };

    const connect = () => {
      if (isCleaningUpRef.current) return;
      
      // Close any existing connection
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect trigger
        wsRef.current.close();
        wsRef.current = null;
      }

      const streamNames: string[] = [];
      const lowerSymbol = symbol.toLowerCase();
      
      if (streams.includes('depth')) {
        streamNames.push(`${lowerSymbol}@depth@100ms`);
      }
      if (streams.includes('kline')) {
        streamNames.push(`${lowerSymbol}@kline_${klineInterval}`);
      }
      streamNames.push(`${lowerSymbol}@aggTrade`);

      const wsUrl = `${BINANCE_WS_URL}/${streamNames.join('/')}`;
      
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        
        let pingInterval: NodeJS.Timeout | null = null;

        ws.onopen = () => {
          if (isCleaningUpRef.current) {
            ws.close();
            return;
          }
          console.log(`[WS] Connected: ${symbol}`);
          setIsConnected(true);
          
          // Send periodic pong to keep connection alive
          pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ pong: Date.now() }));
            }
          }, 30000);
        };

        ws.onmessage = (event) => {
          if (isCleaningUpRef.current) return;
          
          try {
            const data = JSON.parse(event.data);
            
            // Handle depth updates
            if (data.e === 'depthUpdate') {
              setOrderBook(prev => {
                if (!prev) return prev;
                
                const updateLevel = (levels: { price: number; quantity: number }[], updates: [string, string][]) => {
                  const updated = [...levels];
                  updates.forEach(([priceStr, qtyStr]) => {
                    const price = parseFloat(priceStr);
                    const quantity = parseFloat(qtyStr);
                    const idx = updated.findIndex(l => l.price === price);
                    
                    if (quantity === 0) {
                      if (idx >= 0) updated.splice(idx, 1);
                    } else if (idx >= 0) {
                      updated[idx].quantity = quantity;
                    } else {
                      updated.push({ price, quantity });
                    }
                  });
                  return updated;
                };

                return {
                  bids: updateLevel(prev.bids, data.b).sort((a, b) => b.price - a.price).slice(0, depthLevel),
                  asks: updateLevel(prev.asks, data.a).sort((a, b) => a.price - b.price).slice(0, depthLevel),
                  lastUpdateId: data.u,
                };
              });
            }
            
            // Handle kline updates
            if (data.e === 'kline') {
              if (!initialDataLoadedRef.current || klinesRef.current.length === 0) {
                return;
              }
              
              const k = data.k;
              const newKline: KlineData = {
                openTime: k.t,
                open: parseFloat(k.o),
                high: parseFloat(k.h),
                low: parseFloat(k.l),
                close: parseFloat(k.c),
                volume: parseFloat(k.v),
                closeTime: k.T,
              };

              const currentKlines = klinesRef.current;
              const lastKline = currentKlines[currentKlines.length - 1];
              
              if (lastKline && lastKline.openTime === newKline.openTime) {
                const updated = [...currentKlines];
                updated[updated.length - 1] = newKline;
                klinesRef.current = updated;
                setKlines(updated);
              } else if (!lastKline || newKline.openTime > lastKline.openTime) {
                const updated = [...currentKlines, newKline].slice(-120);
                klinesRef.current = updated;
                setKlines(updated);
              }
              
              setCurrentPrice(newKline.close);
            }
            
            // Handle aggTrade for real-time price
            if (data.e === 'aggTrade') {
              setCurrentPrice(parseFloat(data.p));
            }
          } catch (error) {
            // Silently ignore parse errors
          }
        };

        ws.onerror = () => {
          // Error handling is done in onclose
        };

        ws.onclose = (event) => {
          if (pingInterval) {
            clearInterval(pingInterval);
          }
          
          if (isCleaningUpRef.current) return;
          
          console.log(`[WS] Disconnected: ${symbol} (code: ${event.code})`);
          setIsConnected(false);
          
          // Reconnect with exponential backoff, max 5 seconds
          const delay = Math.min(2000 + Math.random() * 1000, 5000);
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!isCleaningUpRef.current) {
              connect();
            }
          }, delay);
        };
      } catch (error) {
        console.error(`[WS ${symbol}] Failed to create WebSocket:`, error);
        // Retry after delay
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isCleaningUpRef.current) {
            connect();
          }
        }, 3000);
      }
    };

    // Initialize
    const init = async () => {
      const fetchPromises: Promise<boolean>[] = [];
      
      if (streams.includes('kline')) {
        fetchPromises.push(fetchInitialKlines());
      }
      if (streams.includes('depth')) {
        fetchPromises.push(fetchInitialOrderBook());
      }
      
      const results = await Promise.all(fetchPromises);
      
      if (isCleaningUpRef.current || signal.aborted) return;
      
      // Only connect if at least one fetch succeeded
      if (results.some(r => r)) {
        initialDataLoadedRef.current = true;
        connect();
      } else {
        // Retry init after delay
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isCleaningUpRef.current) {
            init();
          }
        }, 3000);
      }
    };
    
    init();

    return () => {
      isCleaningUpRef.current = true;
      
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectionKey, symbol, klineInterval, streams, depthLevel]);

  return { orderBook, klines, currentPrice, isConnected };
};
