import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { KlineData, OrderBook } from '@/lib/binance';

const BINANCE_WS_URL = 'wss://fstream.binance.com/ws';

// Throttling intervals (ms) - similar to Binance app smoothness
const PRICE_THROTTLE_MS = 200;  // Price updates every 200ms
const DEPTH_THROTTLE_MS = 300;  // Order book updates every 300ms

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
  
  // Throttling refs
  const lastPriceUpdateRef = useRef<number>(0);
  const lastDepthUpdateRef = useRef<number>(0);
  const pendingPriceRef = useRef<number | null>(null);
  const pendingDepthRef = useRef<OrderBook | null>(null);
  const priceThrottleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const depthThrottleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
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
        // Use 500ms depth updates instead of 100ms for smoother UI
        streamNames.push(`${lowerSymbol}@depth@500ms`);
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
            const now = Date.now();
            
            // Handle depth updates with throttling
            if (data.e === 'depthUpdate') {
              const updateOrderBook = (prev: OrderBook | null): OrderBook | null => {
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
              };
              
              // Throttle depth updates
              const timeSinceLastDepth = now - lastDepthUpdateRef.current;
              if (timeSinceLastDepth >= DEPTH_THROTTLE_MS) {
                lastDepthUpdateRef.current = now;
                setOrderBook(updateOrderBook);
              } else {
                // Store pending and schedule update
                setOrderBook(prev => {
                  pendingDepthRef.current = updateOrderBook(prev);
                  return prev; // Don't update yet
                });
                
                if (!depthThrottleTimeoutRef.current) {
                  depthThrottleTimeoutRef.current = setTimeout(() => {
                    if (!isCleaningUpRef.current && pendingDepthRef.current) {
                      lastDepthUpdateRef.current = Date.now();
                      setOrderBook(pendingDepthRef.current);
                      pendingDepthRef.current = null;
                    }
                    depthThrottleTimeoutRef.current = null;
                  }, DEPTH_THROTTLE_MS - timeSinceLastDepth);
                }
              }
            }
            
            // Handle kline updates (no throttling needed - already slow)
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
              
              // Throttle price update from kline
              const timeSinceLastPrice = now - lastPriceUpdateRef.current;
              if (timeSinceLastPrice >= PRICE_THROTTLE_MS) {
                lastPriceUpdateRef.current = now;
                setCurrentPrice(newKline.close);
              }
            }
            
            // Handle aggTrade with throttling for smooth price updates
            if (data.e === 'aggTrade') {
              const price = parseFloat(data.p);
              const timeSinceLastPrice = now - lastPriceUpdateRef.current;
              
              if (timeSinceLastPrice >= PRICE_THROTTLE_MS) {
                lastPriceUpdateRef.current = now;
                setCurrentPrice(price);
              } else {
                // Store pending price and schedule update
                pendingPriceRef.current = price;
                
                if (!priceThrottleTimeoutRef.current) {
                  priceThrottleTimeoutRef.current = setTimeout(() => {
                    if (!isCleaningUpRef.current && pendingPriceRef.current !== null) {
                      lastPriceUpdateRef.current = Date.now();
                      setCurrentPrice(pendingPriceRef.current);
                      pendingPriceRef.current = null;
                    }
                    priceThrottleTimeoutRef.current = null;
                  }, PRICE_THROTTLE_MS - timeSinceLastPrice);
                }
              }
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
          
          // Reconnect with exponential backoff, 5-15 seconds (longer to avoid rate limit)
          const delay = 5000 + Math.random() * 10000;
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!isCleaningUpRef.current) {
              connect();
            }
          }, delay);
        };
      } catch (error) {
        console.error(`[WS ${symbol}] Failed to create WebSocket:`, error);
        // Retry after longer delay
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isCleaningUpRef.current) {
            connect();
          }
        }, 10000);
      }
    };

    // Initialize - fetch data and connect WebSocket separately
    const init = async () => {
      // Start WebSocket connection immediately (don't wait for fetch)
      connect();
      
      // Fetch initial data in parallel
      const fetchPromises: Promise<boolean>[] = [];
      
      if (streams.includes('kline')) {
        fetchPromises.push(fetchInitialKlines());
      }
      if (streams.includes('depth')) {
        fetchPromises.push(fetchInitialOrderBook());
      }
      
      const results = await Promise.all(fetchPromises);
      
      if (isCleaningUpRef.current || signal.aborted) return;
      
      // Mark initial data as loaded if kline fetch succeeded
      if (streams.includes('kline') && results[0]) {
        initialDataLoadedRef.current = true;
      } else if (!streams.includes('kline')) {
        initialDataLoadedRef.current = true;
      }
      
      // If all fetches failed, retry after delay
      if (!results.some(r => r)) {
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isCleaningUpRef.current) {
            // Refetch only, WebSocket is already connected
            const retryFetch = async () => {
              if (streams.includes('kline')) {
                const success = await fetchInitialKlines();
                if (success) initialDataLoadedRef.current = true;
              }
              if (streams.includes('depth')) {
                await fetchInitialOrderBook();
              }
            };
            retryFetch();
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
      
      if (priceThrottleTimeoutRef.current) {
        clearTimeout(priceThrottleTimeoutRef.current);
        priceThrottleTimeoutRef.current = null;
      }
      
      if (depthThrottleTimeoutRef.current) {
        clearTimeout(depthThrottleTimeoutRef.current);
        depthThrottleTimeoutRef.current = null;
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
