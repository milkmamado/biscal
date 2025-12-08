import { useEffect, useRef, useState, useMemo } from 'react';
import { KlineData, OrderBook } from '@/lib/binance';

const BINANCE_WS_URL = 'wss://fstream.binance.com/ws';

// Update intervals (ms) - smoother like Binance app
const UPDATE_INTERVAL_MS = 250; // Single unified update interval

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
  const orderBookRef = useRef<OrderBook | null>(null);
  const currentPriceRef = useRef<number | null>(null);
  const initialDataLoadedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isCleaningUpRef = useRef(false);
  const updateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const initDelayRef = useRef<NodeJS.Timeout | null>(null);
  
  // Pending updates (accumulate between render cycles)
  const pendingOrderBookRef = useRef<OrderBook | null>(null);
  const pendingPriceRef = useRef<number | null>(null);
  const hasPendingUpdatesRef = useRef(false);
  
  // Stable key for this connection
  const connectionKey = useMemo(() => {
    const sortedStreams = [...streams].sort().join(',');
    return `${symbol}-${klineInterval}-${sortedStreams}`;
  }, [symbol, klineInterval, streams]);

  useEffect(() => {
    // Reset cleanup flag for new connection
    isCleaningUpRef.current = false;
    
    // Abort any previous fetch requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    // Clear previous timeouts/intervals
    if (initDelayRef.current) {
      clearTimeout(initDelayRef.current);
      initDelayRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (updateIntervalRef.current) {
      clearInterval(updateIntervalRef.current);
      updateIntervalRef.current = null;
    }
    
    // Close existing WebSocket
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Reset all refs
    initialDataLoadedRef.current = false;
    klinesRef.current = [];
    orderBookRef.current = null;
    currentPriceRef.current = null;
    pendingOrderBookRef.current = null;
    pendingPriceRef.current = null;
    hasPendingUpdatesRef.current = false;
    
    // Define all functions
    const fetchInitialKlines = async (): Promise<boolean> => {
      try {
        const response = await fetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${klineInterval}&limit=120`,
          { signal }
        );
        
        if (!response.ok) return false;
        
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
          const price = parsed[parsed.length - 1].close;
          setCurrentPrice(price);
          currentPriceRef.current = price;
        }
        return true;
      } catch (error: any) {
        if (error.name === 'AbortError') return false;
        return false;
      }
    };

    const fetchInitialOrderBook = async (): Promise<boolean> => {
      try {
        const response = await fetch(
          `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=${depthLevel}`,
          { signal }
        );
        
        if (!response.ok) return false;
        
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
        orderBookRef.current = parsed;
        return true;
      } catch (error: any) {
        if (error.name === 'AbortError') return false;
        return false;
      }
    };

    const connect = () => {
      if (isCleaningUpRef.current) return;
      
      // Close any existing connection
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }

      const streamNames: string[] = [];
      const lowerSymbol = symbol.toLowerCase();
      
      if (streams.includes('depth')) {
        streamNames.push(`${lowerSymbol}@depth@500ms`);
      }
      if (streams.includes('kline')) {
        streamNames.push(`${lowerSymbol}@kline_${klineInterval}`);
      }
      streamNames.push(`${lowerSymbol}@bookTicker`);

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
              const prev = pendingOrderBookRef.current || orderBookRef.current;
              
              if (!prev) {
                const newBook: OrderBook = {
                  bids: data.b.map(([p, q]: [string, string]) => ({ 
                    price: parseFloat(p), 
                    quantity: parseFloat(q) 
                  })).filter((l: any) => l.quantity > 0).sort((a: any, b: any) => b.price - a.price).slice(0, depthLevel),
                  asks: data.a.map(([p, q]: [string, string]) => ({ 
                    price: parseFloat(p), 
                    quantity: parseFloat(q) 
                  })).filter((l: any) => l.quantity > 0).sort((a: any, b: any) => a.price - b.price).slice(0, depthLevel),
                  lastUpdateId: data.u,
                };
                pendingOrderBookRef.current = newBook;
                hasPendingUpdatesRef.current = true;
                return;
              }
              
              const updateLevel = (levels: { price: number; quantity: number }[], updates: [string, string][]) => {
                const levelMap = new Map(levels.map(l => [l.price, l.quantity]));
                updates.forEach(([priceStr, qtyStr]) => {
                  const price = parseFloat(priceStr);
                  const quantity = parseFloat(qtyStr);
                  if (quantity === 0) {
                    levelMap.delete(price);
                  } else {
                    levelMap.set(price, quantity);
                  }
                });
                return Array.from(levelMap.entries()).map(([price, quantity]) => ({ price, quantity }));
              };

              const newBook: OrderBook = {
                bids: updateLevel(prev.bids, data.b).sort((a, b) => b.price - a.price).slice(0, depthLevel),
                asks: updateLevel(prev.asks, data.a).sort((a, b) => a.price - b.price).slice(0, depthLevel),
                lastUpdateId: data.u,
              };
              
              pendingOrderBookRef.current = newBook;
              hasPendingUpdatesRef.current = true;
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
            }
            
            // Handle bookTicker for price
            if (data.e === 'bookTicker' || (data.b && data.a && !data.e)) {
              const bestBid = parseFloat(data.b);
              const bestAsk = parseFloat(data.a);
              const midPrice = (bestBid + bestAsk) / 2;
              
              pendingPriceRef.current = midPrice;
              hasPendingUpdatesRef.current = true;
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
          
          // Reconnect with delay
          const delay = 3000 + Math.random() * 2000;
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!isCleaningUpRef.current) {
              connect();
            }
          }, delay);
        };
      } catch (error) {
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isCleaningUpRef.current) {
            connect();
          }
        }, 5000);
      }
    };

    const fetchWithRetry = async (fetchFn: () => Promise<boolean>, maxRetries = 2) => {
      for (let i = 0; i < maxRetries; i++) {
        if (isCleaningUpRef.current || signal.aborted) return false;
        const success = await fetchFn();
        if (success) return true;
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, i)));
      }
      return false;
    };

    const init = async () => {
      if (isCleaningUpRef.current) return;
      
      // Set up periodic state updates (batched rendering)
      const flushUpdates = () => {
        if (isCleaningUpRef.current) return;
        
        if (hasPendingUpdatesRef.current) {
          if (pendingOrderBookRef.current) {
            setOrderBook(pendingOrderBookRef.current);
            orderBookRef.current = pendingOrderBookRef.current;
          }
          if (pendingPriceRef.current !== null) {
            setCurrentPrice(pendingPriceRef.current);
            currentPriceRef.current = pendingPriceRef.current;
          }
          hasPendingUpdatesRef.current = false;
        }
      };
      
      updateIntervalRef.current = setInterval(flushUpdates, UPDATE_INTERVAL_MS);
      
      // Connect WebSocket first (most important for real-time)
      connect();
      
      // Fetch initial data
      if (streams.includes('kline')) {
        const success = await fetchWithRetry(fetchInitialKlines);
        if (success) initialDataLoadedRef.current = true;
      } else {
        initialDataLoadedRef.current = true;
      }
      
      if (streams.includes('depth')) {
        await fetchWithRetry(fetchInitialOrderBook);
      }
    };
    
    // Start initialization
    init();

    // Cleanup function
    return () => {
      isCleaningUpRef.current = true;
      
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      
      if (initDelayRef.current) {
        clearTimeout(initDelayRef.current);
        initDelayRef.current = null;
      }
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
        updateIntervalRef.current = null;
      }
      
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.onopen = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectionKey, symbol, klineInterval, streams, depthLevel]);

  return { orderBook, klines, currentPrice, isConnected };
};