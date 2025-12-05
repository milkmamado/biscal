import { useState, useEffect, useMemo } from 'react';
import { fetchOrderBook, fetch24hTicker, OrderBook, formatPrice, formatQuantity } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { Minus, Plus, Settings, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface OrderPanel8282Props {
  symbol: string;
}

interface Position {
  type: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  leverage: number;
}

const OrderPanel8282 = ({ symbol }: OrderPanel8282Props) => {
  const { toast } = useToast();
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [prevPrice, setPrevPrice] = useState<number>(0);
  const [priceChangePercent, setPriceChangePercent] = useState<number>(0);
  const [orderQty, setOrderQty] = useState<string>('100');
  const [leverage, setLeverage] = useState<number>(20);
  const [loading, setLoading] = useState(true);
  const [clickOrderPercent, setClickOrderPercent] = useState<number>(100);
  const [showSettings, setShowSettings] = useState(false);
  
  // Position state
  const [position, setPosition] = useState<Position | null>(null);
  
  // TP/SL settings (USDT amount)
  const [tpAmount, setTpAmount] = useState<string>('50');
  const [slAmount, setSlAmount] = useState<string>('30');
  const [enableTpSl, setEnableTpSl] = useState<boolean>(true);

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
        
        // Check TP/SL auto close
        if (position && enableTpSl && ticker.price > 0) {
          const pnl = calculatePnL(position, ticker.price);
          const tp = parseFloat(tpAmount) || 0;
          const sl = parseFloat(slAmount) || 0;
          
          if (tp > 0 && pnl >= tp) {
            handleMarketClose();
            toast({
              title: '✅ 익절 청산',
              description: `목표 수익 $${tp} 달성! 실현손익: $${pnl.toFixed(2)}`,
              duration: 3000,
            });
          } else if (sl > 0 && pnl <= -sl) {
            handleMarketClose();
            toast({
              title: '🛑 손절 청산',
              description: `손절선 -$${sl} 도달! 실현손익: $${pnl.toFixed(2)}`,
              duration: 3000,
            });
          }
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
  }, [symbol, position, enableTpSl, tpAmount, slAmount]);

  // Reset position when symbol changes
  useEffect(() => {
    setPosition(null);
  }, [symbol]);

  const calculatePnL = (pos: Position, price: number): number => {
    const direction = pos.type === 'long' ? 1 : -1;
    const priceDiff = (price - pos.entryPrice) * direction;
    const pnl = priceDiff * pos.quantity;
    return pnl;
  };

  const handleQuickOrder = (type: 'long' | 'short', price: number) => {
    const baseQty = parseFloat(orderQty) || 1;
    const actualQty = Math.floor(baseQty * (clickOrderPercent / 100));
    
    // If position exists and same direction, add to position
    // If opposite direction, close position
    if (position) {
      if (position.type !== type) {
        // Close position (opposite direction)
        handleCloseAtPrice(price);
        return;
      }
    }
    
    // Open new position or add to existing
    setPosition({
      type,
      entryPrice: price,
      quantity: actualQty,
      leverage
    });
    
    toast({
      title: type === 'long' ? '🟢 롱 진입' : '🔴 숏 진입',
      description: `${symbol} ${actualQty}개 @ $${formatPrice(price)} (${leverage}x)${enableTpSl ? ` | TP:+$${tpAmount} SL:-$${slAmount}` : ''}`,
      duration: 2000,
    });
  };

  const handleMarketOrder = (type: 'long' | 'short') => {
    const qty = parseFloat(orderQty) || 1;
    
    if (position && position.type !== type) {
      handleMarketClose();
      return;
    }
    
    setPosition({
      type,
      entryPrice: currentPrice,
      quantity: qty,
      leverage
    });
    
    toast({
      title: type === 'long' ? '🟢 시장가 롱' : '🔴 시장가 숏',
      description: `${symbol} ${qty}개 @ 시장가 (${leverage}x)${enableTpSl ? ` | TP:+$${tpAmount} SL:-$${slAmount}` : ''}`,
      duration: 2000,
    });
  };

  const handleMarketClose = () => {
    if (!position) {
      toast({
        title: '포지션 없음',
        description: '청산할 포지션이 없습니다.',
        duration: 2000,
      });
      return;
    }
    
    const pnl = calculatePnL(position, currentPrice);
    toast({
      title: pnl >= 0 ? '✅ 청산 완료' : '❌ 청산 완료',
      description: `${symbol} ${position.quantity}개 @ $${formatPrice(currentPrice)} | 손익: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
      duration: 3000,
    });
    setPosition(null);
  };

  const handleCloseAtPrice = (price: number) => {
    if (!position) return;
    
    const pnl = calculatePnL(position, price);
    toast({
      title: pnl >= 0 ? '✅ 지정가 청산' : '❌ 지정가 청산',
      description: `${symbol} ${position.quantity}개 @ $${formatPrice(price)} | 예상손익: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
      duration: 3000,
    });
    setPosition(null);
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

  // Calculate current PnL and percentage
  const currentPnL = position ? calculatePnL(position, currentPrice) : 0;
  const currentPnLPercent = position 
    ? ((currentPnL / (position.entryPrice * position.quantity)) * 100 * position.leverage)
    : 0;

  if (loading || !orderBook) {
    return (
      <div className="bg-card border border-border rounded">
        <div className="h-[600px] shimmer" />
      </div>
    );
  }

  // 호가 데이터가 비어있는 경우 (상장폐지/거래중단 종목)
  const hasOrderData = orderBook.bids.length > 0 || orderBook.asks.length > 0;
  
  if (!hasOrderData) {
    return (
      <div className="bg-card border border-border rounded text-[11px]">
        <div className="bg-secondary px-2 py-1.5 flex items-center justify-between border-b border-border">
          <div className="flex items-center gap-2">
            <span className="font-bold text-xs text-foreground">[8282] 선물호가주문</span>
            <span className="text-[10px] text-muted-foreground">{symbol}</span>
          </div>
        </div>
        <div className="h-[500px] flex flex-col items-center justify-center gap-3 p-4">
          <div className="text-4xl">⚠️</div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground mb-1">호가 데이터 없음</p>
            <p className="text-xs text-muted-foreground">
              이 종목은 거래가 중단되었거나<br/>
              상장폐지된 종목일 수 있습니다.
            </p>
          </div>
          <div className="mt-2 px-3 py-1.5 bg-yellow-500/20 border border-yellow-500/50 rounded text-[10px] text-yellow-400">
            다른 종목을 선택해주세요
          </div>
        </div>
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
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className={cn(
            "p-1 rounded hover:bg-background/50 transition-colors",
            showSettings && "bg-background/50"
          )}
        >
          <Settings className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Position Display */}
      {position && (
        <div className={cn(
          "px-2 py-1.5 border-b border-border flex items-center justify-between",
          position.type === 'long' ? "bg-red-950/30" : "bg-blue-950/30"
        )}>
          <div className="flex items-center gap-2">
            <span className={cn(
              "px-1.5 py-0.5 rounded text-[10px] font-bold",
              position.type === 'long' ? "bg-red-500 text-white" : "bg-blue-500 text-white"
            )}>
              {position.type === 'long' ? 'LONG' : 'SHORT'}
            </span>
            <span className="text-[10px] font-mono">
              {position.quantity}개 @ ${formatPrice(position.entryPrice)}
            </span>
            <span className="text-[10px] text-muted-foreground">({position.leverage}x)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-end">
              <span className={cn(
                "text-[11px] font-bold font-mono",
                currentPnL >= 0 ? "text-red-400" : "text-blue-400"
              )}>
                {currentPnL >= 0 ? '+' : ''}{currentPnL.toFixed(2)} USDT
              </span>
              <span className={cn(
                "text-[10px] font-bold font-mono",
                currentPnLPercent >= 0 ? "text-red-400" : "text-blue-400"
              )}>
                ({currentPnLPercent >= 0 ? '+' : ''}{currentPnLPercent.toFixed(2)}%)
              </span>
            </div>
            <button
              onClick={handleMarketClose}
              className="px-2 py-0.5 bg-yellow-500 hover:bg-yellow-400 text-yellow-950 text-[10px] font-bold rounded"
            >
              청산
            </button>
          </div>
        </div>
      )}

      {/* Settings Panel */}
      {showSettings && (
        <div className="px-2 py-2 border-b border-border bg-secondary/80 space-y-2">
          {/* Click Order Percent */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">클릭주문</span>
            <div className="flex gap-1">
              {[100, 50, 25, 10].map((p) => (
                <button
                  key={p}
                  onClick={() => setClickOrderPercent(p)}
                  className={cn(
                    "px-2 py-0.5 text-[10px] rounded border transition-colors",
                    clickOrderPercent === p 
                      ? "bg-primary text-primary-foreground border-primary" 
                      : "bg-background border-border hover:bg-secondary"
                  )}
                >
                  {p}%
                </button>
              ))}
            </div>
          </div>
          
          {/* TP/SL Settings */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEnableTpSl(!enableTpSl)}
              className={cn(
                "px-2 py-0.5 text-[10px] rounded border transition-colors",
                enableTpSl 
                  ? "bg-green-600 text-white border-green-600" 
                  : "bg-background border-border text-muted-foreground"
              )}
            >
              자동청산
            </button>
            <span className="text-[10px] text-green-400">익절</span>
            <div className="flex items-center">
              <span className="text-[10px] text-muted-foreground mr-1">+$</span>
              <input
                type="number"
                value={tpAmount}
                onChange={(e) => setTpAmount(e.target.value)}
                className="w-14 bg-background border border-green-600/50 px-1.5 py-0.5 text-[10px] rounded text-center text-green-400"
                disabled={!enableTpSl}
              />
            </div>
            <span className="text-[10px] text-red-400">손절</span>
            <div className="flex items-center">
              <span className="text-[10px] text-muted-foreground mr-1">-$</span>
              <input
                type="number"
                value={slAmount}
                onChange={(e) => setSlAmount(e.target.value)}
                className="w-14 bg-background border border-red-600/50 px-1.5 py-0.5 text-[10px] rounded text-center text-red-400"
                disabled={!enableTpSl}
              />
            </div>
          </div>
          
          <p className="text-[9px] text-muted-foreground">
            {enableTpSl 
              ? `손익이 +$${tpAmount} 또는 -$${slAmount}에 도달하면 자동 청산`
              : '자동청산 비활성화됨'}
          </p>
        </div>
      )}

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
      <div className="grid grid-cols-4 border-b border-border">
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
          className="py-1.5 text-[10px] bg-red-900/50 border-r border-border hover:bg-red-900/70 text-red-400 font-medium"
        >
          시장가롱
        </button>
        <button 
          onClick={handleMarketClose}
          className={cn(
            "py-1.5 text-[10px] font-medium",
            position 
              ? "bg-yellow-600 hover:bg-yellow-500 text-white" 
              : "bg-secondary/50 text-muted-foreground cursor-not-allowed"
          )}
          disabled={!position}
        >
          시장가청산
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
          const isEntryPrice = position && Math.abs(ask.price - position.entryPrice) < position.entryPrice * 0.0001;
          
          return (
            <div 
              key={`ask-${index}`} 
            className="grid grid-cols-[32px_1fr_70px_1fr_32px] text-[11px] border-b border-border/30 hover:bg-secondary/50"
            >
              {/* S button */}
              <button
                onDoubleClick={() => handleQuickOrder('short', ask.price)}
                className="px-1 py-0.5 text-center bg-blue-950/50 hover:bg-blue-900/70 border-r border-border/30 text-blue-400 font-bold text-[10px]"
                title={position ? "더블클릭: 청산" : "더블클릭: 숏 진입"}
              >
                {position?.type === 'long' ? 'C' : 'S'}
              </button>
              
              {/* 매도잔량 */}
              <div className="relative px-1 py-0.5 flex items-center justify-end border-r border-border/30">
                <div 
                  className="absolute right-0 top-0 h-full bg-blue-500/20"
                  style={{ width: `${percentage}%` }}
                />
                <span className="relative font-mono text-blue-400">
                  {formatQuantity(ask.quantity)}
                </span>
              </div>
              
              {/* 호가 */}
              <div className={cn(
                "px-1 py-0.5 text-center border-r border-border/30 font-mono font-medium relative",
                "text-blue-400 bg-blue-950/20"
              )}>
                {isEntryPrice && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1 bg-yellow-400 rounded-full" />}
                {formatPrice(ask.price)}
              </div>

              {/* Empty buy quantity - Show PnL for LONG position at middle-right */}
              <div className="px-1 py-0.5 border-r border-border/30 flex items-center justify-center">
                {position?.type === 'long' && index === Math.floor(askRows.length / 2) && (
                  <div className="flex flex-col items-center bg-red-950/70 px-1.5 py-0.5 rounded border border-red-500/50">
                    <span className="text-[9px] font-bold text-red-400">
                      LONG {position.quantity}개
                    </span>
                    <span className="text-[8px] text-red-300/80 font-mono">
                      @{formatPrice(position.entryPrice)}
                    </span>
                    <span className={cn(
                      "text-[10px] font-bold font-mono",
                      currentPnL >= 0 ? "text-red-400" : "text-blue-400"
                    )}>
                      {currentPnL >= 0 ? '+' : ''}{currentPnL.toFixed(2)}$ ({currentPnLPercent >= 0 ? '+' : ''}{currentPnLPercent.toFixed(2)}%)
                    </span>
                  </div>
                )}
              </div>

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
          const isEntryPrice = position && Math.abs(bid.price - position.entryPrice) < position.entryPrice * 0.0001;
          
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

              {/* Empty sell quantity - Show PnL for SHORT position at middle-left */}
              <div className="px-1 py-0.5 border-r border-border/30 flex items-center justify-center">
                {position?.type === 'short' && index === Math.floor(bidRows.length / 2) && (
                  <div className="flex flex-col items-center bg-blue-950/70 px-1.5 py-0.5 rounded border border-blue-500/50">
                    <span className="text-[9px] font-bold text-blue-400">
                      SHORT {position.quantity}개
                    </span>
                    <span className="text-[8px] text-blue-300/80 font-mono">
                      @{formatPrice(position.entryPrice)}
                    </span>
                    <span className={cn(
                      "text-[10px] font-bold font-mono",
                      currentPnL >= 0 ? "text-red-400" : "text-blue-400"
                    )}>
                      {currentPnL >= 0 ? '+' : ''}{currentPnL.toFixed(2)}$ ({currentPnLPercent >= 0 ? '+' : ''}{currentPnLPercent.toFixed(2)}%)
                    </span>
                  </div>
                )}
              </div>

              {/* 호가 */}
              <div className={cn(
                "px-1 py-0.5 text-center border-r border-border/30 font-mono font-medium relative",
                "text-red-400 bg-red-950/20"
              )}>
                {isEntryPrice && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1 bg-yellow-400 rounded-full" />}
                {formatPrice(bid.price)}
              </div>

              {/* 매수잔량 */}
              <div className="relative px-1 py-0.5 flex items-center border-r border-border/30">
                <div 
                  className="absolute left-0 top-0 h-full bg-red-500/20"
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
                title={position ? "더블클릭: 청산" : "더블클릭: 롱 진입"}
              >
                {position?.type === 'short' ? 'C' : 'B'}
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
      <div className={cn("grid border-t border-border", position ? "grid-cols-3" : "grid-cols-2")}>
        <button 
          onClick={() => handleQuickOrder('short', currentPrice)}
          className="py-2.5 font-bold text-sm bg-blue-600 hover:bg-blue-500 text-white border-r border-border"
        >
          숏 (매도)
        </button>
        {position && (
          <button 
            onClick={handleMarketClose}
            className="py-2.5 font-bold text-sm bg-yellow-600 hover:bg-yellow-500 text-white border-r border-border"
          >
            청산
          </button>
        )}
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
          S/B 더블클릭 → 진입 | 포지션 보유 시 반대방향 클릭 → 청산
        </p>
      </div>
    </div>
  );
};

export default OrderPanel8282;
