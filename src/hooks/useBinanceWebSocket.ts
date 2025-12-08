import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { KlineData, OrderBook } from '@/lib/binance';

const BINANCE_WS_URL = 'wss://fstream.binance.com/ws';
const BINANCE_REST_URL = 'https://fapi.binance.com';

// Render throttle
const RENDER_INTERVAL_MS = 100;

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

interface DepthUpdate {
  e: string;
  E: number;
  s: string;
  U: number; // First update ID
  u: number; // Final update ID
  pu: number; // Previous final update ID
  b: [string, string][];
  a: [string, string][];
}

interface OrderBookState {
  lastUpdateId: number;
  bids: Map<number, number>;
  asks: Map<number, number>;
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
  
  // Refs for internal state
  const orderBookStateRef = useRef<OrderBookState | null>(null);
  const eventBufferRef = useRef<DepthUpdate[]>([]);
  const isInitializedRef = useRef(false);
  const klinesRef = useRef<KlineData[]>([]);
  const currentPriceRef = useRef<number | null>(null);
  
  // Control refs
  const wsRef = useRef<WebSocket | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const renderIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isCleaningUpRef = useRef(false);
  
  // Pending render state
  const pendingRenderRef = useRef(false);
  
  const connectionKey = useMemo(() => {
    const sortedStreams = [...streams].sort().join(',');
    return `${symbol}-${klineInterval}-${sortedStreams}`;
  }, [symbol, klineInterval, streams]);

  // Convert Map to sorted array for rendering
  const mapToSortedArray = useCallback((
    map: Map<number, number>, 
    ascending: boolean,
    limit: number
  ): { price: number; quantity: number }[] => {
    const entries = Array.from(map.entries())
      .filter(([_, qty]) => qty > 0)
      .map(([price, quantity]) => ({ price, quantity }));
    
    entries.sort((a, b) => ascending ? a.price - b.price : b.price - a.price);
    return entries.slice(0, limit);
  }, []);

  // Apply depth update to Map
  const applyDepthUpdate = useCallback((
    state: OrderBookState,
    update: DepthUpdate
  ): OrderBookState => {
    const newBids = new Map(state.bids);
    const newAsks = new Map(state.asks);
    
    // Update bids
    update.b.forEach(([priceStr, qtyStr]) => {
      const price = parseFloat(priceStr);
      const qty = parseFloat(qtyStr);
      if (qty === 0) {
        newBids.delete(price);
      } else {
        newBids.set(price, qty);
      }
    });
    
    // Update asks
    update.a.forEach(([priceStr, qtyStr]) => {
      const price = parseFloat(priceStr);
      const qty = parseFloat(qtyStr);
      if (qty === 0) {
        newAsks.delete(price);
      } else {
        newAsks.set(price, qty);
      }
    });
    
    return {
      lastUpdateId: update.u,
      bids: newBids,
      asks: newAsks,
    };
  }, []);

  // Render current state to React state
  const flushRender = useCallback(() => {
    if (isCleaningUpRef.current || !pendingRenderRef.current) return;
    
    const state = orderBookStateRef.current;
    if (state) {
      const rendered: OrderBook = {
        bids: mapToSortedArray(state.bids, false, depthLevel),
        asks: mapToSortedArray(state.asks, true, depthLevel),
        lastUpdateId: state.lastUpdateId,
      };
      setOrderBook(rendered);
    }
    
    if (currentPriceRef.current !== null) {
      setCurrentPrice(currentPriceRef.current);
    }
    
    pendingRenderRef.current = false;
  }, [depthLevel, mapToSortedArray]);

  useEffect(() => {
    isCleaningUpRef.current = false;
    
    // Abort previous requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    // Clear previous resources
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (renderIntervalRef.current) {
      clearInterval(renderIntervalRef.current);
      renderIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Reset state
    orderBookStateRef.current = null;
    eventBufferRef.current = [];
    isInitializedRef.current = false;
    klinesRef.current = [];
    currentPriceRef.current = null;
    pendingRenderRef.current = false;
    
    // Functions
    const fetchSnapshot = async (): Promise<boolean> => {
      try {
        // Fetch with limit=100 for sufficient depth
        const response = await fetch(
          `${BINANCE_REST_URL}/fapi/v1/depth?symbol=${symbol}&limit=100`,
          { signal }
        );
        
        if (!response.ok) return false;
        const data = await response.json();
        
        if (signal.aborted || isCleaningUpRef.current) return false;
        
        // Initialize with Map structure
        const bidsMap = new Map<number, number>();
        const asksMap = new Map<number, number>();
        
        data.bids.forEach(([p, q]: [string, string]) => {
          bidsMap.set(parseFloat(p), parseFloat(q));
        });
        data.asks.forEach(([p, q]: [string, string]) => {
          asksMap.set(parseFloat(p), parseFloat(q));
        });
        
        orderBookStateRef.current = {
          lastUpdateId: data.lastUpdateId,
          bids: bidsMap,
          asks: asksMap,
        };
        
        console.log(`[OrderBook] Snapshot loaded: lastUpdateId=${data.lastUpdateId}`);
        
        // Process buffered events
        processBuffer(data.lastUpdateId);
        
        isInitializedRef.current = true;
        pendingRenderRef.current = true;
        
        return true;
      } catch (error: any) {
        if (error.name === 'AbortError') return false;
        console.error('[OrderBook] Snapshot fetch error:', error);
        return false;
      }
    };
    
    const processBuffer = (snapshotLastUpdateId: number) => {
      const buffer = eventBufferRef.current;
      
      // Filter valid events (u > lastUpdateId from snapshot)
      const validEvents = buffer.filter(e => e.u > snapshotLastUpdateId);
      
      if (validEvents.length === 0) {
        eventBufferRef.current = [];
        return;
      }
      
      // Sort by U (first update ID)
      validEvents.sort((a, b) => a.U - b.U);
      
      // Find first valid event: U <= lastUpdateId+1 <= u
      const firstValidIdx = validEvents.findIndex(
        e => e.U <= snapshotLastUpdateId + 1 && e.u >= snapshotLastUpdateId + 1
      );
      
      if (firstValidIdx === -1) {
        console.warn('[OrderBook] No valid event found in buffer, waiting for more...');
        eventBufferRef.current = validEvents;
        return;
      }
      
      // Apply valid events
      let state = orderBookStateRef.current!;
      for (let i = firstValidIdx; i < validEvents.length; i++) {
        const event = validEvents[i];
        
        // Verify continuity (pu should match previous u)
        if (i > firstValidIdx && event.pu !== validEvents[i - 1].u) {
          console.warn('[OrderBook] Continuity break in buffer, will use partial data');
          break;
        }
        
        state = applyDepthUpdate(state, event);
      }
      
      orderBookStateRef.current = state;
      eventBufferRef.current = [];
      console.log(`[OrderBook] Buffer processed: ${validEvents.length - firstValidIdx} events applied`);
    };
    
    const handleDepthUpdate = (data: DepthUpdate) => {
      if (!isInitializedRef.current) {
        // Buffer events until snapshot is ready
        eventBufferRef.current.push(data);
        return;
      }
      
      const state = orderBookStateRef.current;
      if (!state) return;
      
      // Verify continuity: pu should equal current lastUpdateId
      if (data.pu !== state.lastUpdateId) {
        console.warn(`[OrderBook] Continuity break: expected pu=${state.lastUpdateId}, got ${data.pu}. Re-initializing...`);
        
        // Re-initialize
        isInitializedRef.current = false;
        eventBufferRef.current = [data];
        fetchSnapshot();
        return;
      }
      
      // Apply update
      orderBookStateRef.current = applyDepthUpdate(state, data);
      pendingRenderRef.current = true;
    };
    
    const fetchInitialKlines = async (): Promise<boolean> => {
      try {
        const response = await fetch(
          `${BINANCE_REST_URL}/fapi/v1/klines?symbol=${symbol}&interval=${klineInterval}&limit=120`,
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
          currentPriceRef.current = price;
          setCurrentPrice(price);
        }
        
        return true;
      } catch (error: any) {
        if (error.name === 'AbortError') return false;
        return false;
      }
    };
    
    const connect = () => {
      if (isCleaningUpRef.current) return;
      
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      
      const streamNames: string[] = [];
      const lowerSymbol = symbol.toLowerCase();
      
      if (streams.includes('depth')) {
        // Use 100ms for faster updates
        streamNames.push(`${lowerSymbol}@depth@100ms`);
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
            
            // Depth update
            if (data.e === 'depthUpdate') {
              handleDepthUpdate(data as DepthUpdate);
            }
            
            // Kline update
            if (data.e === 'kline') {
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
              
              const current = klinesRef.current;
              if (current.length === 0) return;
              
              const last = current[current.length - 1];
              
              if (last.openTime === newKline.openTime) {
                const updated = [...current];
                updated[updated.length - 1] = newKline;
                klinesRef.current = updated;
                setKlines(updated);
              } else if (newKline.openTime > last.openTime) {
                const updated = [...current, newKline].slice(-120);
                klinesRef.current = updated;
                setKlines(updated);
              }
            }
            
            // Book ticker for price
            if (data.e === 'bookTicker' || (data.b && data.a && !data.e)) {
              const bestBid = parseFloat(data.b);
              const bestAsk = parseFloat(data.a);
              currentPriceRef.current = (bestBid + bestAsk) / 2;
              pendingRenderRef.current = true;
            }
          } catch (error) {
            // Ignore parse errors
          }
        };
        
        ws.onerror = () => {
          // Handled in onclose
        };
        
        ws.onclose = (event) => {
          if (pingInterval) clearInterval(pingInterval);
          if (isCleaningUpRef.current) return;
          
          console.log(`[WS] Disconnected: ${symbol} (code: ${event.code})`);
          setIsConnected(false);
          
          // Reconnect with jitter
          const delay = 2000 + Math.random() * 2000;
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!isCleaningUpRef.current) {
              // Reset orderbook state on reconnect
              isInitializedRef.current = false;
              eventBufferRef.current = [];
              connect();
              if (streams.includes('depth')) {
                fetchSnapshot();
              }
            }
          }, delay);
        };
      } catch (error) {
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isCleaningUpRef.current) connect();
        }, 5000);
      }
    };
    
    const init = async () => {
      if (isCleaningUpRef.current) return;
      
      // Set up render interval
      renderIntervalRef.current = setInterval(flushRender, RENDER_INTERVAL_MS);
      
      // Connect WebSocket first
      connect();
      
      // Fetch initial data
      const fetchPromises: Promise<boolean>[] = [];
      
      if (streams.includes('kline')) {
        fetchPromises.push(fetchInitialKlines());
      }
      if (streams.includes('depth')) {
        fetchPromises.push(fetchSnapshot());
      }
      
      await Promise.all(fetchPromises);
    };
    
    init();
    
    return () => {
      isCleaningUpRef.current = true;
      
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (renderIntervalRef.current) {
        clearInterval(renderIntervalRef.current);
        renderIntervalRef.current = null;
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
  }, [connectionKey, symbol, klineInterval, streams, depthLevel, applyDepthUpdate, flushRender]);

  return { orderBook, klines, currentPrice, isConnected };
};
