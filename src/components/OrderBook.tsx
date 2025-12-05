import { useEffect, useState, useMemo } from 'react';
import { fetchOrderBook, OrderBook as OrderBookType, formatPrice, formatQuantity } from '@/lib/binance';
import { cn } from '@/lib/utils';

interface OrderBookProps {
  symbol: string;
  currentPrice?: number;
}

const OrderBook = ({ symbol, currentPrice }: OrderBookProps) => {
  const [orderBook, setOrderBook] = useState<OrderBookType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadOrderBook = async () => {
      try {
        const data = await fetchOrderBook(symbol, 15);
        setOrderBook(data);
      } catch (error) {
        console.error('Failed to fetch order book:', error);
      } finally {
        setLoading(false);
      }
    };

    loadOrderBook();
    const interval = setInterval(loadOrderBook, 1000);
    return () => clearInterval(interval);
  }, [symbol]);

  const maxQuantity = useMemo(() => {
    if (!orderBook) return 0;
    const allQuantities = [...orderBook.bids, ...orderBook.asks].map(e => e.quantity);
    return Math.max(...allQuantities);
  }, [orderBook]);

  if (loading) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="h-6 w-32 shimmer rounded mb-4" />
        <div className="space-y-2">
          {Array(15).fill(0).map((_, i) => (
            <div key={i} className="h-6 shimmer rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (!orderBook) return null;

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">호가창</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{symbol}</p>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 px-4 py-2 text-xs font-medium text-muted-foreground border-b border-border bg-secondary/30">
        <span>가격 (USDT)</span>
        <span className="text-right">수량</span>
        <span className="text-right">누적</span>
      </div>

      {/* Asks (Sell orders) - reversed to show highest at top */}
      <div className="divide-y divide-border/50">
        {[...orderBook.asks].reverse().slice(0, 10).map((ask, index) => {
          const percentage = (ask.quantity / maxQuantity) * 100;
          const cumulativeQty = orderBook.asks
            .slice(0, orderBook.asks.length - index)
            .reduce((sum, a) => sum + a.quantity, 0);
          
          return (
            <div
              key={`ask-${index}`}
              className="orderbook-row grid grid-cols-3 px-4 py-1.5 text-xs font-mono"
            >
              <div
                className="volume-bar bg-ask/15"
                style={{ width: `${percentage}%` }}
              />
              <span className="relative z-10 text-ask">{formatPrice(ask.price)}</span>
              <span className="relative z-10 text-right text-foreground">{formatQuantity(ask.quantity)}</span>
              <span className="relative z-10 text-right text-muted-foreground">{formatQuantity(cumulativeQty)}</span>
            </div>
          );
        })}
      </div>

      {/* Current Price */}
      <div className="px-4 py-3 bg-secondary/50 border-y border-border">
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold font-mono text-foreground">
            {currentPrice ? formatPrice(currentPrice) : formatPrice(orderBook.asks[0]?.price || 0)}
          </span>
          <span className="text-xs text-muted-foreground">현재가</span>
        </div>
      </div>

      {/* Bids (Buy orders) */}
      <div className="divide-y divide-border/50">
        {orderBook.bids.slice(0, 10).map((bid, index) => {
          const percentage = (bid.quantity / maxQuantity) * 100;
          const cumulativeQty = orderBook.bids
            .slice(0, index + 1)
            .reduce((sum, b) => sum + b.quantity, 0);
          
          return (
            <div
              key={`bid-${index}`}
              className="orderbook-row grid grid-cols-3 px-4 py-1.5 text-xs font-mono"
            >
              <div
                className="volume-bar bg-bid/15"
                style={{ width: `${percentage}%` }}
              />
              <span className="relative z-10 text-bid">{formatPrice(bid.price)}</span>
              <span className="relative z-10 text-right text-foreground">{formatQuantity(bid.quantity)}</span>
              <span className="relative z-10 text-right text-muted-foreground">{formatQuantity(cumulativeQty)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OrderBook;
