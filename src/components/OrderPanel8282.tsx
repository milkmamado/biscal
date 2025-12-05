import { useState, useEffect, useMemo } from 'react';
import { fetchOrderBook, fetch24hTicker, OrderBook, formatPrice, formatQuantity } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { Minus, Plus, Settings } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface OrderPanel8282Props {
  symbol: string;
}

const OrderPanel8282 = ({ symbol }: OrderPanel8282Props) => {
  const { toast } = useToast();
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [orderQty, setOrderQty] = useState<string>('1');
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

  const handleQuickOrder = (type: 'buy' | 'sell', price: number) => {
    const qty = parseFloat(orderQty) || 1;
    toast({
      title: type === 'buy' ? '매수 주문' : '매도 주문',
      description: `${symbol} ${qty}개 @ $${formatPrice(price)}`,
      duration: 2000,
    });
  };

  const handleQtyPreset = (preset: number) => {
    setOrderQty(preset.toString());
  };

  const adjustQty = (delta: number) => {
    const current = parseFloat(orderQty) || 0;
    const newQty = Math.max(1, current + delta);
    setOrderQty(newQty.toString());
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

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-secondary/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold">[8282] 호가주문</span>
          <span className="text-[10px] text-muted-foreground">{symbol}</span>
        </div>
        <Settings className="w-3.5 h-3.5 text-muted-foreground" />
      </div>

      {/* Quantity Input Row */}
      <div className="px-2 py-2 border-b border-border bg-secondary/20 flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-12">수량</span>
        <div className="flex items-center gap-1 flex-1">
          <button
            onClick={() => adjustQty(-1)}
            className="w-6 h-6 flex items-center justify-center bg-secondary hover:bg-secondary/80 rounded text-xs"
          >
            <Minus className="w-3 h-3" />
          </button>
          <input
            type="text"
            value={orderQty}
            onChange={(e) => setOrderQty(e.target.value)}
            className="flex-1 bg-background border border-border rounded px-2 py-1 text-center font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={() => adjustQty(1)}
            className="w-6 h-6 flex items-center justify-center bg-secondary hover:bg-secondary/80 rounded text-xs"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
        <div className="flex gap-1">
          {[1, 5, 10, 100].map((preset) => (
            <button
              key={preset}
              onClick={() => handleQtyPreset(preset)}
              className="px-2 py-1 text-[10px] bg-secondary hover:bg-secondary/80 rounded"
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-[40px_1fr_70px_24px_70px_1fr_40px] text-[10px] text-muted-foreground border-b border-border bg-muted/50 font-medium">
        <div className="px-1 py-1 text-center border-r border-border/50">매도</div>
        <div className="px-1 py-1 text-center border-r border-border/50">잔량</div>
        <div className="px-1 py-1 text-center border-r border-border/50 text-ask">매도호가</div>
        <div className="px-1 py-1 text-center border-r border-border/50"></div>
        <div className="px-1 py-1 text-center border-r border-border/50 text-bid">매수호가</div>
        <div className="px-1 py-1 text-center border-r border-border/50">잔량</div>
        <div className="px-1 py-1 text-center">매수</div>
      </div>

      {/* Order Book - 8282 Style */}
      <div className="divide-y divide-border/30">
        {/* Sell Side (Asks) - Top, reversed so highest is at top */}
        {[...orderBook.asks].reverse().slice(0, 10).map((ask, index) => {
          const percentage = (ask.quantity / maxQuantity) * 100;
          const reverseIndex = 9 - index;
          const matchingBid = orderBook.bids[reverseIndex];
          
          return (
            <div key={`row-${index}`} className="grid grid-cols-[40px_1fr_70px_24px_70px_1fr_40px] text-xs hover:bg-secondary/20">
              {/* Sell Button */}
              <div className="border-r border-border/30 flex items-center justify-center">
                <button
                  onDoubleClick={() => handleQuickOrder('sell', ask.price)}
                  className="w-6 h-6 bg-ask/20 hover:bg-ask/40 border border-ask/30 rounded text-[10px] font-bold text-ask transition-colors"
                  title="더블클릭: 매도"
                >
                  S
                </button>
              </div>

              {/* Sell Quantity */}
              <div className="relative px-1 py-1.5 border-r border-border/30 flex items-center justify-end">
                <div 
                  className="absolute left-0 top-0 h-full bg-ask/15"
                  style={{ width: `${percentage}%` }}
                />
                <span className="relative font-mono text-[11px]">
                  {formatQuantity(ask.quantity)}
                </span>
              </div>
              
              {/* Sell Price */}
              <div className="px-1 py-1.5 border-r border-border/30 bg-ask/10 flex items-center justify-center">
                <span className="font-mono text-[11px] font-medium text-ask">
                  {formatPrice(ask.price)}
                </span>
              </div>

              {/* Center Divider */}
              <div className="border-r border-border/30 bg-muted/30" />

              {/* Buy Price */}
              {matchingBid ? (
                <div className="px-1 py-1.5 border-r border-border/30 bg-bid/10 flex items-center justify-center">
                  <span className="font-mono text-[11px] font-medium text-bid">
                    {formatPrice(matchingBid.price)}
                  </span>
                </div>
              ) : (
                <div className="px-1 py-1.5 border-r border-border/30" />
              )}

              {/* Buy Quantity */}
              {matchingBid ? (
                <div className="relative px-1 py-1.5 border-r border-border/30 flex items-center">
                  <div 
                    className="absolute right-0 top-0 h-full bg-bid/15"
                    style={{ width: `${(matchingBid.quantity / maxQuantity) * 100}%` }}
                  />
                  <span className="relative font-mono text-[11px]">
                    {formatQuantity(matchingBid.quantity)}
                  </span>
                </div>
              ) : (
                <div className="px-1 py-1.5 border-r border-border/30" />
              )}

              {/* Buy Button */}
              {matchingBid ? (
                <div className="flex items-center justify-center">
                  <button
                    onDoubleClick={() => handleQuickOrder('buy', matchingBid.price)}
                    className="w-6 h-6 bg-bid/20 hover:bg-bid/40 border border-bid/30 rounded text-[10px] font-bold text-bid transition-colors"
                    title="더블클릭: 매수"
                  >
                    B
                  </button>
                </div>
              ) : (
                <div />
              )}
            </div>
          );
        })}
      </div>

      {/* Current Price Bar */}
      <div className="px-2 py-2 bg-yellow-500/20 border-y-2 border-yellow-500/50">
        <div className="flex items-center justify-center gap-4">
          <span className="text-lg font-bold font-mono">${formatPrice(currentPrice)}</span>
          <span className="text-xs text-muted-foreground">현재가</span>
        </div>
      </div>

      {/* Summary */}
      <div className="px-2 py-2 bg-secondary/30 border-t border-border">
        <div className="flex items-center justify-between text-[10px]">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">총매도</span>
            <span className="font-mono text-ask">{formatQuantity(totalSellQty)}</span>
          </div>
          <div className="flex-1 mx-4 h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-bid rounded-full"
              style={{ width: `${(totalBuyQty / (totalBuyQty + totalSellQty)) * 100}%` }}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-bid">{formatQuantity(totalBuyQty)}</span>
            <span className="text-muted-foreground">총매수</span>
          </div>
        </div>
      </div>

      {/* Quick Order Buttons */}
      <div className="grid grid-cols-2 gap-2 p-2 border-t border-border">
        <button 
          onClick={() => handleQuickOrder('buy', currentPrice)}
          className="py-3 rounded-lg font-bold text-sm bg-bid hover:bg-bid/90 text-white transition-all"
        >
          시장가 매수
        </button>
        <button 
          onClick={() => handleQuickOrder('sell', currentPrice)}
          className="py-3 rounded-lg font-bold text-sm bg-ask hover:bg-ask/90 text-white transition-all"
        >
          시장가 매도
        </button>
      </div>

      {/* Help Text */}
      <div className="px-2 py-1.5 bg-muted/30 border-t border-border">
        <p className="text-[10px] text-muted-foreground text-center">
          💡 호가 옆 버튼 더블클릭 → 즉시 주문
        </p>
      </div>
    </div>
  );
};

export default OrderPanel8282;
