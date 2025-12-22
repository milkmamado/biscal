import { useState, useEffect, useRef, useCallback } from 'react';
import { formatPrice } from '@/lib/binance';

interface OrderBookProps {
  symbol: string;
  isTestnet?: boolean;
}

interface OrderBookEntry {
  price: number;
  quantity: number;
  total: number;
}

interface OrderBookData {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  spread: number;
  spreadPercent: number;
}

const WS_URLS = {
  mainnet: 'wss://fstream.binance.com/ws',
  testnet: 'wss://stream.binancefuture.com/ws',
};

export function OrderBook({ symbol, isTestnet = false }: OrderBookProps) {
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const processDepthData = useCallback((data: any) => {
    if (!data.b || !data.a) return;

    // Parse bids (buy orders) - sorted high to low
    const bids: OrderBookEntry[] = data.b
      .slice(0, 8)
      .map((b: [string, string]) => ({
        price: parseFloat(b[0]),
        quantity: parseFloat(b[1]),
        total: parseFloat(b[0]) * parseFloat(b[1]),
      }));

    // Parse asks (sell orders) - sorted low to high
    const asks: OrderBookEntry[] = data.a
      .slice(0, 8)
      .map((a: [string, string]) => ({
        price: parseFloat(a[0]),
        quantity: parseFloat(a[1]),
        total: parseFloat(a[0]) * parseFloat(a[1]),
      }))
      .reverse(); // Reverse to show lowest ask at bottom

    // Calculate spread
    const bestBid = bids[0]?.price || 0;
    const bestAsk = data.a[0] ? parseFloat(data.a[0][0]) : 0;
    const spread = bestAsk - bestBid;
    const spreadPercent = bestBid > 0 ? (spread / bestBid) * 100 : 0;

    setOrderBook({ bids, asks, spread, spreadPercent });
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const wsUrl = isTestnet ? WS_URLS.testnet : WS_URLS.mainnet;
    const streamName = `${symbol.toLowerCase()}@depth20@100ms`;
    
    try {
      wsRef.current = new WebSocket(`${wsUrl}/${streamName}`);

      wsRef.current.onopen = () => {
        setIsConnected(true);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          processDepthData(data);
        } catch (e) {
          console.error('OrderBook parse error:', e);
        }
      };

      wsRef.current.onerror = () => {
        setIsConnected(false);
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        // Reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };
    } catch (e) {
      console.error('OrderBook connection error:', e);
    }
  }, [symbol, isTestnet, processDepthData]);

  // Connect on mount and symbol change
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [symbol, connect]);

  // Calculate max quantity for bar width
  const maxQty = orderBook
    ? Math.max(
        ...orderBook.bids.map((b) => b.quantity),
        ...orderBook.asks.map((a) => a.quantity)
      )
    : 0;

  const formatQty = (qty: number) => {
    if (qty >= 1000000) return (qty / 1000000).toFixed(1) + 'M';
    if (qty >= 1000) return (qty / 1000).toFixed(1) + 'K';
    return qty.toFixed(2);
  };

  if (!orderBook) {
    return (
      <div className="relative z-10 mx-3 mb-2 px-3 py-2 rounded-md text-center" style={{
        background: 'rgba(0, 255, 255, 0.05)',
        border: '1px solid rgba(0, 255, 255, 0.15)',
      }}>
        <span className="text-[10px] text-gray-500">호가창 로딩중...</span>
      </div>
    );
  }

  return (
    <div className="relative z-10 mx-3 mb-2 rounded-md overflow-hidden" style={{
      background: 'rgba(10, 10, 20, 0.8)',
      border: '1px solid rgba(0, 255, 255, 0.15)',
    }}>
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1" style={{
        background: 'rgba(0, 255, 255, 0.05)',
        borderBottom: '1px solid rgba(0, 255, 255, 0.1)',
      }}>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-cyan-400">호가창</span>
          <span className="text-[9px] text-gray-500">{symbol.replace('USDT', '')}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-[9px] text-gray-500">
            스프레드: {orderBook.spreadPercent.toFixed(3)}%
          </span>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 px-2 py-0.5 text-[8px] text-gray-500" style={{
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
      }}>
        <span>가격</span>
        <span className="text-right">수량</span>
        <span className="text-right">합계</span>
      </div>

      {/* Asks (Sell orders) - Red */}
      <div className="space-y-px">
        {orderBook.asks.map((ask, i) => (
          <div key={`ask-${i}`} className="relative grid grid-cols-3 px-2 py-0.5 text-[10px]">
            {/* Background bar */}
            <div 
              className="absolute right-0 top-0 bottom-0 opacity-30"
              style={{
                width: `${(ask.quantity / maxQty) * 100}%`,
                background: 'linear-gradient(90deg, transparent, rgba(255, 0, 136, 0.4))',
              }}
            />
            <span className="relative font-mono" style={{ color: '#ff0088' }}>
              {formatPrice(ask.price)}
            </span>
            <span className="relative text-right font-mono text-gray-400">
              {formatQty(ask.quantity)}
            </span>
            <span className="relative text-right font-mono text-gray-500">
              ${(ask.total / 1000).toFixed(1)}K
            </span>
          </div>
        ))}
      </div>

      {/* Spread Indicator */}
      <div className="flex items-center justify-center py-1" style={{
        background: 'rgba(0, 255, 255, 0.05)',
        borderTop: '1px solid rgba(0, 255, 255, 0.1)',
        borderBottom: '1px solid rgba(0, 255, 255, 0.1)',
      }}>
        <span className="text-[10px] font-mono font-bold" style={{
          color: orderBook.spreadPercent < 0.05 ? '#00ff88' : orderBook.spreadPercent < 0.1 ? '#ffff00' : '#ff0088',
        }}>
          ↕ ${orderBook.spread.toFixed(4)}
        </span>
      </div>

      {/* Bids (Buy orders) - Green */}
      <div className="space-y-px">
        {orderBook.bids.map((bid, i) => (
          <div key={`bid-${i}`} className="relative grid grid-cols-3 px-2 py-0.5 text-[10px]">
            {/* Background bar */}
            <div 
              className="absolute right-0 top-0 bottom-0 opacity-30"
              style={{
                width: `${(bid.quantity / maxQty) * 100}%`,
                background: 'linear-gradient(90deg, transparent, rgba(0, 255, 136, 0.4))',
              }}
            />
            <span className="relative font-mono" style={{ color: '#00ff88' }}>
              {formatPrice(bid.price)}
            </span>
            <span className="relative text-right font-mono text-gray-400">
              {formatQty(bid.quantity)}
            </span>
            <span className="relative text-right font-mono text-gray-500">
              ${(bid.total / 1000).toFixed(1)}K
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default OrderBook;
