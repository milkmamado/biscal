import { useState, useEffect, useRef, useCallback } from 'react';
import { formatPrice } from '@/lib/binance';

interface OrderBookProps {
  symbol: string;
  isTestnet?: boolean;
}

interface OrderBookEntry {
  price: number;
  quantity: number;
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
      .slice(0, 10)
      .map((b: [string, string]) => ({
        price: parseFloat(b[0]),
        quantity: parseFloat(b[1]),
      }));

    // Parse asks (sell orders) - sorted low to high, then reverse for display
    const asks: OrderBookEntry[] = data.a
      .slice(0, 10)
      .map((a: [string, string]) => ({
        price: parseFloat(a[0]),
        quantity: parseFloat(a[1]),
      }))
      .reverse(); // Reverse to show highest ask at top, lowest at bottom (near spread)

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
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };
    } catch (e) {
      console.error('OrderBook connection error:', e);
    }
  }, [symbol, isTestnet, processDepthData]);

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
    if (qty >= 1) return qty.toFixed(1);
    return qty.toFixed(2);
  };

  if (!orderBook) {
    return (
      <div className="relative z-10 mx-3 mb-2 px-3 py-3 rounded-md text-center" style={{
        background: 'rgba(10, 10, 20, 0.9)',
        border: '1px solid rgba(100, 100, 120, 0.3)',
      }}>
        <span className="text-[10px] text-gray-500">호가창 로딩중...</span>
      </div>
    );
  }

  return (
    <div className="relative z-10 mx-3 mb-2 rounded-md overflow-hidden" style={{
      background: 'rgba(10, 10, 20, 0.95)',
      border: '1px solid rgba(100, 100, 120, 0.3)',
    }}>
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1" style={{
        background: 'rgba(30, 30, 50, 0.8)',
        borderBottom: '1px solid rgba(100, 100, 120, 0.3)',
      }}>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-gray-300">호가</span>
          <span className="text-[9px] text-cyan-400 font-mono">{symbol.replace('USDT', '')}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 px-1 py-0.5 text-[8px] text-gray-500 font-medium" style={{
        background: 'rgba(40, 40, 60, 0.5)',
        borderBottom: '1px solid rgba(100, 100, 120, 0.2)',
      }}>
        <span className="text-left pl-1">매도잔량</span>
        <span className="text-center">가격</span>
        <span className="text-right pr-1">매수잔량</span>
      </div>

      {/* Asks (매도호가) - 좌측에 잔량 그래프 */}
      <div>
        {orderBook.asks.map((ask, i) => {
          const barWidth = maxQty > 0 ? (ask.quantity / maxQty) * 100 : 0;
          return (
            <div 
              key={`ask-${i}`} 
              className="relative grid grid-cols-3 px-1 py-[3px] text-[10px]"
              style={{
                borderBottom: '1px solid rgba(60, 60, 80, 0.3)',
              }}
            >
              {/* 매도잔량 (좌측) + 그래프 */}
              <div className="relative flex items-center justify-start">
                {/* 그래프 바 (우측에서 좌측으로) */}
                <div 
                  className="absolute right-0 top-0 bottom-0"
                  style={{
                    width: `${barWidth}%`,
                    background: 'linear-gradient(270deg, rgba(255, 50, 100, 0.5) 0%, rgba(255, 50, 100, 0.1) 100%)',
                  }}
                />
                <span className="relative z-10 font-mono text-gray-300 pl-1">
                  {formatQty(ask.quantity)}
                </span>
              </div>

              {/* 가격 (중앙) */}
              <div className="flex items-center justify-center">
                <span className="font-mono font-semibold" style={{ color: '#ff5064' }}>
                  {formatPrice(ask.price)}
                </span>
              </div>

              {/* 매수잔량 (우측) - 비어있음 */}
              <div className="flex items-center justify-end pr-1">
                <span className="text-gray-600">-</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Spread Indicator */}
      <div className="flex items-center justify-center py-1.5" style={{
        background: 'linear-gradient(90deg, rgba(255, 50, 100, 0.15) 0%, rgba(50, 50, 80, 0.3) 50%, rgba(0, 200, 100, 0.15) 100%)',
        borderTop: '1px solid rgba(100, 100, 120, 0.3)',
        borderBottom: '1px solid rgba(100, 100, 120, 0.3)',
      }}>
        <span className="text-[9px] text-gray-400 mr-1">스프레드</span>
        <span className="text-[10px] font-mono font-bold" style={{
          color: orderBook.spreadPercent < 0.03 ? '#00ff88' : orderBook.spreadPercent < 0.08 ? '#ffcc00' : '#ff5064',
        }}>
          {orderBook.spreadPercent.toFixed(3)}%
        </span>
      </div>

      {/* Bids (매수호가) - 우측에 잔량 그래프 */}
      <div>
        {orderBook.bids.map((bid, i) => {
          const barWidth = maxQty > 0 ? (bid.quantity / maxQty) * 100 : 0;
          return (
            <div 
              key={`bid-${i}`} 
              className="relative grid grid-cols-3 px-1 py-[3px] text-[10px]"
              style={{
                borderBottom: '1px solid rgba(60, 60, 80, 0.3)',
              }}
            >
              {/* 매도잔량 (좌측) - 비어있음 */}
              <div className="flex items-center justify-start pl-1">
                <span className="text-gray-600">-</span>
              </div>

              {/* 가격 (중앙) */}
              <div className="flex items-center justify-center">
                <span className="font-mono font-semibold" style={{ color: '#00c868' }}>
                  {formatPrice(bid.price)}
                </span>
              </div>

              {/* 매수잔량 (우측) + 그래프 */}
              <div className="relative flex items-center justify-end">
                {/* 그래프 바 (좌측에서 우측으로) */}
                <div 
                  className="absolute left-0 top-0 bottom-0"
                  style={{
                    width: `${barWidth}%`,
                    background: 'linear-gradient(90deg, rgba(0, 200, 100, 0.1) 0%, rgba(0, 200, 100, 0.5) 100%)',
                  }}
                />
                <span className="relative z-10 font-mono text-gray-300 pr-1">
                  {formatQty(bid.quantity)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default OrderBook;
