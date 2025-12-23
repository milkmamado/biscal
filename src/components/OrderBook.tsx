import { useState, useEffect, useRef, useCallback } from 'react';
import { formatPrice } from '@/lib/binance';
import { toast } from 'sonner';

interface OpenOrder {
  orderId: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  origQty: number;
  executedQty: number;
  status: string;
}

type SplitOption = 1 | 5 | 10;

interface OrderBookProps {
  symbol: string;
  isTestnet?: boolean;
  onPlaceOrder?: (side: 'long' | 'short', price: number, splitCount: SplitOption) => void;
  onMarketEntry?: (side: 'long' | 'short', splitCount: SplitOption) => void;
  onMarketClose?: () => void;
  onCancelOrder?: (orderId: number) => Promise<void>;
  onCancelAllOrders?: () => Promise<void>;
  openOrders?: OpenOrder[];
  hasPosition?: boolean;
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

export function OrderBook({ 
  symbol, 
  isTestnet = false, 
  onPlaceOrder,
  onMarketEntry,
  onMarketClose,
  onCancelOrder,
  onCancelAllOrders,
  openOrders = [],
  hasPosition = false,
}: OrderBookProps) {
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [splitCount, setSplitCount] = useState<SplitOption>(5);
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

  // 주문 박스 더블클릭 핸들러
  const handleOrderBoxDoubleClick = (side: 'long' | 'short', price: number) => {
    if (onPlaceOrder) {
      onPlaceOrder(side, price, splitCount);
    } else {
      toast.info(`${side === 'long' ? '롱' : '숏'} 주문 준비: ${formatPrice(price)}`);
    }
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
    <div className="relative z-10 mx-2 lg:mx-3 mb-1 lg:mb-2 rounded-md overflow-hidden flex-1 min-h-0 flex flex-col" style={{
      background: 'rgba(10, 10, 20, 0.95)',
      border: '1px solid rgba(100, 100, 120, 0.3)',
    }}>
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-0.5 lg:py-1 shrink-0" style={{
        background: 'rgba(30, 30, 50, 0.8)',
        borderBottom: '1px solid rgba(100, 100, 120, 0.3)',
      }}>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] lg:text-[10px] font-bold text-gray-300">호가</span>
          <span className="text-[8px] lg:text-[9px] text-cyan-400 font-mono">{symbol.replace('USDT', '')}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
        </div>
      </div>

      <div className="grid grid-cols-5 px-1 py-0.5 text-[7px] lg:text-[8px] text-gray-500 font-medium shrink-0" style={{
        background: 'rgba(40, 40, 60, 0.5)',
        borderBottom: '1px solid rgba(100, 100, 120, 0.2)',
      }}>
        <span className="text-center">숏</span>
        <span className="text-center">잔량</span>
        <span className="text-center">가격</span>
        <span className="text-center">잔량</span>
        <span className="text-center">롱</span>
      </div>

      {/* Scrollable order book area */}
      <div className="flex-1 min-h-0 overflow-auto">

      {/* Asks (매도호가) - 좌측에 잔량 그래프 */}
      <div>
        {orderBook.asks.slice(0, 7).map((ask, i) => {
          const barWidth = maxQty > 0 ? (ask.quantity / maxQty) * 100 : 0;
          return (
            <div 
              key={`ask-${i}`} 
              className="relative grid grid-cols-5 px-1 py-[2px] text-[9px] lg:py-[3px] lg:text-[10px]"
              style={{
                borderBottom: '1px solid rgba(60, 60, 80, 0.3)',
              }}
            >
              {/* 숏 주문 박스 (좌측 끝) */}
              <div className="flex items-center justify-center">
                <div 
                  className="w-5 h-4 rounded-sm cursor-pointer hover:opacity-80 active:scale-95 transition-all flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(180deg, rgba(255, 80, 100, 0.3) 0%, rgba(255, 50, 80, 0.5) 100%)',
                    border: '1px solid rgba(255, 80, 100, 0.5)',
                    boxShadow: '0 0 4px rgba(255, 80, 100, 0.3)',
                  }}
                  onDoubleClick={() => handleOrderBoxDoubleClick('short', ask.price)}
                  title={`더블클릭: ${formatPrice(ask.price)}에 숏`}
                >
                  <span className="text-[7px] font-bold text-red-300">S</span>
                </div>
              </div>

              {/* 매도잔량 + 그래프 */}
              <div className="relative flex items-center justify-center">
                {/* 그래프 바 (우측에서 좌측으로) */}
                <div 
                  className="absolute right-0 top-0 bottom-0"
                  style={{
                    width: `${barWidth}%`,
                    background: 'linear-gradient(270deg, rgba(255, 50, 100, 0.5) 0%, rgba(255, 50, 100, 0.1) 100%)',
                  }}
                />
                <span className="relative z-10 font-mono text-gray-300">
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
              <div className="flex items-center justify-center">
                <span className="text-gray-600">-</span>
              </div>

              {/* 롱 주문 박스 - 비활성 */}
              <div className="flex items-center justify-center">
                <div 
                  className="w-5 h-4 rounded-sm opacity-20"
                  style={{
                    background: 'rgba(100, 100, 100, 0.3)',
                    border: '1px solid rgba(100, 100, 100, 0.3)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Spread Indicator */}
      <div className="flex items-center justify-center gap-2 py-1.5" style={{
        background: 'linear-gradient(90deg, rgba(255, 50, 100, 0.15) 0%, rgba(50, 50, 80, 0.3) 50%, rgba(0, 200, 100, 0.15) 100%)',
        borderTop: '1px solid rgba(100, 100, 120, 0.3)',
        borderBottom: '1px solid rgba(100, 100, 120, 0.3)',
      }}>
        <div className="flex items-center">
          <span className="text-[9px] text-gray-400 mr-1">스프레드</span>
          <span className="text-[10px] font-mono font-bold" style={{
            color: orderBook.spreadPercent < 0.03 ? '#00ff88' : orderBook.spreadPercent < 0.08 ? '#ffcc00' : '#ff5064',
          }}>
            {orderBook.spreadPercent.toFixed(3)}%
          </span>
        </div>
        <span className="text-[8px]" style={{
          color: orderBook.spreadPercent < 0.03 ? '#00ff88' : orderBook.spreadPercent < 0.08 ? '#ffcc00' : '#ff5064',
        }}>
          {orderBook.spreadPercent < 0.03 ? '· 스캘핑 최적' : orderBook.spreadPercent < 0.08 ? '· 적정' : '· 슬리피지 주의'}
        </span>
      </div>

      {/* Bids (매수호가) - 우측에 잔량 그래프 */}
      <div>
        {orderBook.bids.slice(0, 7).map((bid, i) => {
          const barWidth = maxQty > 0 ? (bid.quantity / maxQty) * 100 : 0;
          return (
            <div 
              key={`bid-${i}`} 
              className="relative grid grid-cols-5 px-1 py-[2px] text-[9px] lg:py-[3px] lg:text-[10px]"
              style={{
                borderBottom: '1px solid rgba(60, 60, 80, 0.3)',
              }}
            >
              {/* 숏 주문 박스 - 비활성 */}
              <div className="flex items-center justify-center">
                <div 
                  className="w-5 h-4 rounded-sm opacity-20"
                  style={{
                    background: 'rgba(100, 100, 100, 0.3)',
                    border: '1px solid rgba(100, 100, 100, 0.3)',
                  }}
                />
              </div>

              {/* 매도잔량 (좌측) - 비어있음 */}
              <div className="flex items-center justify-center">
                <span className="text-gray-600">-</span>
              </div>

              {/* 가격 (중앙) */}
              <div className="flex items-center justify-center">
                <span className="font-mono font-semibold" style={{ color: '#00c868' }}>
                  {formatPrice(bid.price)}
                </span>
              </div>

              {/* 매수잔량 + 그래프 */}
              <div className="relative flex items-center justify-center">
                {/* 그래프 바 (좌측에서 우측으로) */}
                <div 
                  className="absolute left-0 top-0 bottom-0"
                  style={{
                    width: `${barWidth}%`,
                    background: 'linear-gradient(90deg, rgba(0, 200, 100, 0.1) 0%, rgba(0, 200, 100, 0.5) 100%)',
                  }}
                />
                <span className="relative z-10 font-mono text-gray-300">
                  {formatQty(bid.quantity)}
                </span>
              </div>

              {/* 롱 주문 박스 (우측 끝) */}
              <div className="flex items-center justify-center">
                <div 
                  className="w-5 h-4 rounded-sm cursor-pointer hover:opacity-80 active:scale-95 transition-all flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(180deg, rgba(0, 200, 100, 0.3) 0%, rgba(0, 180, 80, 0.5) 100%)',
                    border: '1px solid rgba(0, 200, 100, 0.5)',
                    boxShadow: '0 0 4px rgba(0, 200, 100, 0.3)',
                  }}
                  onDoubleClick={() => handleOrderBoxDoubleClick('long', bid.price)}
                  title={`더블클릭: ${formatPrice(bid.price)}에 롱`}
                >
                  <span className="text-[7px] font-bold text-green-300">L</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </div> {/* End scrollable order book area */}

      {/* 미체결 수량 및 주문 컨트롤 */}
      <div className="px-1.5 py-1.5 lg:px-2 lg:py-2 space-y-1.5 lg:space-y-2 shrink-0" style={{
        background: 'rgba(20, 20, 35, 0.9)',
        borderTop: '1px solid rgba(100, 100, 120, 0.3)',
      }}>
        {/* 미체결 주문 목록 */}
        {openOrders.length > 0 ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-400">미체결 주문 ({openOrders.length}건)</span>
              {onCancelAllOrders && (
                <button
                  onClick={onCancelAllOrders}
                  className="px-2 py-0.5 rounded text-[9px] font-semibold transition-all hover:opacity-80 active:scale-95"
                  style={{
                    background: 'rgba(255, 100, 100, 0.2)',
                    border: '1px solid rgba(255, 100, 100, 0.4)',
                    color: '#ff6666',
                  }}
                >
                  일괄취소
                </button>
              )}
            </div>
            {openOrders.map((order) => (
              <div 
                key={order.orderId} 
                className="flex items-center justify-between px-2 py-1 rounded text-[10px]"
                style={{
                  background: order.side === 'BUY' ? 'rgba(0, 200, 100, 0.1)' : 'rgba(255, 80, 100, 0.1)',
                  border: `1px solid ${order.side === 'BUY' ? 'rgba(0, 200, 100, 0.3)' : 'rgba(255, 80, 100, 0.3)'}`,
                }}
              >
                <div className="flex items-center gap-2">
                  <span className={`font-bold ${order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                    {order.side === 'BUY' ? 'L' : 'S'}
                  </span>
                  <span className="font-mono text-gray-300">{formatPrice(order.price)}</span>
                  <span className="text-gray-500">×</span>
                  <span className="font-mono text-yellow-400">{(order.origQty - order.executedQty).toFixed(4)}</span>
                </div>
                {onCancelOrder && (
                  <button
                    onClick={() => onCancelOrder(order.orderId)}
                    className="px-1.5 py-0.5 rounded text-[8px] font-semibold transition-all hover:opacity-80"
                    style={{
                      background: 'rgba(255, 100, 100, 0.2)',
                      border: '1px solid rgba(255, 100, 100, 0.4)',
                      color: '#ff6666',
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-between px-2 py-1.5 rounded" style={{
            background: 'rgba(50, 50, 70, 0.5)',
            border: '1px solid rgba(100, 100, 120, 0.2)',
          }}>
            <span className="text-[10px] text-gray-400">미체결</span>
            <span className="text-[11px] font-mono text-gray-600">-</span>
          </div>
        )}

        {/* 분할 매수 옵션 */}
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] text-gray-400">분할 매수</span>
          <div className="flex gap-1">
            {([1, 5, 10] as SplitOption[]).map((opt) => (
              <button
                key={opt}
                onClick={() => setSplitCount(opt)}
                className={`px-2 py-0.5 rounded text-[9px] font-semibold transition-all ${
                  splitCount === opt
                    ? 'text-cyan-300'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
                style={{
                  background: splitCount === opt ? 'rgba(0, 255, 255, 0.2)' : 'rgba(50, 50, 70, 0.5)',
                  border: `1px solid ${splitCount === opt ? 'rgba(0, 255, 255, 0.5)' : 'rgba(100, 100, 120, 0.3)'}`,
                }}
              >
                {opt}분할
              </button>
            ))}
          </div>
        </div>

        {/* 시장가 주문 버튼 */}
        <div className="grid grid-cols-2 gap-1.5 lg:gap-2">
          {/* 시장가 진입 버튼들 */}
          {!hasPosition && (
            <>
              <button
                onClick={() => {
                  console.log(`📌 [OrderBook] 시장가 롱 버튼 클릭 (${splitCount}분할)`);
                  onMarketEntry?.('long', splitCount);
                }}
                className="py-1.5 lg:py-2 rounded text-[10px] lg:text-[11px] font-bold transition-all hover:opacity-90 active:scale-98"
                style={{
                  background: 'linear-gradient(180deg, rgba(0, 200, 100, 0.4) 0%, rgba(0, 180, 80, 0.6) 100%)',
                  border: '1px solid rgba(0, 200, 100, 0.5)',
                  color: '#00ff88',
                  boxShadow: '0 0 8px rgba(0, 200, 100, 0.3)',
                }}
              >
                시장가 롱
              </button>
              <button
                onClick={() => {
                  console.log(`📌 [OrderBook] 시장가 숏 버튼 클릭 (${splitCount}분할)`);
                  onMarketEntry?.('short', splitCount);
                }}
                className="py-1.5 lg:py-2 rounded text-[10px] lg:text-[11px] font-bold transition-all hover:opacity-90 active:scale-98"
                style={{
                  background: 'linear-gradient(180deg, rgba(255, 80, 100, 0.4) 0%, rgba(255, 50, 80, 0.6) 100%)',
                  border: '1px solid rgba(255, 80, 100, 0.5)',
                  color: '#ff5064',
                  boxShadow: '0 0 8px rgba(255, 80, 100, 0.3)',
                }}
              >
                시장가 숏
              </button>
            </>
          )}
          
          {/* 시장가 청산 버튼 */}
          {hasPosition && onMarketClose && (
            <button
              onClick={onMarketClose}
              className="col-span-2 py-1.5 lg:py-2 rounded text-[10px] lg:text-[11px] font-bold transition-all hover:opacity-90 active:scale-98"
              style={{
                background: 'linear-gradient(180deg, rgba(255, 50, 100, 0.5) 0%, rgba(255, 0, 80, 0.7) 100%)',
                border: '1px solid rgba(255, 50, 100, 0.6)',
                color: '#fff',
                boxShadow: '0 0 10px rgba(255, 50, 100, 0.4)',
              }}
            >
              시장가 청산
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default OrderBook;
