// OrderBook v3.1 - Combined Stream with Real Binance Trade Velocity + AI Direction - Updated 2025-12-24
import { useState, useEffect, useRef, useCallback } from 'react';
import { formatPrice } from '@/lib/binance';

import { RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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

// AI 분석 결과 인터페이스
interface AIAnalysis {
  marketCondition: 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'VOLATILE' | 'QUIET';
  confidence: number;
  recommendation: 'AGGRESSIVE' | 'NORMAL' | 'CONSERVATIVE' | 'STOP';
}

interface OrderBookProps {
  symbol: string;
  splitCount?: 1 | 5 | 10;
  onPlaceOrder?: (side: 'long' | 'short', price: number) => void;
  onMarketEntry?: (side: 'long' | 'short') => void;
  onMarketClose?: () => void;
  onCancelOrder?: (orderId: number) => Promise<void>;
  onCancelAllOrders?: () => Promise<void>;
  onAnalyzeAI?: () => void; // AI 분석 버튼 클릭 콜백
  openOrders?: OpenOrder[];
  hasPosition?: boolean;
  aiAnalysis?: AIAnalysis | null;
  aiEnabled?: boolean;
  isAiAnalyzing?: boolean;
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

// 체결 속도 측정용 인터페이스
interface VelocityData {
  level: 0 | 1 | 2 | 3 | 4; // 0: 정체, 1-4: 속도 레벨
  changesPerSecond: number;
}

// Combined stream URL for better performance (single connection for multiple streams)
const WS_URL = 'wss://fstream.binance.com/stream';

export function OrderBook({ 
  symbol, 
  splitCount = 5,
  onPlaceOrder,
  onMarketEntry,
  onMarketClose,
  onCancelOrder,
  onCancelAllOrders,
  onAnalyzeAI,
  openOrders = [],
  hasPosition = false,
  aiAnalysis = null,
  aiEnabled = false,
  isAiAnalyzing = false,
}: OrderBookProps) {
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [pendingOrder, setPendingOrder] = useState<{ side: 'long' | 'short'; price: number } | null>(null);
  const [velocity, setVelocity] = useState<VelocityData>({ level: 0, changesPerSecond: 0 });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);
  const tradeTimestampsRef = useRef<number[]>([]); // 실제 체결 타임스탬프
  const velocityUpdateRef = useRef<number>(0); // velocity 업데이트 쓰로틀링용

  // 수동 재연결
  const handleManualReconnect = useCallback(() => {
    if (isReconnecting) return;
    setIsReconnecting(true);
    shouldReconnectRef.current = true;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    setIsConnected(false);

    // 약간의 딜레이 후 재연결
    setTimeout(() => {
      setIsReconnecting(false);
    }, 500);
  }, [isReconnecting]);

  const processDepthData = useCallback((data: any) => {
    const bidsRaw = data?.b ?? data?.bids;
    const asksRaw = data?.a ?? data?.asks;

    if (!Array.isArray(bidsRaw) || !Array.isArray(asksRaw)) return;

    // Parse bids (buy orders) - sorted high to low
    const bids: OrderBookEntry[] = bidsRaw
      .slice(0, 10)
      .map((b: [string, string]) => ({
        price: parseFloat(b[0]),
        quantity: parseFloat(b[1]),
      }));

    // Parse asks (sell orders) - sorted low to high, then reverse for display
    const asksAscending: OrderBookEntry[] = asksRaw
      .slice(0, 10)
      .map((a: [string, string]) => ({
        price: parseFloat(a[0]),
        quantity: parseFloat(a[1]),
      }));

    const asks = [...asksAscending].reverse(); // Reverse to show highest ask at top, lowest at bottom (near spread)

    // Calculate spread
    const bestBid = bids[0]?.price || 0;
    const bestAsk = asksAscending[0]?.price || 0;
    const spread = bestAsk - bestBid;
    const spreadPercent = bestBid > 0 ? (spread / bestBid) * 100 : 0;

    setOrderBook({ bids, asks, spread, spreadPercent });
  }, []);

  // 체결 데이터 처리 (aggTrade)
  const processTradeData = useCallback(() => {
    const now = Date.now();
    tradeTimestampsRef.current.push(now);
    
    // 최근 1초 내 체결만 유지
    tradeTimestampsRef.current = tradeTimestampsRef.current.filter(t => now - t < 1000);
    const tradesPerSecond = tradeTimestampsRef.current.length;

    // 200ms마다만 velocity 상태 업데이트 (성능 최적화)
    if (now - velocityUpdateRef.current > 200) {
      velocityUpdateRef.current = now;
      
      // 속도 레벨 계산 (실제 체결 기준)
      let level: 0 | 1 | 2 | 3 | 4 = 0;
      if (tradesPerSecond >= 50) level = 4;      // 초당 50건 이상: 매우 활발
      else if (tradesPerSecond >= 30) level = 3; // 초당 30건 이상: 활발
      else if (tradesPerSecond >= 15) level = 2; // 초당 15건 이상: 보통
      else if (tradesPerSecond >= 5) level = 1;  // 초당 5건 이상: 약간
      
      setVelocity({ level, changesPerSecond: tradesPerSecond });
    }
  }, []);

  // Combined Stream으로 depth + aggTrade 동시 연결 (하나의 WebSocket으로 효율적)
  const connect = useCallback(() => {
    const rs = wsRef.current?.readyState;
    if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) return;

    const sym = symbol.toLowerCase();
    // Combined stream: depth20@100ms + aggTrade를 하나의 연결로
    const streams = `${sym}@depth20@100ms/${sym}@aggTrade`;

    try {
      wsRef.current = new WebSocket(`${WS_URL}?streams=${streams}`);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        console.log(`[OrderBook] Combined stream connected: ${streams}`);
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const data = message.data;
          const stream = message.stream;

          if (stream?.includes('@depth')) {
            // 호가 데이터 처리
            processDepthData(data);
          } else if (stream?.includes('@aggTrade')) {
            // 체결 데이터 처리
            processTradeData();
          }
        } catch (e) {
          console.error('OrderBook parse error:', e);
        }
      };

      wsRef.current.onerror = () => {
        setIsConnected(false);
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        if (!shouldReconnectRef.current) return;

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 2000); // 2초로 단축
      };
    } catch (e) {
      console.error('OrderBook connection error:', e);
    }
  }, [symbol, processDepthData, processTradeData]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
      tradeTimestampsRef.current = [];
    };
  }, [symbol, connect, isReconnecting]);

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

  // 주문 박스 클릭 → 확인 모달 오픈 (모바일/터치에서도 안정적으로 동작)
  const handleOrderBoxClick = (side: 'long' | 'short', price: number) => {
    console.log(`🎯 [OrderBook] 버튼 클릭: ${side === 'long' ? '롱(L)' : '숏(S)'} @ ${formatPrice(price)}`);
    if (!onPlaceOrder) {
      console.log(`${side === 'long' ? '롱' : '숏'} 주문 준비: ${formatPrice(price)}`);
      return;
    }
    setPendingOrder({ side, price });
  };

  const handleConfirmPlaceOrder = () => {
    if (!pendingOrder || !onPlaceOrder) return;
    console.log(`✅ [OrderBook] 주문 확정: ${pendingOrder.side === 'long' ? '롱(BUY)' : '숏(SELL)'} @ ${formatPrice(pendingOrder.price)}`);
    onPlaceOrder(pendingOrder.side, pendingOrder.price);
    setPendingOrder(null);
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
          <button
            onClick={handleManualReconnect}
            disabled={isReconnecting}
            className="p-0.5 hover:bg-cyan-500/20 rounded transition-colors"
            title="호가창 재연결"
          >
            <RefreshCw className={`w-2.5 h-2.5 text-gray-400 hover:text-cyan-400 ${isReconnecting ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <div className={`w-1.5 h-1.5 rounded-full transition-colors ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
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
        {orderBook.asks.slice(0, 10).map((ask, i) => {
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
                  onClick={() => handleOrderBoxClick('short', ask.price)}
                  title={`클릭: ${formatPrice(ask.price)}에 숏`}
                >
                  <span className="text-[7px] font-bold text-red-300">S</span>
                </div>
              </div>

              {/* 매도잔량 + 그래프 */}
              <div className="relative flex items-center justify-center overflow-hidden">
                {/* 그래프 바 (우측에서 좌측으로) - 부드러운 트랜지션 */}
                <div 
                  className="absolute right-0 top-0 bottom-0 transition-all duration-150 ease-out"
                  style={{
                    width: `${barWidth}%`,
                    background: 'linear-gradient(270deg, rgba(255, 50, 100, 0.5) 0%, rgba(255, 50, 100, 0.1) 100%)',
                  }}
                />
                <span className="relative z-10 font-mono text-gray-300 transition-opacity duration-100">
                  {formatQty(ask.quantity)}
                </span>
              </div>

              {/* 가격 (중앙) */}
              <div className="flex items-center justify-center">
                <span className="font-mono font-semibold transition-colors duration-100" style={{ color: '#ff5064' }}>
                  {formatPrice(ask.price)}
                </span>
              </div>

              {/* 매수잔량 (우측) - 비어있음 */}
              <div className="flex items-center justify-center">
                <span className="text-gray-600">-</span>
              </div>

              {/* 롱 주문 박스 (매도호가에서도 활성) */}
              <div className="flex items-center justify-center">
                <div 
                  className="w-5 h-4 rounded-sm cursor-pointer hover:opacity-80 active:scale-95 transition-all flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(180deg, rgba(0, 200, 100, 0.3) 0%, rgba(0, 180, 80, 0.5) 100%)',
                    border: '1px solid rgba(0, 200, 100, 0.5)',
                    boxShadow: '0 0 4px rgba(0, 200, 100, 0.3)',
                  }}
                  onClick={() => handleOrderBoxClick('long', ask.price)}
                  title={`클릭: ${formatPrice(ask.price)}에 롱`}
                >
                  <span className="text-[7px] font-bold text-green-300">L</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Current Price Display (현재가 = 최우선 매수호가와 매도호가 중간) */}
      {(() => {
        // 현재가 = (최우선 매도호가 + 최우선 매수호가) / 2 또는 마지막 체결가 근사치
        const bestAskPrice = orderBook.asks.length > 0 ? orderBook.asks[orderBook.asks.length - 1]?.price : 0;
        const bestBidPrice = orderBook.bids.length > 0 ? orderBook.bids[0]?.price : 0;
        const currentPrice = bestAskPrice && bestBidPrice 
          ? (bestAskPrice + bestBidPrice) / 2 
          : bestAskPrice || bestBidPrice;
        
        return (
          <div className="flex items-center justify-center gap-1 py-2" style={{
            background: 'linear-gradient(90deg, rgba(255, 50, 100, 0.15) 0%, rgba(100, 200, 255, 0.2) 50%, rgba(0, 200, 100, 0.15) 100%)',
            borderTop: '1px solid rgba(100, 200, 255, 0.4)',
            borderBottom: '1px solid rgba(100, 200, 255, 0.4)',
          }}>
            {/* 체결 속도 안테나 인디케이터 */}
            <div 
              className="flex items-end gap-[2px] mr-1" 
              title={`체결 속도: ${velocity.changesPerSecond}회/초`}
            >
              {[1, 2, 3, 4].map((bar) => (
                <div
                  key={bar}
                  className="transition-all duration-200"
                  style={{
                    width: '3px',
                    height: `${bar * 3 + 2}px`,
                    borderRadius: '1px',
                    background: velocity.level >= bar 
                      ? velocity.level >= 3 
                        ? '#00ff88' // 고속 - 녹색
                        : velocity.level >= 2 
                          ? '#ffcc00' // 중간 - 노란색
                          : '#ff8844' // 저속 - 주황색
                      : 'rgba(100, 100, 120, 0.3)', // 비활성
                    boxShadow: velocity.level >= bar && velocity.level >= 3 
                      ? '0 0 6px rgba(0, 255, 136, 0.6)' 
                      : 'none',
                  }}
                />
              ))}
            </div>

            {/* 현재가 표시 */}
            <div className="flex flex-col items-center mx-2">
              <span className="text-[8px] text-cyan-400 font-medium">현재가</span>
              <span className="text-[13px] font-mono font-bold text-cyan-300" style={{
                textShadow: '0 0 8px rgba(100, 200, 255, 0.6)',
              }}>
                {formatPrice(currentPrice)}
              </span>
            </div>

            {/* 스프레드 + 스캘핑 적합도 */}
            <div className="flex flex-col items-center ml-1">
              <span className="text-[7px] text-gray-400">스프레드</span>
              <div className="flex items-center gap-1">
                <span className="text-[9px] font-mono font-bold" style={{
                  color: orderBook.spreadPercent < 0.03 ? '#00ff88' : orderBook.spreadPercent < 0.08 ? '#ffcc00' : '#ff5064',
                }}>
                  {orderBook.spreadPercent.toFixed(3)}%
                </span>
                <span className="text-[8px] font-semibold" style={{
                  color: orderBook.spreadPercent < 0.03 ? '#00ff88' : orderBook.spreadPercent < 0.08 ? '#ffcc00' : '#ff5064',
                }}>
                  {orderBook.spreadPercent < 0.03 ? '적합' : orderBook.spreadPercent < 0.08 ? '보통' : '부적합'}
                </span>
              </div>
            </div>

            {/* 체결 속도 텍스트 */}
            <span className="text-[8px] ml-1" style={{
              color: velocity.level >= 3 ? '#00ff88' : velocity.level >= 2 ? '#ffcc00' : '#ff8844',
            }}>
              {velocity.level >= 3 ? '🔥' : velocity.level >= 2 ? '⚡' : velocity.level >= 1 ? '·' : ''}
            </span>

            {/* AI 방향 추천 아이콘 */}
            {aiEnabled && (() => {
              // 상태별 스타일 및 라벨 정의
              const getAiStyle = () => {
                if (isAiAnalyzing) {
                  return { bg: 'rgba(100, 100, 120, 0.3)', border: 'rgba(100, 100, 120, 0.5)', color: '#888', label: '...' };
                }
                if (!aiAnalysis) {
                  return { bg: 'rgba(100, 100, 120, 0.2)', border: 'rgba(100, 100, 120, 0.4)', color: '#888', label: '대기' };
                }
                switch (aiAnalysis.marketCondition) {
                  case 'TRENDING_UP':
                    return { bg: 'rgba(0, 255, 136, 0.2)', border: 'rgba(0, 255, 136, 0.5)', color: '#00ff88', label: '롱' };
                  case 'TRENDING_DOWN':
                    return { bg: 'rgba(255, 80, 100, 0.2)', border: 'rgba(255, 80, 100, 0.5)', color: '#ff5064', label: '숏' };
                  case 'RANGING':
                    return { bg: 'rgba(100, 200, 255, 0.2)', border: 'rgba(100, 200, 255, 0.5)', color: '#64c8ff', label: '횡보' };
                  case 'VOLATILE':
                    return { bg: 'rgba(255, 150, 0, 0.2)', border: 'rgba(255, 150, 0, 0.5)', color: '#ff9600', label: '변동' };
                  case 'QUIET':
                  default:
                    return { bg: 'rgba(180, 180, 180, 0.2)', border: 'rgba(180, 180, 180, 0.5)', color: '#b4b4b4', label: '관망' };
                }
              };

              const style = getAiStyle();
              const confidenceText = aiAnalysis ? ` ${aiAnalysis.confidence}%` : '';

              return (
                <button 
                  onClick={() => {
                    if (!isAiAnalyzing && onAnalyzeAI) {
                      onAnalyzeAI();
                    }
                  }}
                  disabled={isAiAnalyzing}
                  className="flex items-center gap-0.5 ml-2 px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80 active:scale-95 transition-all disabled:cursor-wait"
                  style={{
                    background: style.bg,
                    border: `1px solid ${style.border}`,
                  }}
                  title={isAiAnalyzing 
                    ? 'AI 분석 중...' 
                    : aiAnalysis 
                      ? `AI: ${aiAnalysis.marketCondition} (${aiAnalysis.confidence}% 신뢰도)\n추천: ${aiAnalysis.recommendation}\n클릭하여 재분석` 
                      : '클릭하여 AI 분석 시작'}
                >
                  {isAiAnalyzing ? (
                    <div className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  ) : aiAnalysis?.marketCondition === 'TRENDING_UP' ? (
                    <TrendingUp className="w-3 h-3" style={{ color: style.color }} />
                  ) : aiAnalysis?.marketCondition === 'TRENDING_DOWN' ? (
                    <TrendingDown className="w-3 h-3" style={{ color: style.color }} />
                  ) : aiAnalysis?.marketCondition === 'RANGING' ? (
                    <Minus className="w-3 h-3" style={{ color: style.color }} />
                  ) : aiAnalysis?.marketCondition === 'VOLATILE' ? (
                    <TrendingUp className="w-3 h-3" style={{ color: style.color, transform: 'rotate(45deg)' }} />
                  ) : (
                    <Minus className="w-3 h-3" style={{ color: style.color }} />
                  )}
                  <span className="text-[7px] font-bold" style={{ color: style.color }}>
                    {style.label}{confidenceText}
                  </span>
                </button>
              );
            })()}

            {/* 미체결 주문 표시 (클릭 시 전체 취소) */}
            {openOrders.length > 0 && (
              <button 
                onClick={onCancelAllOrders}
                className="flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80 active:scale-95 transition-all"
                style={{
                  background: 'rgba(255, 200, 0, 0.15)',
                  border: '1px solid rgba(255, 200, 0, 0.4)',
                }}
                title={`미체결 ${openOrders.length}건 - 클릭하면 전체 취소`}
              >
                <span className="text-[7px] font-bold text-yellow-400">미체결</span>
                <span className="text-[8px] font-mono font-bold text-yellow-300">{openOrders.length}</span>
                <span className="text-[7px] text-red-400">✕</span>
              </button>
            )}
          </div>
        );
      })()}

      {/* Bids (매수호가) - 우측에 잔량 그래프 */}
      <div>
        {orderBook.bids.slice(0, 10).map((bid, i) => {
          const barWidth = maxQty > 0 ? (bid.quantity / maxQty) * 100 : 0;
          return (
            <div 
              key={`bid-${i}`} 
              className="relative grid grid-cols-5 px-1 py-[2px] text-[9px] lg:py-[3px] lg:text-[10px]"
              style={{
                borderBottom: '1px solid rgba(60, 60, 80, 0.3)',
              }}
            >
              {/* 숏 주문 박스 (매수호가에서도 활성) */}
              <div className="flex items-center justify-center">
                <div 
                  className="w-5 h-4 rounded-sm cursor-pointer hover:opacity-80 active:scale-95 transition-all flex items-center justify-center"
                  style={{
                    background: 'linear-gradient(180deg, rgba(255, 80, 100, 0.3) 0%, rgba(255, 50, 80, 0.5) 100%)',
                    border: '1px solid rgba(255, 80, 100, 0.5)',
                    boxShadow: '0 0 4px rgba(255, 80, 100, 0.3)',
                  }}
                  onClick={() => handleOrderBoxClick('short', bid.price)}
                  title={`클릭: ${formatPrice(bid.price)}에 숏`}
                >
                  <span className="text-[7px] font-bold text-red-300">S</span>
                </div>
              </div>

              {/* 매도잔량 (좌측) - 비어있음 */}
              <div className="flex items-center justify-center">
                <span className="text-gray-600">-</span>
              </div>

              {/* 가격 (중앙) */}
              <div className="flex items-center justify-center">
                <span className="font-mono font-semibold transition-colors duration-100" style={{ color: '#00c868' }}>
                  {formatPrice(bid.price)}
                </span>
              </div>

              {/* 매수잔량 + 그래프 */}
              <div className="relative flex items-center justify-center overflow-hidden">
                {/* 그래프 바 (좌측에서 우측으로) - 부드러운 트랜지션 */}
                <div 
                  className="absolute left-0 top-0 bottom-0 transition-all duration-150 ease-out"
                  style={{
                    width: `${barWidth}%`,
                    background: 'linear-gradient(90deg, rgba(0, 200, 100, 0.1) 0%, rgba(0, 200, 100, 0.5) 100%)',
                  }}
                />
                <span className="relative z-10 font-mono text-gray-300 transition-opacity duration-100">
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
                  onClick={() => handleOrderBoxClick('long', bid.price)}
                  title={`클릭: ${formatPrice(bid.price)}에 롱`}
                >
                  <span className="text-[7px] font-bold text-green-300">L</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </div> {/* End scrollable order book area */}

      <AlertDialog
        open={!!pendingOrder}
        onOpenChange={(open) => {
          if (!open) setPendingOrder(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>지정가 주문 확인</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingOrder ? (
                <span>
                  {symbol.replace('USDT', '')} {pendingOrder.side === 'long' ? '롱' : '숏'} @ {formatPrice(pendingOrder.price)}
                  {' '}({splitCount}분할)
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmPlaceOrder}>주문 넣기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

export default OrderBook;
