import { useState, useEffect, useMemo, useRef } from 'react';
import { fetchOrderBook, fetch24hTicker, OrderBook, formatPrice, formatQuantity, calculateTechnicalSignal, TechnicalSignal } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { Minus, Plus, Settings, TrendingUp, TrendingDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Position {
  type: 'long' | 'short';
  entryPrice: number;
  quantity: number;
  leverage: number;
}

interface PendingOrder {
  id: string;
  type: 'long' | 'short';
  price: number;
  quantity: number;
  leverage: number;
  createdAt: number;
}

interface OrderPanel8282Props {
  symbol: string;
  onPositionChange?: (position: Position | null) => void;
  onPnLChange?: (pnl: number) => void;
  onTradeClose?: (pnl: number) => void;
}

const OrderPanel8282 = ({ symbol, onPositionChange, onPnLChange, onTradeClose }: OrderPanel8282Props) => {
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
  
  // Pending orders state
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  
  // Notify parent when position changes
  useEffect(() => {
    onPositionChange?.(position);
  }, [position, onPositionChange]);
  
  // TP/SL settings (USDT amount)
  const [tpAmount, setTpAmount] = useState<string>('50');
  const [slAmount, setSlAmount] = useState<string>('30');
  const [enableTpSl, setEnableTpSl] = useState<boolean>(true);
  
  // Trailing stop settings
  const [enableTrailing, setEnableTrailing] = useState<boolean>(false);
  const [trailingStep, setTrailingStep] = useState<number>(1.0); // 포인트 단위
  const [trailingStopPrice, setTrailingStopPrice] = useState<number | null>(null);
  const [highestProfit, setHighestProfit] = useState<number>(0);
  
  // Balance for order calculation (in KRW)
  const [balanceKRW, setBalanceKRW] = useState<string>('1000000');
  const [usdKrwRate, setUsdKrwRate] = useState<number>(1380);
  const [rateLoading, setRateLoading] = useState<boolean>(false);
  const balanceUSD = (parseFloat(balanceKRW) || 0) / usdKrwRate;
  
  // Fetch USD/KRW exchange rate
  useEffect(() => {
    const fetchExchangeRate = async () => {
      setRateLoading(true);
      try {
        const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=KRW');
        const data = await res.json();
        if (data.rates?.KRW) {
          setUsdKrwRate(Math.round(data.rates.KRW));
        }
      } catch (error) {
        console.error('Failed to fetch exchange rate:', error);
      } finally {
        setRateLoading(false);
      }
    };
    
    fetchExchangeRate();
    // Refresh every 30 minutes
    const interval = setInterval(fetchExchangeRate, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);
  
  // Technical signal state
  const [techSignal, setTechSignal] = useState<TechnicalSignal | null>(null);
  const lastSignalFetch = useRef<number>(0);

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
        
        // Fetch technical signal every 5 seconds
        const now = Date.now();
        if (now - lastSignalFetch.current > 5000) {
          lastSignalFetch.current = now;
          calculateTechnicalSignal(symbol).then(setTechSignal);
        }
        
        // Check pending orders for fill
        if (pendingOrders.length > 0 && ticker.price > 0) {
          const filledOrders: PendingOrder[] = [];
          const remainingOrders: PendingOrder[] = [];
          
          pendingOrders.forEach(order => {
            // Long order fills when price drops to or below order price
            // Short order fills when price rises to or above order price
            const shouldFill = order.type === 'long' 
              ? ticker.price <= order.price 
              : ticker.price >= order.price;
            
            if (shouldFill) {
              filledOrders.push(order);
            } else {
              remainingOrders.push(order);
            }
          });
          
          // Process filled orders
          if (filledOrders.length > 0) {
            filledOrders.forEach(order => {
              if (position && position.type === order.type) {
                // 추매
                const totalQty = position.quantity + order.quantity;
                const avgPrice = ((position.entryPrice * position.quantity) + (order.price * order.quantity)) / totalQty;
                setPosition({
                  type: order.type,
                  entryPrice: avgPrice,
                  quantity: totalQty,
                  leverage: order.leverage
                });
                toast({
                  title: order.type === 'long' ? '🟢 지정가 롱 체결 (추매)' : '🔴 지정가 숏 체결 (추매)',
                  description: `${symbol} +${order.quantity}개 @ $${formatPrice(order.price)} 체결`,
                  duration: 2000,
                });
              } else if (position && position.type !== order.type) {
                // 청산
                const pnl = calculatePnL(position, order.price);
                onTradeClose?.(pnl);
                toast({
                  title: pnl >= 0 ? '✅ 지정가 청산 체결' : '❌ 지정가 청산 체결',
                  description: `${symbol} @ $${formatPrice(order.price)} | 손익: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
                  duration: 3000,
                });
                setPosition(null);
              } else {
                // 신규 진입
                setPosition({
                  type: order.type,
                  entryPrice: order.price,
                  quantity: order.quantity,
                  leverage: order.leverage
                });
                toast({
                  title: order.type === 'long' ? '🟢 지정가 롱 체결' : '🔴 지정가 숏 체결',
                  description: `${symbol} ${order.quantity}개 @ $${formatPrice(order.price)} 체결`,
                  duration: 2000,
                });
              }
            });
            setPendingOrders(remainingOrders);
          }
        }
        
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
  }, [symbol, position, enableTpSl, tpAmount, slAmount, pendingOrders]);

  // Reset position and signal when symbol changes
  useEffect(() => {
    setPosition(null);
    setTechSignal(null);
    setPendingOrders([]);
    lastSignalFetch.current = 0;
    setTrailingStopPrice(null);
    setHighestProfit(0);
  }, [symbol]);
  
  // Reset trailing stop when position closes
  useEffect(() => {
    if (!position) {
      setTrailingStopPrice(null);
      setHighestProfit(0);
    }
  }, [position]);
  
  // Trailing stop logic
  useEffect(() => {
    if (!position || !enableTrailing || currentPrice <= 0) return;
    
    const direction = position.type === 'long' ? 1 : -1;
    const currentProfit = (currentPrice - position.entryPrice) * direction;
    
    // Update highest profit and trailing stop
    if (currentProfit > highestProfit) {
      setHighestProfit(currentProfit);
      const steps = Math.floor(currentProfit / trailingStep);
      if (steps >= 1) {
        // Move stop to (steps - 1) * trailingStep above entry
        const newStopPrice = position.entryPrice + ((steps - 1) * trailingStep * direction);
        setTrailingStopPrice(newStopPrice);
      }
    }
    
    // Check if trailing stop hit
    if (trailingStopPrice !== null) {
      const stopHit = position.type === 'long' 
        ? currentPrice <= trailingStopPrice 
        : currentPrice >= trailingStopPrice;
      
      if (stopHit) {
        const pnl = calculatePnL(position, currentPrice);
        onTradeClose?.(pnl);
        toast({
          title: '🎯 트레일링 스탑 청산',
          description: `${symbol} @ $${formatPrice(currentPrice)} | 확정 손익: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
          duration: 3000,
        });
        setPosition(null);
      }
    }
  }, [currentPrice, position, enableTrailing, trailingStep, highestProfit, trailingStopPrice]);

  const calculatePnL = (pos: Position, price: number): number => {
    const direction = pos.type === 'long' ? 1 : -1;
    const priceDiff = (price - pos.entryPrice) * direction;
    const pnl = priceDiff * pos.quantity;
    return pnl;
  };

  const handleQuickOrder = (type: 'long' | 'short', price: number) => {
    const baseQty = parseFloat(orderQty) || 1;
    const actualQty = Math.floor(baseQty * (clickOrderPercent / 100));
    
    // If position exists and opposite direction, create limit close order
    if (position && position.type !== type) {
      // Create pending close order
      const newOrder: PendingOrder = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type,
        price,
        quantity: position.quantity,
        leverage,
        createdAt: Date.now()
      };
      setPendingOrders(prev => [...prev, newOrder]);
      
      toast({
        title: '📋 지정가 청산 주문',
        description: `${symbol} @ $${formatPrice(price)} 대기중`,
        duration: 2000,
      });
      return;
    }
    
    // Create pending order for entry or 추매
    const newOrder: PendingOrder = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      price,
      quantity: actualQty,
      leverage,
      createdAt: Date.now()
    };
    setPendingOrders(prev => [...prev, newOrder]);
    
    toast({
      title: type === 'long' ? '📋 지정가 롱 주문' : '📋 지정가 숏 주문',
      description: `${symbol} ${actualQty}개 @ $${formatPrice(price)} 대기중`,
      duration: 2000,
    });
  };

  const handleMarketOrder = (type: 'long' | 'short') => {
    const qty = parseFloat(orderQty) || 1;
    
    if (position && position.type !== type) {
      handleMarketClose();
      return;
    }
    
    // 추매: 평균단가 계산 및 수량 합산
    if (position && position.type === type) {
      const totalQty = position.quantity + qty;
      const avgPrice = ((position.entryPrice * position.quantity) + (currentPrice * qty)) / totalQty;
      
      setPosition({
        type,
        entryPrice: avgPrice,
        quantity: totalQty,
        leverage
      });
      
      toast({
        title: type === 'long' ? '🟢 시장가 롱 추매' : '🔴 시장가 숏 추매',
        description: `${symbol} +${qty}개 @ $${formatPrice(currentPrice)} → 총 ${totalQty}개 (평단 $${formatPrice(avgPrice)})`,
        duration: 2000,
      });
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

  const handleMarketClose = (percent: number = 100) => {
    if (!position) {
      toast({
        title: '포지션 없음',
        description: '청산할 포지션이 없습니다.',
        duration: 2000,
      });
      return;
    }
    
    const closeQty = position.quantity * (percent / 100);
    const remainingQty = position.quantity - closeQty;
    const pnl = calculatePnL({ ...position, quantity: closeQty }, currentPrice);
    
    onTradeClose?.(pnl);
    
    if (remainingQty > 0.0001) {
      // 부분 청산 - 남은 포지션 유지
      setPosition({
        ...position,
        quantity: remainingQty
      });
      toast({
        title: pnl >= 0 ? '✅ 부분 청산' : '❌ 부분 청산',
        description: `${percent}% 청산 (${closeQty.toFixed(3)}개) | 손익: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | 잔여: ${remainingQty.toFixed(3)}개`,
        duration: 3000,
      });
    } else {
      // 전량 청산
      toast({
        title: pnl >= 0 ? '✅ 청산 완료' : '❌ 청산 완료',
        description: `${symbol} ${position.quantity}개 @ $${formatPrice(currentPrice)} | 손익: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
        duration: 3000,
      });
      setPosition(null);
    }
  };

  const handleCloseAtPrice = (price: number) => {
    if (!position) return;
    
    const pnl = calculatePnL(position, price);
    onTradeClose?.(pnl);
    toast({
      title: pnl >= 0 ? '✅ 지정가 청산' : '❌ 지정가 청산',
      description: `${symbol} ${position.quantity}개 @ $${formatPrice(price)} | 예상손익: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
      duration: 3000,
    });
    setPosition(null);
  };

  const handleCancelAll = () => {
    if (pendingOrders.length === 0) {
      toast({
        title: '취소할 주문 없음',
        description: '대기중인 주문이 없습니다.',
        duration: 2000,
      });
      return;
    }
    setPendingOrders([]);
    toast({
      title: '일괄취소',
      description: `${pendingOrders.length}건의 주문이 취소되었습니다.`,
      duration: 2000,
    });
  };

  const handleQtyPreset = (percent: number) => {
    // Calculate quantity based on: (balanceUSD × leverage × percent) / currentPrice
    const buyingPower = balanceUSD * leverage * (percent / 100);
    const qty = currentPrice > 0 ? buyingPower / currentPrice : 0;
    setOrderQty(qty.toFixed(3));
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

  // Notify parent of PnL changes
  useEffect(() => {
    onPnLChange?.(currentPnL);
  }, [currentPnL, onPnLChange]);

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
          
          {/* Balance Setting in KRW */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">잔고 (₩)</span>
            <input
              type="number"
              value={balanceKRW}
              onChange={(e) => setBalanceKRW(e.target.value)}
              className="w-24 bg-background border border-yellow-600/50 px-1.5 py-0.5 text-[10px] rounded text-center text-yellow-400 font-mono"
              step="10000"
            />
            <span className="text-[10px] text-muted-foreground">
              {rateLoading ? '환율 조회중...' : `₩${usdKrwRate.toLocaleString()}/$ • $${balanceUSD.toFixed(0)} • 구매력: $${(balanceUSD * leverage).toLocaleString()}`}
            </span>
          </div>
          
          {/* Recommended TP/SL based on leverage */}
          {(() => {
            const bal = balanceUSD;
            const liquidationPct = 100 / leverage;
            const safeSLPct = liquidationPct * 0.4;
            const recommendedSL = Math.round(bal * (safeSLPct / 100));
            const recommendedTP = Math.round(recommendedSL * 1.5);
            
            return (
              <div className="bg-yellow-900/20 border border-yellow-600/30 rounded p-2 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-yellow-400/80">⚠️ {leverage}배 레버리지 추천 손익절</span>
                  <span className="text-[8px] text-muted-foreground">(청산: {liquidationPct.toFixed(1)}%)</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-green-400">익절:</span>
                    <button
                      onClick={() => setTpAmount(recommendedTP.toString())}
                      className="text-[10px] text-green-400 font-mono bg-green-900/30 px-1.5 py-0.5 rounded hover:bg-green-900/50 transition-colors"
                    >
                      ${recommendedTP}
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-red-400">손절:</span>
                    <button
                      onClick={() => setSlAmount(recommendedSL.toString())}
                      className="text-[10px] text-red-400 font-mono bg-red-900/30 px-1.5 py-0.5 rounded hover:bg-red-900/50 transition-colors"
                    >
                      ${recommendedSL}
                    </button>
                  </div>
                </div>
                <p className="text-[8px] text-muted-foreground">
                  클릭하면 자동 설정 • R:R 1.5:1 • 청산의 40% 거리
                </p>
              </div>
            );
          })()}
          
          <p className="text-[9px] text-muted-foreground">
            {enableTpSl 
              ? `손익이 +$${tpAmount} 또는 -$${slAmount}에 도달하면 자동 청산`
              : '자동청산 비활성화됨'}
          </p>
          
          {/* Trailing Stop Settings */}
          <div className="flex items-center gap-2 pt-1 border-t border-border/50">
            <button
              onClick={() => setEnableTrailing(!enableTrailing)}
              className={cn(
                "px-2 py-0.5 text-[10px] rounded border transition-colors",
                enableTrailing 
                  ? "bg-orange-600 text-white border-orange-600" 
                  : "bg-background border-border text-muted-foreground"
              )}
            >
              트레일링
            </button>
            <span className="text-[10px] text-orange-400">스텝</span>
            <div className="flex gap-1">
              {[0.5, 1.0, 1.5, 2.0].map((step) => (
                <button
                  key={step}
                  onClick={() => setTrailingStep(step)}
                  disabled={!enableTrailing}
                  className={cn(
                    "px-1.5 py-0.5 text-[10px] rounded border transition-colors",
                    trailingStep === step && enableTrailing
                      ? "bg-orange-500 text-white border-orange-500" 
                      : "bg-background border-border hover:bg-secondary",
                    !enableTrailing && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {step}pt
                </button>
              ))}
            </div>
          </div>
          {enableTrailing && (
            <p className="text-[9px] text-orange-400/80">
              ⚡ +{trailingStep}pt 수익마다 손절선 자동 상향 (본전 보장 후 이익 추적)
            </p>
          )}
          {position && trailingStopPrice !== null && (
            <div className="bg-orange-900/30 border border-orange-600/50 rounded px-2 py-1">
              <span className="text-[10px] text-orange-400">
                🎯 현재 트레일링 손절선: <span className="font-mono font-bold">${formatPrice(trailingStopPrice)}</span>
                <span className="text-muted-foreground ml-2">
                  (최고수익: +{highestProfit.toFixed(2)}pt)
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Quantity & Leverage Row */}
      <div className="px-2 py-1.5 border-b border-border bg-secondary/30 flex items-center gap-1.5">
        <select 
          value={leverage} 
          onChange={(e) => setLeverage(Number(e.target.value))}
          className="bg-background border border-border px-1 py-0.5 text-[10px] rounded"
        >
          {[1, 2, 3, 5, 10, 20, 50, 75, 100, 125].map(l => (
            <option key={l} value={l}>{l}x</option>
          ))}
        </select>
        <button 
          onClick={() => adjustQty(-1)} 
          className="w-5 h-5 bg-secondary border border-border rounded flex items-center justify-center hover:bg-secondary/80"
        >
          <Minus className="w-3 h-3" />
        </button>
        <input
          type="text"
          value={orderQty}
          onChange={(e) => setOrderQty(e.target.value)}
          className="w-14 bg-background border border-border px-1 py-0.5 text-center font-mono text-[10px] rounded"
        />
        <button 
          onClick={() => adjustQty(1)} 
          className="w-5 h-5 bg-secondary border border-border rounded flex items-center justify-center hover:bg-secondary/80"
        >
          <Plus className="w-3 h-3" />
        </button>
        <div className="flex-1" />
        {[100, 50, 25, 10].map((p) => (
          <button 
            key={p} 
            onClick={() => handleQtyPreset(p)} 
            className="px-1.5 py-0.5 bg-secondary border border-border text-[9px] rounded hover:bg-secondary/80"
          >
            {p}%
          </button>
        ))}
      </div>

      {/* Market Order Buttons */}
      <div className="grid grid-cols-4 border-b border-border">
        <button 
          onClick={handleCancelAll}
          className={cn(
            "py-1.5 text-[10px] border-r border-border font-medium relative",
            pendingOrders.length > 0 
              ? "bg-orange-900/50 hover:bg-orange-900/70 text-orange-400" 
              : "bg-secondary hover:bg-secondary/80"
          )}
        >
          일괄취소
          {pendingOrders.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[8px] rounded-full w-4 h-4 flex items-center justify-center">
              {pendingOrders.length}
            </span>
          )}
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
          onClick={() => handleMarketClose()}
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
        <button 
          onClick={() => setShowSettings(!showSettings)}
          className={cn(
            "px-1 py-1 text-center border-r border-border/50 hover:bg-background/50 transition-colors",
            showSettings && "bg-background/50"
          )}
        >
          <Settings className="w-3 h-3 text-muted-foreground mx-auto" />
        </button>
        <div className="px-1 py-1 text-center border-r border-border/50 text-blue-400">매도잔량</div>
        <div className="px-1 py-1 text-center border-r border-border/50 text-muted-foreground">호가</div>
        <div className="px-1 py-1 text-center border-r border-border/50 text-red-400">매수잔량</div>
        <div className="px-1 py-1 text-center text-red-400">B</div>
      </div>
      
      {/* Bullish Probability Display (Top Right) */}
      {techSignal && (
        <div className="grid grid-cols-[32px_1fr_70px_1fr_32px] text-[10px] border-b border-border/50 bg-red-950/30">
          <div className="px-1 py-1 border-r border-border/30" />
          <div className="px-1 py-1 border-r border-border/30" />
          <div className="px-1 py-1 text-center border-r border-border/30 text-muted-foreground text-[9px]">
            RSI {techSignal.rsi}
          </div>
          <div className="px-1 py-1.5 border-r border-border/30 flex items-center justify-center gap-1">
            <TrendingUp className="w-3 h-3 text-red-400" />
            <span className={cn(
              "font-bold font-mono",
              techSignal.bullishProb > 55 ? "text-red-400" : "text-muted-foreground"
            )}>
              {techSignal.bullishProb}%
            </span>
            <span className="text-[8px] text-red-400/70">상승</span>
          </div>
          <div className="px-1 py-1" />
        </div>
      )}

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
              <div className="px-1 py-0.5 text-center border-r border-border/30 font-mono font-medium text-blue-400 bg-blue-950/20">
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

      {/* Current Price Bar / Position Info */}
      {position ? (
        <div className={cn(
          "border-y-2 px-2 py-1.5",
          position.type === 'long' ? "bg-red-950/50 border-red-500" : "bg-blue-950/50 border-blue-500"
        )}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-[10px] font-bold px-1.5 py-0.5 rounded",
                position.type === 'long' ? "bg-red-500 text-white" : "bg-blue-500 text-white"
              )}>
                {position.type === 'long' ? 'LONG' : 'SHORT'}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {position.quantity}개 @{formatPrice(position.entryPrice)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-sm font-bold font-mono",
                currentPnL >= 0 ? "text-red-400" : "text-blue-400"
              )}>
                {currentPnL >= 0 ? '+' : ''}{currentPnL.toFixed(2)}$ ({currentPnLPercent >= 0 ? '+' : ''}{currentPnLPercent.toFixed(2)}%)
              </span>
              <div className="flex items-center gap-1">
                {[25, 50, 75].map(p => (
                  <button
                    key={p}
                    onClick={() => handleMarketClose(p)}
                    className="px-1 py-0.5 bg-yellow-900/50 hover:bg-yellow-800/70 text-yellow-400 text-[9px] rounded"
                  >
                    {p}%
                  </button>
                ))}
                <button
                  onClick={() => handleMarketClose()}
                  className="px-2 py-0.5 bg-yellow-500 hover:bg-yellow-400 text-yellow-950 text-[10px] font-bold rounded"
                >
                  전량
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
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
      )}

      {/* Bearish Probability Display (Bottom Left) */}
      {techSignal && (
        <div className="grid grid-cols-[32px_1fr_70px_1fr_32px] text-[10px] border-b border-border/50 bg-blue-950/30">
          <div className="px-1 py-1 border-r border-border/30" />
          <div className="px-1 py-1.5 border-r border-border/30 flex items-center justify-center gap-1">
            <TrendingDown className="w-3 h-3 text-blue-400" />
            <span className={cn(
              "font-bold font-mono",
              techSignal.bearishProb > 55 ? "text-blue-400" : "text-muted-foreground"
            )}>
              {techSignal.bearishProb}%
            </span>
            <span className="text-[8px] text-blue-400/70">하락</span>
          </div>
          <div className="px-1 py-1 text-center border-r border-border/30 text-muted-foreground text-[9px]">
            {techSignal.macdSignal === 'bullish' ? '▲' : techSignal.macdSignal === 'bearish' ? '▼' : '—'} MACD
          </div>
          <div className="px-1 py-1 border-r border-border/30" />
          <div className="px-1 py-1" />
        </div>
      )}
      
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
              <div className="px-1 py-0.5 text-center border-r border-border/30 font-mono font-medium text-red-400 bg-red-950/20">
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
            onClick={() => handleMarketClose()}
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

    </div>
  );
};

export default OrderPanel8282;
