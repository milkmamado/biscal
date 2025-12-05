import { useState, useEffect, useMemo } from 'react';
import { fetchOrderBook, fetch24hTicker, OrderBook, formatPrice, formatQuantity } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { Minus, Plus } from 'lucide-react';

interface OrderPanel8282Props {
  symbol: string;
}

const OrderPanel8282 = ({ symbol }: OrderPanel8282Props) => {
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [orderPrice, setOrderPrice] = useState<string>('');
  const [orderQty, setOrderQty] = useState<string>('1');
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');
  const [loading, setLoading] = useState(true);

  // Get tick size based on price
  const tickSize = useMemo(() => {
    if (currentPrice >= 1000) return 0.1;
    if (currentPrice >= 100) return 0.01;
    if (currentPrice >= 10) return 0.001;
    if (currentPrice >= 1) return 0.0001;
    return 0.00001;
  }, [currentPrice]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [book, ticker] = await Promise.all([
          fetchOrderBook(symbol, 10),
          fetch24hTicker(symbol)
        ]);
        setOrderBook(book);
        setCurrentPrice(ticker.price);
        if (!orderPrice) {
          setOrderPrice(formatPrice(ticker.price));
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
    const interval = setInterval(loadData, 500);
    return () => clearInterval(interval);
  }, [symbol]);

  // Reset order price when symbol changes
  useEffect(() => {
    setOrderPrice('');
  }, [symbol]);

  const handlePriceClick = (price: number) => {
    setOrderPrice(formatPrice(price));
    setOrderType('limit');
  };

  const adjustPrice = (direction: 'up' | 'down') => {
    const current = parseFloat(orderPrice) || currentPrice;
    const newPrice = direction === 'up' ? current + tickSize : current - tickSize;
    setOrderPrice(formatPrice(Math.max(0, newPrice)));
  };

  const handleQtyPreset = (preset: number) => {
    setOrderQty(preset.toString());
  };

  const maxQuantity = useMemo(() => {
    if (!orderBook) return 0;
    const allQuantities = [...orderBook.bids, ...orderBook.asks].map(e => e.quantity);
    return Math.max(...allQuantities);
  }, [orderBook]);

  if (loading || !orderBook) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <div className="h-[600px] shimmer rounded" />
      </div>
    );
  }

  const totalBuyQty = orderBook.bids.reduce((sum, b) => sum + b.quantity, 0);
  const totalSellQty = orderBook.asks.reduce((sum, a) => sum + a.quantity, 0);
  const buyRatio = (totalBuyQty / (totalBuyQty + totalSellQty)) * 100;

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-secondary/30">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">{symbol} 호가</span>
          <div className="flex gap-1">
            <button
              onClick={() => setOrderType('limit')}
              className={cn(
                "px-2 py-0.5 text-xs rounded transition-colors",
                orderType === 'limit' ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
              )}
            >
              지정가
            </button>
            <button
              onClick={() => setOrderType('market')}
              className={cn(
                "px-2 py-0.5 text-xs rounded transition-colors",
                orderType === 'market' ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
              )}
            >
              시장가
            </button>
          </div>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-[1fr_80px_80px_1fr] text-[10px] text-muted-foreground border-b border-border bg-secondary/20">
        <div className="px-2 py-1 text-center">잔량</div>
        <div className="px-2 py-1 text-center border-x border-border">매도호가</div>
        <div className="px-2 py-1 text-center border-r border-border">매수호가</div>
        <div className="px-2 py-1 text-center">잔량</div>
      </div>

      {/* Order Book - 8282 Style */}
      <div className="relative">
        {/* Sell Orders (Asks) */}
        {[...orderBook.asks].reverse().slice(0, 10).map((ask, index) => {
          const percentage = (ask.quantity / maxQuantity) * 100;
          const matchingBid = orderBook.bids[9 - index];
          
          return (
            <div key={`row-${index}`} className="grid grid-cols-[1fr_80px_80px_1fr] border-b border-border/30 hover:bg-secondary/30">
              {/* Sell Quantity */}
              <div className="relative px-2 py-1.5 text-right">
                <div 
                  className="absolute left-0 top-0 h-full bg-ask/20"
                  style={{ width: `${percentage}%` }}
                />
                <span className="relative text-xs font-mono text-ask">
                  {formatQuantity(ask.quantity)}
                </span>
              </div>
              
              {/* Sell Price */}
              <button
                onClick={() => handlePriceClick(ask.price)}
                className="px-2 py-1.5 text-center border-x border-border/30 bg-ask/5 hover:bg-ask/20 transition-colors"
              >
                <span className="text-xs font-mono font-medium text-ask">
                  {formatPrice(ask.price)}
                </span>
              </button>

              {/* Buy Price */}
              {matchingBid ? (
                <button
                  onClick={() => handlePriceClick(matchingBid.price)}
                  className="px-2 py-1.5 text-center border-r border-border/30 bg-bid/5 hover:bg-bid/20 transition-colors"
                >
                  <span className="text-xs font-mono font-medium text-bid">
                    {formatPrice(matchingBid.price)}
                  </span>
                </button>
              ) : (
                <div className="px-2 py-1.5 border-r border-border/30" />
              )}

              {/* Buy Quantity */}
              {matchingBid ? (
                <div className="relative px-2 py-1.5 text-left">
                  <div 
                    className="absolute right-0 top-0 h-full bg-bid/20"
                    style={{ width: `${(matchingBid.quantity / maxQuantity) * 100}%` }}
                  />
                  <span className="relative text-xs font-mono text-bid">
                    {formatQuantity(matchingBid.quantity)}
                  </span>
                </div>
              ) : (
                <div className="px-2 py-1.5" />
              )}
            </div>
          );
        })}
      </div>

      {/* Current Price Bar */}
      <div className="px-3 py-2 bg-secondary border-y border-border">
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold font-mono">${formatPrice(currentPrice)}</span>
          <div className="flex items-center gap-2 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-bid" />
              <span className="text-bid">{buyRatio.toFixed(0)}%</span>
            </div>
            <div className="w-16 h-1.5 bg-ask/30 rounded-full overflow-hidden">
              <div className="h-full bg-bid rounded-full" style={{ width: `${buyRatio}%` }} />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-ask">{(100 - buyRatio).toFixed(0)}%</span>
              <div className="w-2 h-2 rounded-full bg-ask" />
            </div>
          </div>
        </div>
      </div>

      {/* Order Input Area */}
      <div className="p-3 space-y-3 bg-secondary/20">
        {/* Price Input */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">주문가격</label>
          <div className="flex items-center gap-1">
            <button
              onClick={() => adjustPrice('down')}
              className="p-2 bg-secondary hover:bg-secondary/80 rounded transition-colors"
            >
              <Minus className="w-4 h-4" />
            </button>
            <input
              type="text"
              value={orderType === 'market' ? '시장가' : orderPrice}
              onChange={(e) => setOrderPrice(e.target.value)}
              disabled={orderType === 'market'}
              className="flex-1 bg-background border border-border rounded px-3 py-2 text-center font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
            <button
              onClick={() => adjustPrice('up')}
              className="p-2 bg-secondary hover:bg-secondary/80 rounded transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quantity Input */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">주문수량</label>
          <input
            type="text"
            value={orderQty}
            onChange={(e) => setOrderQty(e.target.value)}
            className="w-full bg-background border border-border rounded px-3 py-2 text-center font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex gap-1 mt-2">
            {[1, 5, 10, 25, 50, 100].map((preset) => (
              <button
                key={preset}
                onClick={() => handleQtyPreset(preset)}
                className="flex-1 py-1 text-xs bg-secondary hover:bg-secondary/80 rounded transition-colors"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Order Buttons */}
        <div className="grid grid-cols-2 gap-2 pt-2">
          <button className="py-3 rounded-lg font-bold text-sm bg-bid hover:bg-bid/90 text-white transition-all glow-bid">
            매수
          </button>
          <button className="py-3 rounded-lg font-bold text-sm bg-ask hover:bg-ask/90 text-white transition-all glow-ask">
            매도
          </button>
        </div>

        {/* Order Summary */}
        <div className="pt-2 border-t border-border text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>주문총액</span>
            <span className="font-mono">
              ${orderType === 'market' 
                ? formatPrice(currentPrice * parseFloat(orderQty || '0'))
                : formatPrice(parseFloat(orderPrice || '0') * parseFloat(orderQty || '0'))
              } USDT
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderPanel8282;
