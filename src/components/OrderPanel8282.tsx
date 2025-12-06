import { useState, useEffect, useMemo, useRef } from 'react';
import { fetchOrderBook, fetch24hTicker, OrderBook, formatPrice, formatQuantity, calculateTechnicalSignal, TechnicalSignal } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { Minus, Plus, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useBinanceApi } from '@/hooks/useBinanceApi';

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

interface TradeCloseData {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  leverage: number;
  pnl: number;
}

interface OpenOrderData {
  orderId: number;
  price: number;
  side: 'BUY' | 'SELL';
  origQty: number;
}

interface TpSlPrices {
  tpPrice: number | null;
  slPrice: number | null;
}

interface OrderPanel8282Props {
  symbol: string;
  onPositionChange?: (position: Position | null) => void;
  onPnLChange?: (pnl: number) => void;
  onOpenOrdersChange?: (orders: OpenOrderData[]) => void;
  onTradeClose?: (trade: TradeCloseData) => void;
  onTpSlChange?: (tpsl: TpSlPrices) => void;
}

const OrderPanel8282 = ({ symbol, onPositionChange, onPnLChange, onOpenOrdersChange, onTradeClose, onTpSlChange }: OrderPanel8282Props) => {
  const { toast } = useToast();
  const { 
    getBalances, 
    getPositions,
    getOpenOrders,
    placeMarketOrder: apiPlaceMarketOrder, 
    placeLimitOrder: apiPlaceLimitOrder,
    cancelAllOrders: apiCancelAllOrders,
    setLeverage: apiSetLeverage,
    loading: apiLoading 
  } = useBinanceApi();
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [prevPrice, setPrevPrice] = useState<number>(0);
  const [priceChangePercent, setPriceChangePercent] = useState<number>(0);
  const [orderQty, setOrderQty] = useState<string>('100');
  const [leverage, setLeverage] = useState<number>(10);
  const [loading, setLoading] = useState(true);
  const [clickOrderPercent, setClickOrderPercent] = useState<number>(100);
  const [autoTpSlInitialized, setAutoTpSlInitialized] = useState<boolean>(false);
  
  
  // Position state
  const [position, setPosition] = useState<Position | null>(null);
  
  // Pending orders state (local simulation)
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  
  // Real open orders count from Binance
  const [openOrdersCount, setOpenOrdersCount] = useState<number>(0);
  
  // Notify parent when position changes
  useEffect(() => {
    onPositionChange?.(position);
  }, [position, onPositionChange]);
  
  // TP/SL settings (USDT amount)
  const [tpAmount, setTpAmount] = useState<string>('50');
  const [slAmount, setSlAmount] = useState<string>('30');
  const [enableTpSl, setEnableTpSl] = useState<boolean>(true);
  
  // Calculate and notify TP/SL price levels
  useEffect(() => {
    if (!position || !enableTpSl) {
      onTpSlChange?.({ tpPrice: null, slPrice: null });
      return;
    }
    
    const tp = parseFloat(tpAmount) || 0;
    const sl = parseFloat(slAmount) || 0;
    
    // Calculate price levels from USDT amounts
    // PnL = (exitPrice - entryPrice) * quantity * direction
    // So: priceChange = pnlAmount / quantity
    const direction = position.type === 'long' ? 1 : -1;
    
    let tpPrice: number | null = null;
    let slPrice: number | null = null;
    
    if (tp > 0 && position.quantity > 0) {
      const priceChange = tp / position.quantity;
      tpPrice = position.entryPrice + (priceChange * direction);
    }
    
    if (sl > 0 && position.quantity > 0) {
      const priceChange = sl / position.quantity;
      slPrice = position.entryPrice - (priceChange * direction);
    }
    
    onTpSlChange?.({ tpPrice, slPrice });
  }, [position, tpAmount, slAmount, enableTpSl, onTpSlChange]);
  
  // Balance for order calculation (in USD from Binance)
  
  // Balance for order calculation (in USD from Binance)
  const [balanceUSD, setBalanceUSD] = useState<number>(0);
  const [usdKrwRate, setUsdKrwRate] = useState<number>(1380);
  const [rateLoading, setRateLoading] = useState<boolean>(false);
  const [balanceLoading, setBalanceLoading] = useState<boolean>(false);
  const balanceKRW = Math.round(balanceUSD * usdKrwRate);
  
  // Fetch real balance from Binance
  const fetchRealBalance = async () => {
    setBalanceLoading(true);
    try {
      const balances = await getBalances();
      // Find USDT balance
      const usdtBalance = balances?.find((b: any) => b.asset === 'USDT');
      if (usdtBalance) {
        const available = parseFloat(usdtBalance.availableBalance) || 0;
        setBalanceUSD(available);
      }
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    } finally {
      setBalanceLoading(false);
    }
  };
  
  // Fetch balance, position, and open orders on mount and every 10 seconds
  const fetchBalanceAndPosition = async () => {
    setBalanceLoading(true);
    try {
      // Fetch balance
      const balances = await getBalances();
      const usdtBalance = balances?.find((b: any) => b.asset === 'USDT');
      if (usdtBalance) {
        const available = parseFloat(usdtBalance.availableBalance) || 0;
        setBalanceUSD(available);
      }
      
      // Fetch real position for this symbol
      const positions = await getPositions(symbol);
      const symbolPosition = positions?.find((p: any) => p.symbol === symbol);
      if (symbolPosition) {
        const positionAmt = parseFloat(symbolPosition.positionAmt);
        if (Math.abs(positionAmt) > 0.00001) {
          setPosition({
            type: positionAmt > 0 ? 'long' : 'short',
            entryPrice: parseFloat(symbolPosition.entryPrice),
            quantity: Math.abs(positionAmt),
            leverage: parseInt(symbolPosition.leverage) || 10
          });
          setLeverage(parseInt(symbolPosition.leverage) || 10);
        } else {
          setPosition(null);
        }
      }
      
      // Fetch open orders for this symbol
      try {
        const openOrders = await getOpenOrders(symbol);
        const ordersArray = Array.isArray(openOrders) ? openOrders : [];
        setOpenOrdersCount(ordersArray.length);
        
        // Notify parent about open orders
        if (onOpenOrdersChange) {
          const orderData = ordersArray.map((o: any) => ({
            orderId: o.orderId,
            price: parseFloat(o.price),
            side: o.side as 'BUY' | 'SELL',
            origQty: parseFloat(o.origQty)
          }));
          onOpenOrdersChange(orderData);
        }
      } catch (e) {
        console.error('Failed to fetch open orders:', e);
      }
    } catch (error) {
      console.error('Failed to fetch balance/position:', error);
    } finally {
      setBalanceLoading(false);
    }
  };
  
  useEffect(() => {
    fetchBalanceAndPosition();
    // 심볼 변경 시 레버리지 강제 설정
    const setInitialLeverage = async () => {
      try {
        await apiSetLeverage(symbol, leverage);
        console.log(`Leverage set to ${leverage}x for ${symbol}`);
      } catch (error: any) {
        // -4046 = no need to change leverage (already set)
        if (!error.message?.includes('-4046')) {
          console.error('Failed to set initial leverage:', error);
        }
      }
    };
    setInitialLeverage();
    
    const interval = setInterval(fetchBalanceAndPosition, 10000);
    return () => clearInterval(interval);
  }, [symbol]);
  
  // Auto-set 100% quantity and recommended TP/SL when balance loads
  useEffect(() => {
    if (balanceUSD > 0 && currentPrice > 0 && !autoTpSlInitialized) {
      // 최소 주문으로 테스트 - $5.5 notional만 사용
      const minQty = 5.5 / currentPrice;
      // 또는 잔고의 15%만 사용
      const buyingPower = balanceUSD * leverage;
      const safeQty = (buyingPower * 0.15) / currentPrice;
      setOrderQty(Math.max(minQty, safeQty).toFixed(0));
      
      // Set recommended TP/SL based on leverage
      // 청산가격까지의 거리 = 100% / 레버리지
      // 안전 손절 = 청산거리의 40%
      const liquidationPct = 100 / leverage;
      const safeSLPct = liquidationPct * 0.4;
      // 소수점 2자리까지, 최소 $0.10
      const rawSL = balanceUSD * (safeSLPct / 100);
      const recommendedSL = Math.max(0.10, parseFloat(rawSL.toFixed(2)));
      const recommendedTP = parseFloat((recommendedSL * 1.5).toFixed(2));
      setTpAmount(recommendedTP.toString());
      setSlAmount(recommendedSL.toString());
      
      setAutoTpSlInitialized(true);
    }
  }, [balanceUSD, currentPrice, leverage, autoTpSlInitialized]);
  
  // Recalculate quantity when leverage changes
  useEffect(() => {
    if (balanceUSD > 0 && currentPrice > 0 && autoTpSlInitialized) {
      const minQty = 5.5 / currentPrice;
      const buyingPower = balanceUSD * leverage;
      const safeQty = (buyingPower * 0.15) / currentPrice;
      setOrderQty(Math.max(minQty, safeQty).toFixed(0));
    }
  }, [leverage]);
  
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
  
  // Ref to prevent duplicate TP/SL execution
  const tpSlProcessing = useRef<boolean>(false);
  
  // Ref to prevent duplicate close operations
  const closingInProgress = useRef<boolean>(false);

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
                onTradeClose?.({
                  symbol,
                  side: position.type,
                  entryPrice: position.entryPrice,
                  exitPrice: order.price,
                  quantity: position.quantity,
                  leverage: position.leverage,
                  pnl,
                });
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
        
        // Check TP/SL auto close (use refs to prevent multiple executions)
        if (position && enableTpSl && ticker.price > 0 && !tpSlProcessing.current && !closingInProgress.current) {
          const pnl = calculatePnL(position, ticker.price);
          const tp = parseFloat(tpAmount) || 0;
          const sl = parseFloat(slAmount) || 0;
          
          if (tp > 0 && pnl >= tp) {
            tpSlProcessing.current = true;
            // Execute TP close via API
            const executeTpClose = async () => {
              try {
                const side = position.type === 'long' ? 'SELL' : 'BUY';
                await apiPlaceMarketOrder(symbol, side, position.quantity, true);
                toast({
                  title: '✅ 익절 청산',
                  description: `목표 수익 $${tp} 달성! 실현손익: $${pnl.toFixed(2)}`,
                  duration: 3000,
                });
                onTradeClose?.({
                  symbol,
                  side: position.type,
                  entryPrice: position.entryPrice,
                  exitPrice: ticker.price,
                  quantity: position.quantity,
                  leverage: position.leverage,
                  pnl,
                });
                setTimeout(fetchBalanceAndPosition, 1000);
              } catch (error: any) {
                toast({
                  title: '익절 청산 실패',
                  description: error.message || '청산을 처리할 수 없습니다.',
                  variant: 'destructive',
                  duration: 3000,
                });
              } finally {
                tpSlProcessing.current = false;
              }
            };
            executeTpClose();
          } else if (sl > 0 && pnl <= -sl) {
            tpSlProcessing.current = true;
            // Execute SL close via API
            const executeSlClose = async () => {
              try {
                const side = position.type === 'long' ? 'SELL' : 'BUY';
                await apiPlaceMarketOrder(symbol, side, position.quantity, true);
                toast({
                  title: '🛑 손절 청산',
                  description: `손절선 -$${sl} 도달! 실현손익: $${pnl.toFixed(2)}`,
                  duration: 3000,
                });
                onTradeClose?.({
                  symbol,
                  side: position.type,
                  entryPrice: position.entryPrice,
                  exitPrice: ticker.price,
                  quantity: position.quantity,
                  leverage: position.leverage,
                  pnl,
                });
                setTimeout(fetchBalanceAndPosition, 1000);
              } catch (error: any) {
                toast({
                  title: '손절 청산 실패',
                  description: error.message || '청산을 처리할 수 없습니다.',
                  variant: 'destructive',
                  duration: 3000,
                });
              } finally {
                tpSlProcessing.current = false;
              }
            };
            executeSlClose();
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
  }, [symbol]);
  const calculatePnL = (pos: Position, price: number): number => {
    const direction = pos.type === 'long' ? 1 : -1;
    const priceDiff = (price - pos.entryPrice) * direction;
    const pnl = priceDiff * pos.quantity;
    return pnl;
  };

  // 호가 더블클릭 시 수량만 자동 계산 (주문 X) - 100% 버튼과 동일한 계산
  const handlePriceClick = (price: number) => {
    if (balanceUSD <= 0 || price <= 0) {
      toast({
        title: '계산 불가',
        description: '잔고 또는 가격 정보가 없습니다.',
        variant: 'destructive',
        duration: 2000,
      });
      return;
    }
    
    // 100% 버튼과 동일: (balanceUSD × 0.70 × leverage × clickOrderPercent%) / price
    const safeBalance = balanceUSD * 0.70;
    const buyingPower = safeBalance * leverage * (clickOrderPercent / 100);
    const qty = buyingPower / price;
    
    // Ensure minimum notional of $5.5
    const minQty = 5.5 / price;
    const finalQty = Math.max(qty, minQty);
    
    setOrderQty(finalQty.toFixed(3));
    
    toast({
      title: '📊 수량 자동 계산',
      description: `${leverage}x 레버리지, ${clickOrderPercent}% → ${finalQty.toFixed(3)}개`,
      duration: 2000,
    });
  };

  const handleQuickOrder = async (type: 'long' | 'short', price: number) => {
    if (balanceUSD <= 0) {
      toast({
        title: '잔고 부족',
        description: '거래 가능한 잔고가 없습니다.',
        variant: 'destructive',
        duration: 2000,
      });
      return;
    }
    
    try {
      const side = type === 'long' ? 'BUY' : 'SELL';
      const reduceOnly = position && position.type !== type;
      
      let qty: number;
      if (reduceOnly) {
        // Close position - use position quantity
        qty = position!.quantity;
      } else {
        // Use current orderQty value
        qty = parseFloat(orderQty) || 0.001;
      }
      
      await apiPlaceLimitOrder(symbol, side, qty, price, reduceOnly);
      
      toast({
        title: type === 'long' ? '📋 지정가 롱 주문' : '📋 지정가 숏 주문',
        description: `${symbol} ${qty.toFixed(3)}개 @ $${formatPrice(price)}`,
        duration: 2000,
      });
      
      // Refresh position after order
      setTimeout(fetchBalanceAndPosition, 1000);
    } catch (error: any) {
      toast({
        title: '주문 실패',
        description: error.message || '주문을 처리할 수 없습니다.',
        variant: 'destructive',
        duration: 3000,
      });
    }
  };

  const handleMarketOrder = async (type: 'long' | 'short') => {
    const qty = parseFloat(orderQty) || 0.001;
    
    if (balanceUSD <= 0) {
      toast({
        title: '잔고 부족',
        description: '거래 가능한 잔고가 없습니다.',
        variant: 'destructive',
        duration: 2000,
      });
      return;
    }
    
    // If opposite position exists, close it
    if (position && position.type !== type) {
      await handleMarketClose();
      return;
    }
    
    try {
      const side = type === 'long' ? 'BUY' : 'SELL';
      await apiPlaceMarketOrder(symbol, side, qty, false);
      
      toast({
        title: type === 'long' ? '🟢 시장가 롱' : '🔴 시장가 숏',
        description: `${symbol} ${qty}개 @ 시장가 (${leverage}x)`,
        duration: 2000,
      });
      
      // Refresh position after order
      setTimeout(fetchBalanceAndPosition, 1000);
    } catch (error: any) {
      toast({
        title: '주문 실패',
        description: error.message || '주문을 처리할 수 없습니다.',
        variant: 'destructive',
        duration: 3000,
      });
    }
  };

  const handleMarketClose = async (percent: number = 100) => {
    if (!position) {
      toast({
        title: '포지션 없음',
        description: '청산할 포지션이 없습니다.',
        duration: 2000,
      });
      return;
    }
    
    // Prevent duplicate close operations
    if (closingInProgress.current) {
      console.log('Close already in progress, skipping...');
      return;
    }
    
    closingInProgress.current = true;
    const closeQty = position.quantity * (percent / 100);
    
    try {
      // Close position with opposite side order
      const side = position.type === 'long' ? 'SELL' : 'BUY';
      await apiPlaceMarketOrder(symbol, side, closeQty, true);
      
      const pnl = calculatePnL({ ...position, quantity: closeQty }, currentPrice);
      onTradeClose?.({
        symbol,
        side: position.type,
        entryPrice: position.entryPrice,
        exitPrice: currentPrice,
        quantity: closeQty,
        leverage: position.leverage,
        pnl,
      });
      
      toast({
        title: pnl >= 0 ? '✅ 청산 완료' : '❌ 청산 완료',
        description: `${symbol} ${closeQty.toFixed(3)}개 | 손익: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
        duration: 3000,
      });
      
      // Refresh position after close
      setTimeout(fetchBalanceAndPosition, 1000);
    } catch (error: any) {
      toast({
        title: '청산 실패',
        description: error.message || '청산을 처리할 수 없습니다.',
        variant: 'destructive',
        duration: 3000,
      });
    } finally {
      // Reset lock after a short delay to allow position state to update
      setTimeout(() => {
        closingInProgress.current = false;
      }, 2000);
    }
  };

  const handleCloseAtPrice = async (price: number) => {
    if (!position) return;
    
    try {
      const side = position.type === 'long' ? 'SELL' : 'BUY';
      await apiPlaceLimitOrder(symbol, side, position.quantity, price, true);
      
      const pnl = calculatePnL(position, price);
      
      toast({
        title: '📋 지정가 청산 주문',
        description: `${symbol} ${position.quantity.toFixed(3)}개 @ $${formatPrice(price)} | 예상손익: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
        duration: 3000,
      });
    } catch (error: any) {
      toast({
        title: '주문 실패',
        description: error.message || '주문을 처리할 수 없습니다.',
        variant: 'destructive',
        duration: 3000,
      });
    }
  };

  const handleCancelAll = async () => {
    try {
      await apiCancelAllOrders(symbol);
      setPendingOrders([]);
      toast({
        title: '일괄취소 완료',
        description: `${symbol} 모든 주문이 취소되었습니다.`,
        duration: 2000,
      });
    } catch (error: any) {
      toast({
        title: '취소 실패',
        description: error.message || '주문 취소를 처리할 수 없습니다.',
        variant: 'destructive',
        duration: 3000,
      });
    }
  };

  const handleQtyPreset = (percent: number) => {
    // Calculate quantity based on: (balanceUSD × 0.70 × leverage × percent) / currentPrice
    // 70%만 사용하여 수수료, 펀딩비, 마진 여유 확보
    const safeBalance = balanceUSD * 0.70;
    const buyingPower = safeBalance * leverage * (percent / 100);
    const qty = currentPrice > 0 ? buyingPower / currentPrice : 0;
    // Ensure minimum notional of $5
    const minQty = 5.5 / currentPrice;
    setOrderQty(Math.max(qty, minQty).toFixed(3));
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

      {/* Row 1: Leverage + TP/SL + Auto Toggle */}
      <div className="px-2 py-1.5 border-b border-border bg-secondary/30 flex items-center gap-2">
        <select 
          value={leverage} 
          onChange={async (e) => {
            const newLeverage = Number(e.target.value);
            setLeverage(newLeverage);
            try {
              await apiSetLeverage(symbol, newLeverage);
              toast({
                title: '레버리지 변경',
                description: `${symbol} 레버리지가 ${newLeverage}x로 설정되었습니다.`,
                duration: 2000,
              });
            } catch (error: any) {
              console.error('Failed to set leverage:', error);
              if (!error.message?.includes('-4046')) {
                toast({
                  title: '레버리지 설정 실패',
                  description: error.message || '레버리지 설정 중 오류가 발생했습니다.',
                  variant: 'destructive',
                  duration: 3000,
                });
              }
            }
          }}
          className="bg-background border border-border px-1.5 py-0.5 text-[10px] rounded font-bold"
        >
          {[1, 2, 3, 5, 10, 20, 50, 75, 100, 125].map(l => (
            <option key={l} value={l}>{l}x</option>
          ))}
        </select>
        
        <div className="border-l border-border/50 h-4" />
        
        <button
          onClick={() => setEnableTpSl(!enableTpSl)}
          className={cn(
            "px-1.5 py-0.5 text-[9px] rounded border transition-colors whitespace-nowrap",
            enableTpSl 
              ? "bg-green-600 text-white border-green-600" 
              : "bg-background border-border text-muted-foreground"
          )}
        >
          자동청산
        </button>
        <div className="flex items-center gap-0.5">
          <span className="text-[9px] text-green-400">익절+$</span>
          <input
            type="number"
            value={tpAmount}
            onChange={(e) => setTpAmount(e.target.value)}
            className="w-12 bg-background border border-green-600/50 px-1 py-0.5 text-[9px] rounded text-center text-green-400"
            disabled={!enableTpSl}
          />
        </div>
        <div className="flex items-center gap-0.5">
          <span className="text-[9px] text-red-400">손절-$</span>
          <input
            type="number"
            value={slAmount}
            onChange={(e) => setSlAmount(e.target.value)}
            className="w-12 bg-background border border-red-600/50 px-1 py-0.5 text-[9px] rounded text-center text-red-400"
            disabled={!enableTpSl}
          />
        </div>
        
        <div className="flex-1" />
        
        {/* 디버그: 마진 정보 */}
        <span className="text-[9px] text-muted-foreground">
          잔고 <span className="text-yellow-400 font-mono">${balanceUSD.toFixed(2)}</span>
          {currentPrice > 0 && (
            <>
              {' | '}필요마진 <span className="text-orange-400 font-mono">
                ${((parseFloat(orderQty) || 0) * currentPrice / leverage).toFixed(2)}
              </span>
            </>
          )}
        </span>
      </div>
      
      {/* Row 2: Quantity Controls */}
      <div className="px-2 py-1.5 border-b border-border bg-secondary/30 flex items-center gap-1.5">
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
          className="w-16 bg-background border border-border px-1 py-0.5 text-center font-mono text-[10px] rounded"
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
            className="px-2 py-0.5 bg-secondary border border-border text-[9px] rounded hover:bg-secondary/80"
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
            openOrdersCount > 0 
              ? "bg-orange-900/50 hover:bg-orange-900/70 text-orange-400" 
              : "bg-secondary hover:bg-secondary/80"
          )}
        >
          {openOrdersCount > 0 ? `미체결 (${openOrdersCount})` : '일괄취소'}
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
        <div className="px-1 py-1 text-center border-r border-border/50 text-blue-400">S</div>
        <div className="px-1 py-1 text-center border-r border-border/50 text-blue-400">매도잔량</div>
        <div className="px-1 py-1 text-center border-r border-border/50 text-muted-foreground">호가</div>
        <div className="px-1 py-1 text-center border-r border-border/50 text-red-400">매수잔량</div>
        <div className="px-1 py-1 text-center text-red-400">B</div>
      </div>
      
      {/* Bullish Probability Display */}
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
              
              {/* 호가 - 더블클릭 시 수량 자동 계산 */}
              <div 
                onDoubleClick={() => handlePriceClick(ask.price)}
                className="px-1 py-0.5 text-center border-r border-border/30 font-mono font-medium text-blue-400 bg-blue-950/20 cursor-pointer hover:bg-blue-900/30"
                title="더블클릭: 수량 자동 계산"
              >
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

      {/* Bearish Probability Display */}
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

              {/* 호가 - 더블클릭 시 수량 자동 계산 */}
              <div 
                onDoubleClick={() => handlePriceClick(bid.price)}
                className="px-1 py-0.5 text-center border-r border-border/30 font-mono font-medium text-red-400 bg-red-950/20 cursor-pointer hover:bg-red-900/30"
                title="더블클릭: 수량 자동 계산"
              >
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


    </div>
  );
};

export default OrderPanel8282;
