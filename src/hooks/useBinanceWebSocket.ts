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
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const klinesRef = useRef<KlineData[]>([]);
  const initialDataLoadedRef = useRef(false);
  
  // Memoize streams to prevent unnecessary reconnections
  const streamsKey = useMemo(() => streams.sort().join(','), [streams]);

  // Initial data fetch for klines (need history)
  const fetchInitialKlines = useCallback(async () => {
    try {
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${klineInterval}&limit=120`
      );
      const data = await response.json();
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
    } catch (error) {
      console.error('Failed to fetch initial klines:', error);
    }
  }, [symbol, klineInterval]);

  // Initial orderbook fetch
  const fetchInitialOrderBook = useCallback(async () => {
    try {
      const response = await fetch(
        `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=${depthLevel}`
      );
      const data = await response.json();
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
    } catch (error) {
      console.error('Failed to fetch initial orderbook:', error);
    }
  }, [symbol, depthLevel]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }

    const streamNames: string[] = [];
    const lowerSymbol = symbol.toLowerCase();
    
    if (streams.includes('depth')) {
      streamNames.push(`${lowerSymbol}@depth@100ms`);
    }
    if (streams.includes('kline')) {
      streamNames.push(`${lowerSymbol}@kline_${klineInterval}`);
    }
    // Always add aggTrade for real-time price
    streamNames.push(`${lowerSymbol}@aggTrade`);

    const wsUrl = `${BINANCE_WS_URL}/${streamNames.join('/')}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('Binance WebSocket connected:', streamNames);
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
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
        
        // Handle kline updates - only process if initial data is loaded
        if (data.e === 'kline' && initialDataLoadedRef.current) {
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
          if (currentKlines.length === 0) return; // Skip if no initial data yet
          
          const lastKline = currentKlines[currentKlines.length - 1];
          
          if (lastKline && lastKline.openTime === newKline.openTime) {
            // Update existing candle
            const updated = [...currentKlines];
            updated[updated.length - 1] = newKline;
            klinesRef.current = updated;
            setKlines(updated);
          } else if (!lastKline || newKline.openTime > lastKline.openTime) {
            // New candle
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
        console.error('WebSocket message parse error:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('Binance WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('Binance WebSocket closed, reconnecting in 1s...');
      setIsConnected(false);
      reconnectTimeoutRef.current = setTimeout(connect, 1000);
    };

    wsRef.current = ws;
  }, [symbol, streams, klineInterval, depthLevel]);

  useEffect(() => {
    // Reset initial data flag on symbol/interval change
    initialDataLoadedRef.current = false;
    
    // Fetch initial data first, then connect WebSocket
    const init = async () => {
      if (streams.includes('kline')) {
        await fetchInitialKlines();
      }
      if (streams.includes('depth')) {
        await fetchInitialOrderBook();
      }
      initialDataLoadedRef.current = true;
      // Connect WebSocket after initial data is loaded
      connect();
    };
    
    init();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [symbol, klineInterval, streamsKey]);

  return { orderBook, klines, currentPrice, isConnected };
};
