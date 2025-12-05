import { useState, useEffect, useMemo } from 'react';
import { fetchOrderBook, fetch24hTicker, OrderBook, formatPrice, formatQuantity } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { Minus, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface OrderPanel8282Props {
  symbol: string;
}

const OrderPanel8282 = ({ symbol }: OrderPanel8282Props) => {
  const { toast } = useToast();
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [prevPrice, setPrevPrice] = useState<number>(0);
  const [priceChangePercent, setPriceChangePercent] = useState<number>(0);
  const [orderQty, setOrderQty] = useState<string>('1');
  const [leverage, setLeverage] = useState<number>(20);
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
        setPriceChangePercent(ticker.priceChangePercent);
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

  const handleQuickOrder = (type: 'long' | 'short', price: number) => {
    const qty = parseFloat(orderQty) || 1;
    toast({
      title: type === 'long' ? '롱 진입' : '숏 진입',
      description: `${symbol} ${qty}개 @ $${formatPrice(price)} (${leverage}x)`,
      duration: 2000,
    });
  };

  const handleMarketOrder = (type: 'long' | 'short') => {
    const qty = parseFloat(orderQty) || 1;
    toast({
      title: type === 'long' ? '시장가 롱' : '시장가 숏',
      description: `${symbol} ${qty}개 @ 시장가 (${leverage}x)`,
      duration: 2000,
    });
  };

  const handleCancelAll = () => {
    toast({
      title: '일괄취소',
      description: '모든 미체결 주문이 취소되었습니다.',
      duration: 2000,
    });
  };

  const handleQtyPreset = (percent: number) => {
    const baseQty = 100;
    setOrderQty(Math.floor(baseQty * (percent / 100)).toString());
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
      <div className="bg-card border border-border rounded">
        <div className="h-[600px] shimmer" />
      </div>
    );
  }

  const totalBuyQty = orderBook.bids.reduce((sum, b) => sum + b.quantity, 0);
  const totalSellQty = orderBook.asks.reduce((sum, a) => sum + a.quantity, 0);
  const priceChange = currentPrice - prevPrice;

  const askRows = [...orderBook.asks].reverse().slice(0, 10);
  const bidRows = orderBook.bids.slice(0, 10);

  return (
    <div className="bg-card border border-border rounded text-[11px]">
      {/* Title Bar */}
      <div className="bg-secondary px-2 py-1.5 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <span className="font-bold text-xs text-foreground">[8282] 선물호가주문</span>
          <span className="text-[10px] text-muted-foreground">{symbol}</span>
        </div>
      </div>

      {/* Toolbar Row */}
      <div className="px-2 py-1.5 border-b border-border bg-secondary/50 flex items-center gap-2 flex-wrap">
        <select 
          value={leverage} 
          onChange={(e) => setLeverage(Number(e.target.value))}
          className="bg-background border border-border px-1.5 py-0.5 text-[10px] rounded"
        >
          {[1, 2, 3, 5, 10, 20, 50, 75, 100, 125].map(l => (
            <option key={l} value={l}>{l}x</option>
          ))}
        </select>
        <span className="text-[10px] text-muted-foreground">레버리지</span>
        <div className="flex-1" />
        {[100, 50, 25, 10].map((p) => (
          <button 
            key={p} 
            onClick={() => handleQtyPreset(p)} 
            className="px-2 py-0.5 bg-secondary border border-border text-[10px] rounded hover:bg-secondary/80"
          >
            {p}%
          </button>
        ))}
      </div>

      {/* Quantity Input Row */}
      <div className="px-2 py-1.5 border-b border-border bg-secondary/30 flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">수량</span>
        <button 
          onClick={() => adjustQty(-1)} 
          className="w-6 h-6 bg-secondary border border-border rounded flex items-center justify-center hover:bg-secondary/80"
        >
          <Minus className="w-3 h-3" />
        </button>
        <input
          type="text"
          value={orderQty}
          onChange={(e) => setOrderQty(e.target.value)}
          className="w-20 bg-background border border-border px-2 py-1 text-center font-mono text-[11px] rounded"
        />
        <button 
          onClick={() => adjustQty(1)} 
          className="w-6 h-6 bg-secondary border border-border rounded flex items-center justify-center hover:bg-secondary/80"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Market Order Buttons */}
      <div className="grid grid-cols-3 border-b border-border">
        <button 
          onClick={handleCancelAll}
          className="py-1.5 text-[10px] bg-secondary hover:bg-secondary/80 border-r border-border font-medium"
        >
          일괄취소
        </button>
        <button 
          onClick={() => handleMarketOrder('short')}
          className="py-1.5 text-[10px] bg-blue-900/50 border-r border-border hover:bg-blue-900/70 text-blue-400 font-medium"
        >
          시장가숏
        </button>
        <button 
          onClick={() => handleMarketOrder('long')}
          className="py-1.5 text-[10px] bg-red-900/50 hover:bg-red-900/70 text-red-400 font-medium"
        >
          시장가롱
        </button>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-[32px_1fr_70px_1fr_32px] text-[10px] font-medium border-b border-border bg-secondary/70">
        <div className="px-1 py-1 text-center border-r border-border/50 text-blue-400">S</div>
        <div className="px-1 py-1 text-center border-r border-border/50 text-blue-400">매도잔량</div>
        <div className="px-1 py-1 text-center border-r border-border/50 text-muted-foreground">호가</div>
        <div className="px-1 py-1 text-center border-r border-border/50 text-red-400">매수잔량</div>
        <div className="px-1 py-1 text-center text-red-400">B</div>
      </div>

      {/* Order Book - Sell Side (Top) */}
      <div className="border-b border-border/50">
        {askRows.map((ask, index) => {
          const percentage = (ask.quantity / maxQuantity) * 100;
          
          return (
            <div 
              key={`ask-${index}`} 
              className="grid grid-cols-[32px_1fr_70px_1fr_32px] text-[11px] border-b border-border/30 hover:bg-secondary/50"
            >
              {/* S button */}
              <button
                onDoubleClick={() => handleQuickOrder('short', ask.price)}
                className="px-1 py-0.5 text-center bg-blue-950/50 hover:bg-blue-900/70 border-r border-border/30 text-blue-400 font-bold text-[10px]"
                title="더블클릭: 숏 진입"
              >
                S
              </button>
              
              {/* 매도잔량 */}
              <div className="relative px-1 py-0.5 flex items-center justify-end border-r border-border/30">
                <div 
                  className="absolute left-0 top-0 h-full bg-blue-500/20"
                  style={{ width: `${percentage}%` }}
                />
                <span className="relative font-mono text-blue-400">
                  {formatQuantity(ask.quantity)}
                </span>
              </div>
              
              {/* 호가 */}
              <div className="px-1 py-0.5 text-center border-r border-border/30 font-mono font-medium text-red-400 bg-red-950/20">
                {formatPrice(ask.price)}
              </div>

              {/* Empty buy quantity */}
              <div className="px-1 py-0.5 border-r border-border/30" />

              {/* B button */}
              <button
                onDoubleClick={() => handleQuickOrder('long', ask.price)}
                className="px-1 py-0.5 text-center bg-red-950/50 hover:bg-red-900/70 text-red-400 font-bold text-[10px]"
                title="더블클릭: 롱 진입"
              >
                B
              </button>
            </div>
          );
        })}
      </div>

      {/* Current Price Bar */}
      <div className="bg-yellow-500/20 border-y-2 border-yellow-500 px-2 py-1.5">
        <div className="flex items-center justify-center gap-2">
          <span className={cn(
            "text-lg font-bold font-mono",
            priceChange >= 0 ? "text-red-400" : "text-blue-400"
          )}>
            {formatPrice(currentPrice)}
          </span>
          <span className="bg-yellow-500 text-yellow-950 px-1.5 py-0.5 text-[10px] font-bold rounded">
            현재
          </span>
          <span className={cn(
            "text-[11px] font-mono",
            priceChangePercent >= 0 ? "text-red-400" : "text-blue-400"
          )}>
            {priceChangePercent >= 0 ? '▲' : '▼'} {Math.abs(priceChangePercent).toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Order Book - Buy Side (Bottom) */}
      <div className="border-b border-border/50">
        {bidRows.map((bid, index) => {
          const percentage = (bid.quantity / maxQuantity) * 100;
          
          return (
            <div 
              key={`bid-${index}`} 
              className="grid grid-cols-[32px_1fr_70px_1fr_32px] text-[11px] border-b border-border/30 hover:bg-secondary/50"
            >
              {/* S button */}
              <button
                onDoubleClick={() => handleQuickOrder('short', bid.price)}
                className="px-1 py-0.5 text-center bg-blue-950/50 hover:bg-blue-900/70 border-r border-border/30 text-blue-400 font-bold text-[10px]"
                title="더블클릭: 숏 진입"
              >
                S
              </button>

              {/* Empty sell quantity */}
              <div className="px-1 py-0.5 border-r border-border/30" />

              {/* 호가 */}
              <div className="px-1 py-0.5 text-center border-r border-border/30 font-mono font-medium text-blue-400 bg-blue-950/20">
                {formatPrice(bid.price)}
              </div>

              {/* 매수잔량 */}
              <div className="relative px-1 py-0.5 flex items-center border-r border-border/30">
                <div 
                  className="absolute right-0 top-0 h-full bg-red-500/20"
                  style={{ width: `${percentage}%` }}
                />
                <span className="relative font-mono text-red-400">
                  {formatQuantity(bid.quantity)}
                </span>
              </div>

              {/* B button */}
              <button
                onDoubleClick={() => handleQuickOrder('long', bid.price)}
                className="px-1 py-0.5 text-center bg-red-950/50 hover:bg-red-900/70 text-red-400 font-bold text-[10px]"
                title="더블클릭: 롱 진입"
              >
                B
              </button>
            </div>
          );
        })}
      </div>

      {/* Summary Bar */}
      <div className="px-2 py-1.5 bg-secondary/50 border-t border-border flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1">
          <span className="text-blue-400 font-medium">총매도</span>
          <span className="font-mono text-blue-400">{formatQuantity(totalSellQty)}</span>
        </div>
        <div className="flex-1 mx-2 h-2 bg-secondary rounded overflow-hidden flex">
          <div 
            className="h-full bg-blue-500"
            style={{ width: `${(totalSellQty / (totalBuyQty + totalSellQty)) * 100}%` }}
          />
          <div 
            className="h-full bg-red-500"
            style={{ width: `${(totalBuyQty / (totalBuyQty + totalSellQty)) * 100}%` }}
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-red-400">{formatQuantity(totalBuyQty)}</span>
          <span className="text-red-400 font-medium">총매수</span>
        </div>
      </div>

      {/* Quick Order Buttons */}
      <div className="grid grid-cols-2 border-t border-border">
        <button 
          onClick={() => handleQuickOrder('short', currentPrice)}
          className="py-2.5 font-bold text-sm bg-blue-600 hover:bg-blue-500 text-white border-r border-border"
        >
          숏 (매도)
        </button>
        <button 
          onClick={() => handleQuickOrder('long', currentPrice)}
          className="py-2.5 font-bold text-sm bg-red-600 hover:bg-red-500 text-white"
        >
          롱 (매수)
        </button>
      </div>

      {/* Footer */}
      <div className="px-2 py-1 bg-secondary/30 border-t border-border text-center">
        <p className="text-[9px] text-muted-foreground">
          S/B 버튼 더블클릭 → 해당 가격 지정가 주문
        </p>
      </div>
    </div>
  );
};

export default OrderPanel8282;
