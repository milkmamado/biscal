import { useEffect, useRef, useState, useCallback } from 'react';
import { OrderBook } from '@/lib/binance';

const BINANCE_WS_URL = 'wss://fstream.binance.com/ws';
const BINANCE_REST_URL = 'https://fapi.binance.com';

// Render throttle - 100ms for smooth updates
const RENDER_INTERVAL_MS = 100;

// Global connection pool per symbol
const connectionPool = new Map<string, {
  ws: WebSocket | null;
  subscribers: Set<(data: OrderBook) => void>;
  state: OrderBookState | null;
  isInitialized: boolean;
  eventBuffer: DepthUpdate[];
}>();

interface DepthUpdate {
  e: string;
  E: number;
  s: string;
  U: number;
  u: number;
  pu: number;
  b: [string, string][];
  a: [string, string][];
}

interface OrderBookState {
  lastUpdateId: number;
  bids: Map<number, number>;
  asks: Map<number, number>;
}

export const useOrderBookWebSocket = (symbol: string, depthLevel: number = 15) => {
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const mountedRef = useRef(true);
  const renderTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastRenderRef = useRef(0);

  // Throttled render function
  const scheduleRender = useCallback((state: OrderBookState) => {
    const now = Date.now();
    const elapsed = now - lastRenderRef.current;
    
    if (elapsed >= RENDER_INTERVAL_MS) {
      // Render immediately
      lastRenderRef.current = now;
      const rendered = stateToOrderBook(state, depthLevel);
      if (mountedRef.current) {
        setOrderBook(rendered);
      }
    } else {
      // Schedule render
      if (renderTimeoutRef.current) return; // Already scheduled
      renderTimeoutRef.current = setTimeout(() => {
        renderTimeoutRef.current = null;
        lastRenderRef.current = Date.now();
        const pool = connectionPool.get(symbol);
        if (pool?.state && mountedRef.current) {
          const rendered = stateToOrderBook(pool.state, depthLevel);
          setOrderBook(rendered);
        }
      }, RENDER_INTERVAL_MS - elapsed);
    }
  }, [symbol, depthLevel]);

  useEffect(() => {
    mountedRef.current = true;
    
    // Get or create connection pool entry
    let pool = connectionPool.get(symbol);
    if (!pool) {
      pool = {
        ws: null,
        subscribers: new Set(),
        state: null,
        isInitialized: false,
        eventBuffer: [],
      };
      connectionPool.set(symbol, pool);
    }
    
    // Subscribe
    const subscriber = (data: OrderBook) => {
      if (mountedRef.current) {
        setOrderBook(data);
      }
    };
    pool.subscribers.add(subscriber);
    
    // If already has data, use it immediately
    if (pool.state) {
      const rendered = stateToOrderBook(pool.state, depthLevel);
      setOrderBook(rendered);
    }
    
    // If no active connection, create one
    if (!pool.ws || pool.ws.readyState === WebSocket.CLOSED) {
      connectWebSocket(symbol, depthLevel, scheduleRender, setIsConnected);
    } else if (pool.ws.readyState === WebSocket.OPEN) {
      setIsConnected(true);
    }
    
    return () => {
      mountedRef.current = false;
      
      if (renderTimeoutRef.current) {
        clearTimeout(renderTimeoutRef.current);
      }
      
      const p = connectionPool.get(symbol);
      if (p) {
        p.subscribers.delete(subscriber);
        
        // If no more subscribers, close connection after delay
        if (p.subscribers.size === 0) {
          setTimeout(() => {
            const current = connectionPool.get(symbol);
            if (current && current.subscribers.size === 0) {
              current.ws?.close();
              connectionPool.delete(symbol);
            }
          }, 5000);
        }
      }
    };
  }, [symbol, depthLevel, scheduleRender]);

  return { orderBook, isConnected };
};

// Convert internal state to OrderBook format
function stateToOrderBook(state: OrderBookState, limit: number): OrderBook {
  const bids = Array.from(state.bids.entries())
    .filter(([_, qty]) => qty > 0)
    .map(([price, quantity]) => ({ price, quantity }))
    .sort((a, b) => b.price - a.price)
    .slice(0, limit);
    
  const asks = Array.from(state.asks.entries())
    .filter(([_, qty]) => qty > 0)
    .map(([price, quantity]) => ({ price, quantity }))
    .sort((a, b) => a.price - b.price)
    .slice(0, limit);
    
  return { bids, asks, lastUpdateId: state.lastUpdateId };
}

// Apply depth update to state
function applyDepthUpdate(state: OrderBookState, update: DepthUpdate): OrderBookState {
  const newBids = new Map(state.bids);
  const newAsks = new Map(state.asks);
  
  update.b.forEach(([priceStr, qtyStr]) => {
    const price = parseFloat(priceStr);
    const qty = parseFloat(qtyStr);
    if (qty === 0) {
      newBids.delete(price);
    } else {
      newBids.set(price, qty);
    }
  });
  
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
}

// Connect WebSocket for a symbol
async function connectWebSocket(
  symbol: string,
  depthLevel: number,
  onUpdate: (state: OrderBookState) => void,
  setConnected: (v: boolean) => void
) {
  const pool = connectionPool.get(symbol);
  if (!pool) return;
  
  // Fetch initial snapshot
  const fetchSnapshot = async (): Promise<boolean> => {
    try {
      const response = await fetch(
        `${BINANCE_REST_URL}/fapi/v1/depth?symbol=${symbol}&limit=100`
      );
      if (!response.ok) return false;
      const data = await response.json();
      
      const bidsMap = new Map<number, number>();
      const asksMap = new Map<number, number>();
      
      data.bids.forEach(([p, q]: [string, string]) => {
        bidsMap.set(parseFloat(p), parseFloat(q));
      });
      data.asks.forEach(([p, q]: [string, string]) => {
        asksMap.set(parseFloat(p), parseFloat(q));
      });
      
      pool.state = {
        lastUpdateId: data.lastUpdateId,
        bids: bidsMap,
        asks: asksMap,
      };
      
      // Process buffered events
      processBuffer(symbol, data.lastUpdateId);
      pool.isInitialized = true;
      
      // Notify subscribers
      if (pool.state) {
        onUpdate(pool.state);
      }
      
      return true;
    } catch (error) {
      console.error('[OrderBook] Snapshot fetch error:', error);
      return false;
    }
  };
  
  // Process buffered events after snapshot
  const processBuffer = (sym: string, snapshotLastUpdateId: number) => {
    const p = connectionPool.get(sym);
    if (!p || !p.state) return;
    
    const buffer = p.eventBuffer;
    const validEvents = buffer.filter(e => e.u > snapshotLastUpdateId);
    
    if (validEvents.length === 0) {
      p.eventBuffer = [];
      return;
    }
    
    validEvents.sort((a, b) => a.U - b.U);
    
    const firstValidIdx = validEvents.findIndex(
      e => e.U <= snapshotLastUpdateId + 1 && e.u >= snapshotLastUpdateId + 1
    );
    
    if (firstValidIdx === -1) {
      p.eventBuffer = validEvents;
      return;
    }
    
    let state = p.state;
    for (let i = firstValidIdx; i < validEvents.length; i++) {
      state = applyDepthUpdate(state, validEvents[i]);
    }
    
    p.state = state;
    p.eventBuffer = [];
  };
  
  // Handle depth update
  const handleDepthUpdate = (data: DepthUpdate) => {
    const p = connectionPool.get(symbol);
    if (!p) return;
    
    if (!p.isInitialized) {
      p.eventBuffer.push(data);
      return;
    }
    
    if (!p.state) return;
    
    // Relaxed continuity check - allow small gaps
    const expectedPu = p.state.lastUpdateId;
    const actualPu = data.pu;
    
    // If gap is too large (more than 100 updates), re-initialize
    if (actualPu > expectedPu + 100 || actualPu < expectedPu - 100) {
      console.warn(`[OrderBook] Large gap detected: expected ~${expectedPu}, got pu=${actualPu}. Re-initializing...`);
      p.isInitialized = false;
      p.eventBuffer = [data];
      fetchSnapshot();
      return;
    }
    
    // Apply update even with small gaps
    p.state = applyDepthUpdate(p.state, data);
    onUpdate(p.state);
  };
  
  // Create WebSocket connection
  const lowerSymbol = symbol.toLowerCase();
  const wsUrl = `${BINANCE_WS_URL}/${lowerSymbol}@depth@100ms`;
  
  try {
    const ws = new WebSocket(wsUrl);
    pool.ws = ws;
    
    ws.onopen = () => {
      console.log(`[OrderBook WS] Connected: ${symbol}`);
      setConnected(true);
      fetchSnapshot();
    };
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.e === 'depthUpdate') {
          handleDepthUpdate(data as DepthUpdate);
        }
      } catch (e) {
        // Ignore parse errors
      }
    };
    
    ws.onerror = () => {
      console.warn(`[OrderBook WS] Error: ${symbol}`);
    };
    
    ws.onclose = () => {
      console.log(`[OrderBook WS] Closed: ${symbol}`);
      setConnected(false);
      
      const p = connectionPool.get(symbol);
      if (p && p.subscribers.size > 0) {
        // Reconnect after delay
        setTimeout(() => {
          const current = connectionPool.get(symbol);
          if (current && current.subscribers.size > 0) {
            current.isInitialized = false;
            current.eventBuffer = [];
            connectWebSocket(symbol, depthLevel, onUpdate, setConnected);
          }
        }, 2000 + Math.random() * 2000);
      }
    };
  } catch (error) {
    console.error('[OrderBook WS] Connection error:', error);
  }
}

export default useOrderBookWebSocket;
