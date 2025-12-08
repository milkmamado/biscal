import { useEffect, useRef, useState, useCallback } from 'react';
import { OrderBook } from '@/lib/binance';

const BINANCE_WS_URL = 'wss://fstream.binance.com/ws';
const BINANCE_REST_URL = 'https://fapi.binance.com';

// Render throttle - 150ms for smoother updates
const RENDER_INTERVAL_MS = 150;

// Minimum time between re-initializations (5 seconds)
const REINIT_COOLDOWN_MS = 5000;

// Global connection pool per symbol
const connectionPool = new Map<string, {
  ws: WebSocket | null;
  subscribers: Set<() => void>;
  state: OrderBookState | null;
  isInitialized: boolean;
  eventBuffer: DepthUpdate[];
  lastReinitTime: number;
  pendingRender: boolean;
  latency: number;
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
  const [latency, setLatency] = useState<number>(0);
  const mountedRef = useRef(true);
  const renderIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
        lastReinitTime: 0,
        pendingRender: false,
        latency: 0,
      };
      connectionPool.set(symbol, pool);
    }
    
    // Subscribe for updates
    const notifyUpdate = () => {
      const p = connectionPool.get(symbol);
      if (p?.state && mountedRef.current) {
        const rendered = stateToOrderBook(p.state, depthLevel);
        setOrderBook(rendered);
      }
    };
    pool.subscribers.add(notifyUpdate);
    
    // If already has data, use it immediately
    if (pool.state) {
      const rendered = stateToOrderBook(pool.state, depthLevel);
      setOrderBook(rendered);
    }
    
    // If no active connection, create one
    if (!pool.ws || pool.ws.readyState === WebSocket.CLOSED) {
      connectWebSocket(symbol, setIsConnected);
    } else if (pool.ws.readyState === WebSocket.OPEN) {
      setIsConnected(true);
    }
    
    // Set up render interval
    renderIntervalRef.current = setInterval(() => {
      const p = connectionPool.get(symbol);
      if (p && mountedRef.current) {
        if (p.pendingRender && p.state) {
          p.pendingRender = false;
          const rendered = stateToOrderBook(p.state, depthLevel);
          setOrderBook(rendered);
        }
        // Update latency
        if (p.latency !== latency) {
          setLatency(p.latency);
        }
      }
    }, RENDER_INTERVAL_MS);
    
    return () => {
      mountedRef.current = false;
      
      if (renderIntervalRef.current) {
        clearInterval(renderIntervalRef.current);
      }
      
      const p = connectionPool.get(symbol);
      if (p) {
        p.subscribers.delete(notifyUpdate);
        
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
  }, [symbol, depthLevel]);

  return { orderBook, isConnected, latency };
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
function connectWebSocket(
  symbol: string,
  setConnected: (v: boolean) => void
) {
  const pool = connectionPool.get(symbol);
  if (!pool) return;
  
  let snapshotInProgress = false;
  
  // Fetch initial snapshot
  const fetchSnapshot = async (): Promise<boolean> => {
    if (snapshotInProgress) return false;
    snapshotInProgress = true;
    
    try {
      const response = await fetch(
        `${BINANCE_REST_URL}/fapi/v1/depth?symbol=${symbol}&limit=50`
      );
      if (!response.ok) {
        snapshotInProgress = false;
        return false;
      }
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
      pool.pendingRender = true;
      
      // Notify all subscribers
      pool.subscribers.forEach(fn => fn());
      
      snapshotInProgress = false;
      return true;
    } catch (error) {
      console.error('[OrderBook] Snapshot fetch error:', error);
      snapshotInProgress = false;
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
    
    // Apply all valid events without strict continuity check
    let state = p.state;
    for (const event of validEvents) {
      if (event.U <= state.lastUpdateId + 1) {
        state = applyDepthUpdate(state, event);
      }
    }
    
    p.state = state;
    p.eventBuffer = [];
  };
  
  // Handle depth update
  const handleDepthUpdate = (data: DepthUpdate) => {
    const p = connectionPool.get(symbol);
    if (!p) return;
    
    if (!p.isInitialized) {
      // Buffer events until snapshot is ready (max 100)
      if (p.eventBuffer.length < 100) {
        p.eventBuffer.push(data);
      }
      return;
    }
    
    if (!p.state) return;
    
    const now = Date.now();
    const expectedPu = p.state.lastUpdateId;
    const actualPu = data.pu;
    
    // Check for large gap that requires re-initialization
    // Only reinitialize if cooldown period has passed
    if (Math.abs(actualPu - expectedPu) > 1000) {
      if (now - p.lastReinitTime > REINIT_COOLDOWN_MS) {
        console.warn(`[OrderBook] Large gap: expected ${expectedPu}, got pu=${actualPu}. Re-initializing...`);
        p.isInitialized = false;
        p.eventBuffer = [data];
        p.lastReinitTime = now;
        fetchSnapshot();
      }
      return;
    }
    
    // Apply update regardless of small gaps
    // The orderbook will self-correct over time
    p.state = applyDepthUpdate(p.state, data);
    p.pendingRender = true;
  };
  
  // Create WebSocket connection - use 500ms for less frequent updates
  const lowerSymbol = symbol.toLowerCase();
  const wsUrl = `${BINANCE_WS_URL}/${lowerSymbol}@depth@500ms`;
  
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
          // Calculate latency from event time (E) to now
          // Use absolute value since clock sync differences can cause negative values
          const eventTime = data.E; // Binance server time in ms
          const now = Date.now();
          const calculatedLatency = Math.abs(now - eventTime);
          const p = connectionPool.get(symbol);
          if (p) {
            p.latency = calculatedLatency;
          }
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
        // Reconnect after delay with jitter
        setTimeout(() => {
          const current = connectionPool.get(symbol);
          if (current && current.subscribers.size > 0) {
            current.isInitialized = false;
            current.eventBuffer = [];
            connectWebSocket(symbol, setConnected);
          }
        }, 2000 + Math.random() * 3000);
      }
    };
  } catch (error) {
    console.error('[OrderBook WS] Connection error:', error);
  }
}

export default useOrderBookWebSocket;
