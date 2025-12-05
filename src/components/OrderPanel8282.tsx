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
  const [prevPrice, setPrevPrice] = useState<number>(0);
  const [orderQty, setOrderQty] = useState<string>('1');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [book, ticker] = await Promise.all([
          fetchOrderBook(symbol, 10),
          fetch24hTicker(symbol)
        ]);
        setOrderBook(book);
        setPrevPrice(currentPrice);
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
  const priceChange = currentPrice - prevPrice;

  // Reversed asks (highest first at top)
  const askRows = [...orderBook.asks].reverse().slice(0, 10);
  // Bids (highest first at top)
  const bidRows = orderBook.bids.slice(0, 10);

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border bg-secondary/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold">[8282] 주식호가주문</span>
          <span className="text-[10px] text-muted-foreground">{symbol}</span>
        </div>
        <Settings className="w-3.5 h-3.5 text-muted-foreground cursor-pointer hover:text-foreground" />
      </div>

      {/* Quantity Input Row */}
      <div className="px-2 py-1.5 border-b border-border bg-muted/30 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">수량</span>
        <div className="flex items-center gap-1 flex-1">
          <button onClick={() => adjustQty(-1)} className="w-5 h-5 flex items-center justify-center bg-secondary rounded">
            <Minus className="w-3 h-3" />
          </button>
          <input
            type="text"
            value={orderQty}
            onChange={(e) => setOrderQty(e.target.value)}
            className="w-16 bg-background border border-border rounded px-2 py-0.5 text-center font-mono text-xs"
          />
          <button onClick={() => adjustQty(1)} className="w-5 h-5 flex items-center justify-center bg-secondary rounded">
            <Plus className="w-3 h-3" />
          </button>
        </div>
        {[100, 500].map((p) => (
          <button key={p} onClick={() => handleQtyPreset(p)} className="px-2 py-0.5 bg-secondary rounded text-[10px]">
            {p}
          </button>
        ))}
      </div>

      {/* Column Headers - Kiwoom Style */}
      <div className="grid grid-cols-[1fr_70px_70px_1fr] text-[10px] font-medium border-b border-border bg-muted/50">
        <div className="px-2 py-1 text-center text-ask border-r border-border/50">매도잔량</div>
        <div className="px-2 py-1 text-center border-r border-border/50 col-span-2">호가</div>
        <div className="px-2 py-1 text-center text-bid">매수잔량</div>
      </div>

      {/* Sell Side (매도) - Blue - Top */}
      <div className="border-b border-border/50">
        {askRows.map((ask, index) => {
          const percentage = (ask.quantity / maxQuantity) * 100;
          
          return (
            <div 
              key={`ask-${index}`} 
              className="grid grid-cols-[1fr_70px_70px_1fr] text-xs border-b border-border/20 hover:bg-secondary/30"
            >
              {/* 매도잔량 (Sell Quantity) - Left with blue bar */}
              <div className="relative px-2 py-1 flex items-center justify-end border-r border-border/30">
                <div 
                  className="absolute left-0 top-0 h-full bg-ask/20"
                  style={{ width: `${percentage}%` }}
                />
                <span className="relative font-mono text-[11px] text-ask">
                  {formatQuantity(ask.quantity)}
                </span>
              </div>
              
              {/* 매도호가 (Sell Price) - Blue background */}
              <button
                onDoubleClick={() => handleQuickOrder('sell', ask.price)}
                className="px-2 py-1 text-center bg-ask/10 hover:bg-ask/20 border-r border-border/30 transition-colors"
                title="더블클릭: 매도"
              >
                <span className="font-mono text-[11px] font-medium text-ask">
                  {formatPrice(ask.price)}
                </span>
              </button>

              {/* Empty buy price cell */}
              <div className="px-2 py-1 border-r border-border/30" />

              {/* Empty buy quantity cell */}
              <div className="px-2 py-1" />
            </div>
          );
        })}
      </div>

      {/* Current Price Bar - Yellow highlight */}
      <div className="px-3 py-2 bg-yellow-400/30 border-y-2 border-yellow-500">
        <div className="flex items-center justify-center gap-3">
          <span className={cn(
            "text-xl font-bold font-mono",
            priceChange > 0 ? "text-bid" : priceChange < 0 ? "text-ask" : ""
          )}>
            {formatPrice(currentPrice)}
          </span>
          <span className="px-2 py-0.5 bg-yellow-500 text-yellow-950 text-[10px] font-bold rounded">
            현재
          </span>
        </div>
      </div>

      {/* Buy Side (매수) - Red - Bottom */}
      <div className="border-t border-border/50">
        {bidRows.map((bid, index) => {
          const percentage = (bid.quantity / maxQuantity) * 100;
          
          return (
            <div 
              key={`bid-${index}`} 
              className="grid grid-cols-[1fr_70px_70px_1fr] text-xs border-b border-border/20 hover:bg-secondary/30"
            >
              {/* Empty sell quantity cell */}
              <div className="px-2 py-1 border-r border-border/30" />

              {/* Empty sell price cell */}
              <div className="px-2 py-1 border-r border-border/30" />

              {/* 매수호가 (Buy Price) - Red background */}
              <button
                onDoubleClick={() => handleQuickOrder('buy', bid.price)}
                className="px-2 py-1 text-center bg-bid/10 hover:bg-bid/20 border-r border-border/30 transition-colors"
                title="더블클릭: 매수"
              >
                <span className="font-mono text-[11px] font-medium text-bid">
                  {formatPrice(bid.price)}
                </span>
              </button>

              {/* 매수잔량 (Buy Quantity) - Right with red bar */}
              <div className="relative px-2 py-1 flex items-center border-r border-border/30">
                <div 
                  className="absolute right-0 top-0 h-full bg-bid/20"
                  style={{ width: `${percentage}%` }}
                />
                <span className="relative font-mono text-[11px] text-bid">
                  {formatQuantity(bid.quantity)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="px-2 py-1.5 bg-muted/30 border-t border-border flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1">
          <span className="text-ask">총매도</span>
          <span className="font-mono text-ask">{formatQuantity(totalSellQty)}</span>
        </div>
        <div className="flex-1 mx-3 h-1.5 bg-muted rounded-full overflow-hidden flex">
          <div 
            className="h-full bg-ask"
            style={{ width: `${(totalSellQty / (totalBuyQty + totalSellQty)) * 100}%` }}
          />
          <div 
            className="h-full bg-bid"
            style={{ width: `${(totalBuyQty / (totalBuyQty + totalSellQty)) * 100}%` }}
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-bid">{formatQuantity(totalBuyQty)}</span>
          <span className="text-bid">총매수</span>
        </div>
      </div>

      {/* Quick Order Buttons */}
      <div className="grid grid-cols-2 gap-2 p-2 border-t border-border">
        <button 
          onClick={() => handleQuickOrder('sell', currentPrice)}
          className="py-2.5 rounded font-bold text-sm bg-ask hover:bg-ask/90 text-white transition-all"
        >
          매도
        </button>
        <button 
          onClick={() => handleQuickOrder('buy', currentPrice)}
          className="py-2.5 rounded font-bold text-sm bg-bid hover:bg-bid/90 text-white transition-all"
        >
          매수
        </button>
      </div>

      {/* Help */}
      <div className="px-2 py-1 bg-muted/20 border-t border-border text-center">
        <p className="text-[9px] text-muted-foreground">
          호가 더블클릭 → 해당 가격 주문
        </p>
      </div>
    </div>
  );
};

export default OrderPanel8282;
