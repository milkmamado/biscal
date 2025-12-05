import { useState, useEffect, useMemo } from 'react';
import { fetchOrderBook, fetch24hTicker, OrderBook, formatPrice, formatQuantity } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { Minus, Plus, Settings, X } from 'lucide-react';
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
    // In real app, this would calculate based on available balance
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
      <div className="bg-[#f0f0f0] border border-[#808080] rounded-sm">
        <div className="h-[600px] shimmer" />
      </div>
    );
  }

  const totalBuyQty = orderBook.bids.reduce((sum, b) => sum + b.quantity, 0);
  const totalSellQty = orderBook.asks.reduce((sum, a) => sum + a.quantity, 0);
  const priceChange = currentPrice - prevPrice;

  // 10 levels each
  const askRows = [...orderBook.asks].reverse().slice(0, 10);
  const bidRows = orderBook.bids.slice(0, 10);

  return (
    <div className="bg-[#f5f5f5] border border-[#a0a0a0] rounded-sm shadow-sm font-sans text-[11px]">
      {/* Title Bar - Windows style */}
      <div className="bg-gradient-to-r from-[#1e3a5f] to-[#2d5a8f] px-2 py-1 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white">
          <span className="font-bold text-xs">[8282] 선물호가주문</span>
          <span className="text-[10px] opacity-80">{symbol}</span>
        </div>
        <div className="flex items-center gap-1">
          <button className="w-4 h-4 bg-[#c0c0c0] border border-[#808080] flex items-center justify-center text-[10px] hover:bg-[#d0d0d0]">
            <Minus className="w-2.5 h-2.5 text-black" />
          </button>
          <button className="w-4 h-4 bg-[#c0c0c0] border border-[#808080] flex items-center justify-center text-[10px] hover:bg-[#d0d0d0]">
            <X className="w-2.5 h-2.5 text-black" />
          </button>
        </div>
      </div>

      {/* Toolbar Row */}
      <div className="px-1 py-1 border-b border-[#c0c0c0] bg-[#e8e8e8] flex items-center gap-1 flex-wrap">
        <select 
          value={leverage} 
          onChange={(e) => setLeverage(Number(e.target.value))}
          className="bg-white border border-[#808080] px-1 py-0.5 text-[10px] w-14"
        >
          {[1, 2, 3, 5, 10, 20, 50, 75, 100, 125].map(l => (
            <option key={l} value={l}>{l}x</option>
          ))}
        </select>
        <span className="text-[10px] text-gray-600">레버리지</span>
        <div className="flex-1" />
        {[100, 50, 25, 10].map((p) => (
          <button 
            key={p} 
            onClick={() => handleQtyPreset(p)} 
            className="px-1.5 py-0.5 bg-white border border-[#808080] text-[10px] hover:bg-[#e0e0e0]"
          >
            {p}%
          </button>
        ))}
      </div>

      {/* Quantity Input Row */}
      <div className="px-1 py-1 border-b border-[#c0c0c0] bg-[#e8e8e8] flex items-center gap-1">
        <span className="text-[10px] text-gray-700 w-8">수량</span>
        <button 
          onClick={() => adjustQty(-1)} 
          className="w-5 h-5 bg-white border border-[#808080] flex items-center justify-center hover:bg-[#e0e0e0]"
        >
          <Minus className="w-3 h-3" />
        </button>
        <input
          type="text"
          value={orderQty}
          onChange={(e) => setOrderQty(e.target.value)}
          className="w-20 bg-white border border-[#808080] px-2 py-0.5 text-center font-mono text-[11px]"
        />
        <button 
          onClick={() => adjustQty(1)} 
          className="w-5 h-5 bg-white border border-[#808080] flex items-center justify-center hover:bg-[#e0e0e0]"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Market Order Buttons */}
      <div className="grid grid-cols-2 border-b border-[#c0c0c0]">
        <button 
          onClick={handleCancelAll}
          className="py-1 text-[10px] bg-[#f0f0f0] border-r border-[#c0c0c0] hover:bg-[#e0e0e0] font-medium"
        >
          일괄취소
        </button>
        <div className="grid grid-cols-2">
          <button 
            onClick={() => handleMarketOrder('short')}
            className="py-1 text-[10px] bg-[#d0e0ff] border-r border-[#c0c0c0] hover:bg-[#b0d0ff] text-blue-800 font-medium"
          >
            시장가숏
          </button>
          <button 
            onClick={() => handleMarketOrder('long')}
            className="py-1 text-[10px] bg-[#ffd0d0] hover:bg-[#ffb0b0] text-red-800 font-medium"
          >
            시장가롱
          </button>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-[40px_1fr_80px_1fr_40px] text-[10px] font-medium border-b border-[#a0a0a0] bg-[#d8d8d8]">
        <div className="px-1 py-0.5 text-center border-r border-[#c0c0c0] text-blue-700">S</div>
        <div className="px-1 py-0.5 text-center border-r border-[#c0c0c0] text-blue-700">매도잔량</div>
        <div className="px-1 py-0.5 text-center border-r border-[#c0c0c0]">호가</div>
        <div className="px-1 py-0.5 text-center border-r border-[#c0c0c0] text-red-700">매수잔량</div>
        <div className="px-1 py-0.5 text-center text-red-700">B</div>
      </div>

      {/* Order Book - Sell Side (Top) */}
      <div className="border-b border-[#a0a0a0]">
        {askRows.map((ask, index) => {
          const percentage = (ask.quantity / maxQuantity) * 100;
          const isAboveCurrentPrice = ask.price > currentPrice;
          
          return (
            <div 
              key={`ask-${index}`} 
              className="grid grid-cols-[40px_1fr_80px_1fr_40px] text-[11px] border-b border-[#e0e0e0] hover:bg-[#ffffd0]"
            >
              {/* S button - Short entry */}
              <button
                onDoubleClick={() => handleQuickOrder('short', ask.price)}
                className="px-1 py-0.5 text-center bg-[#e8f0ff] hover:bg-[#c0d8ff] border-r border-[#c0c0c0] text-blue-700 font-bold text-[10px]"
                title="더블클릭: 숏 진입"
              >
                S
              </button>
              
              {/* 매도잔량 (Sell Quantity) - Blue */}
              <div className="relative px-1 py-0.5 flex items-center justify-end border-r border-[#c0c0c0]">
                <div 
                  className="absolute left-0 top-0 h-full bg-blue-200"
                  style={{ width: `${percentage}%` }}
                />
                <span className="relative font-mono text-blue-700 font-medium">
                  {formatQuantity(ask.quantity)}
                </span>
              </div>
              
              {/* 호가 (Price) - Red if above current */}
              <div className={cn(
                "px-1 py-0.5 text-center border-r border-[#c0c0c0] font-mono font-medium",
                isAboveCurrentPrice ? "text-red-600 bg-[#fff8f8]" : "text-blue-600 bg-[#f8f8ff]"
              )}>
                {formatPrice(ask.price)}
              </div>

              {/* Empty buy quantity cell */}
              <div className="px-1 py-0.5 border-r border-[#c0c0c0]" />

              {/* Empty B button cell */}
              <div className="px-1 py-0.5 bg-[#f8f8f8]" />
            </div>
          );
        })}
      </div>

      {/* Current Price Bar - Yellow highlight like Kiwoom */}
      <div className="bg-[#ffff00] border-y-2 border-[#ffa500] px-2 py-1.5">
        <div className="flex items-center justify-center gap-2">
          <span className={cn(
            "text-lg font-bold font-mono",
            priceChange >= 0 ? "text-red-600" : "text-blue-600"
          )}>
            {formatPrice(currentPrice)}
          </span>
          <span className="bg-[#ff6600] text-white px-1.5 py-0.5 text-[10px] font-bold rounded-sm">
            현재
          </span>
          <span className={cn(
            "text-[11px] font-mono",
            priceChangePercent >= 0 ? "text-red-600" : "text-blue-600"
          )}>
            {priceChangePercent >= 0 ? '▲' : '▼'} {Math.abs(priceChangePercent).toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Order Book - Buy Side (Bottom) */}
      <div className="border-b border-[#a0a0a0]">
        {bidRows.map((bid, index) => {
          const percentage = (bid.quantity / maxQuantity) * 100;
          const isBelowCurrentPrice = bid.price < currentPrice;
          
          return (
            <div 
              key={`bid-${index}`} 
              className="grid grid-cols-[40px_1fr_80px_1fr_40px] text-[11px] border-b border-[#e0e0e0] hover:bg-[#ffffd0]"
            >
              {/* Empty S button cell */}
              <div className="px-1 py-0.5 border-r border-[#c0c0c0] bg-[#f8f8f8]" />

              {/* Empty sell quantity cell */}
              <div className="px-1 py-0.5 border-r border-[#c0c0c0]" />

              {/* 호가 (Price) - Blue if below current */}
              <div className={cn(
                "px-1 py-0.5 text-center border-r border-[#c0c0c0] font-mono font-medium",
                isBelowCurrentPrice ? "text-blue-600 bg-[#f8f8ff]" : "text-red-600 bg-[#fff8f8]"
              )}>
                {formatPrice(bid.price)}
              </div>

              {/* 매수잔량 (Buy Quantity) - Red */}
              <div className="relative px-1 py-0.5 flex items-center border-r border-[#c0c0c0]">
                <div 
                  className="absolute right-0 top-0 h-full bg-red-200"
                  style={{ width: `${percentage}%` }}
                />
                <span className="relative font-mono text-red-700 font-medium">
                  {formatQuantity(bid.quantity)}
                </span>
              </div>

              {/* B button - Long entry */}
              <button
                onDoubleClick={() => handleQuickOrder('long', bid.price)}
                className="px-1 py-0.5 text-center bg-[#ffe8e8] hover:bg-[#ffc0c0] text-red-700 font-bold text-[10px]"
                title="더블클릭: 롱 진입"
              >
                B
              </button>
            </div>
          );
        })}
      </div>

      {/* Summary Bar */}
      <div className="px-1 py-1 bg-[#e8e8e8] border-t border-[#a0a0a0] flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1">
          <span className="text-blue-700 font-medium">총매도</span>
          <span className="font-mono text-blue-700">{formatQuantity(totalSellQty)}</span>
        </div>
        <div className="flex-1 mx-2 h-2 bg-[#c0c0c0] overflow-hidden flex">
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
          <span className="font-mono text-red-700">{formatQuantity(totalBuyQty)}</span>
          <span className="text-red-700 font-medium">총매수</span>
        </div>
      </div>

      {/* Quick Order Buttons - Kiwoom style */}
      <div className="grid grid-cols-2 border-t border-[#a0a0a0]">
        <button 
          onClick={() => handleQuickOrder('short', currentPrice)}
          className="py-2 font-bold text-sm bg-[#3366cc] hover:bg-[#2255bb] text-white border-r border-[#a0a0a0]"
        >
          숏 (매도)
        </button>
        <button 
          onClick={() => handleQuickOrder('long', currentPrice)}
          className="py-2 font-bold text-sm bg-[#cc3333] hover:bg-[#bb2222] text-white"
        >
          롱 (매수)
        </button>
      </div>

      {/* Footer */}
      <div className="px-1 py-0.5 bg-[#d8d8d8] border-t border-[#a0a0a0] text-center">
        <p className="text-[9px] text-gray-600">
          S/B 버튼 더블클릭 → 해당 가격 지정가 주문
        </p>
      </div>
    </div>
  );
};

export default OrderPanel8282;
