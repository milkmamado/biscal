import { useEffect, useRef, useState, useMemo } from 'react';
import { cn } from '@/lib/utils';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface OrderBook {
  bids: { price: number; quantity: number }[];
  asks: { price: number; quantity: number }[];
  lastUpdateId: number;
}

interface TickChartProps {
  orderBook: OrderBook | null;
  isConnected: boolean;
  height?: number;
  interval?: number; // 봉 간격 (초)
}

const MAX_CANDLES = 100;
const CANVAS_PADDING = 40;

const TickChart = ({ orderBook, isConnected, height = 400, interval = 5 }: TickChartProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const lastCandleTimeRef = useRef<number>(0);
  const currentCandleRef = useRef<Candle | null>(null);
  
  // orderBook에서 mid price 추출해서 봉차트 생성
  useEffect(() => {
    if (!orderBook || orderBook.bids.length === 0 || orderBook.asks.length === 0) return;
    
    const bestBid = orderBook.bids[0].price;
    const bestAsk = orderBook.asks[0].price;
    const midPrice = (bestBid + bestAsk) / 2;
    
    const now = Date.now();
    const candleTime = Math.floor(now / (interval * 1000)) * (interval * 1000);
    
    if (candleTime !== lastCandleTimeRef.current) {
      // 새 봉 시작
      if (currentCandleRef.current) {
        setCandles(prev => {
          const updated = [...prev, currentCandleRef.current!];
          if (updated.length > MAX_CANDLES) {
            return updated.slice(-MAX_CANDLES);
          }
          return updated;
        });
      }
      
      currentCandleRef.current = {
        time: candleTime,
        open: midPrice,
        high: midPrice,
        low: midPrice,
        close: midPrice,
      };
      lastCandleTimeRef.current = candleTime;
    } else if (currentCandleRef.current) {
      // 현재 봉 업데이트
      currentCandleRef.current.high = Math.max(currentCandleRef.current.high, midPrice);
      currentCandleRef.current.low = Math.min(currentCandleRef.current.low, midPrice);
      currentCandleRef.current.close = midPrice;
    }
  }, [orderBook, interval]);
  
  // 심볼 변경 감지를 위해 orderBook.lastUpdateId 모니터링
  useEffect(() => {
    if (!orderBook) {
      setCandles([]);
      currentCandleRef.current = null;
      lastCandleTimeRef.current = 0;
    }
  }, [orderBook?.lastUpdateId === 0]);
  
  // 캔버스에 봉차트 그리기
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // 캔버스 크기 설정
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const chartHeight = height;
    
    // 배경
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, chartHeight);
    
    // 현재 봉 포함한 전체 봉
    const allCandles = currentCandleRef.current 
      ? [...candles, currentCandleRef.current]
      : candles;
    
    if (allCandles.length < 2) {
      // 데이터 없음 메시지
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(isConnected ? '데이터 수집 중...' : '연결 중...', width / 2, chartHeight / 2);
      return;
    }
    
    // 가격 범위 계산
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    allCandles.forEach(c => {
      minPrice = Math.min(minPrice, c.low);
      maxPrice = Math.max(maxPrice, c.high);
    });
    
    const priceRange = maxPrice - minPrice || 1;
    const pricePadding = priceRange * 0.1;
    const adjustedMin = minPrice - pricePadding;
    const adjustedMax = maxPrice + pricePadding;
    const adjustedRange = adjustedMax - adjustedMin;
    
    // Y축 그리드 및 가격 레이블
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = CANVAS_PADDING + ((chartHeight - CANVAS_PADDING * 2) * i / gridLines);
      const price = adjustedMax - (adjustedRange * i / gridLines);
      
      ctx.beginPath();
      ctx.moveTo(CANVAS_PADDING, y);
      ctx.lineTo(width - 10, y);
      ctx.stroke();
      
      ctx.fillText(formatPrice(price), width - 2, y + 3);
    }
    
    // 봉차트 그리기
    const chartWidth = width - CANVAS_PADDING - 50;
    const chartAreaHeight = chartHeight - CANVAS_PADDING * 2;
    const candleWidth = Math.max(2, Math.floor(chartWidth / allCandles.length) - 2);
    const candleSpacing = chartWidth / allCandles.length;
    
    allCandles.forEach((candle, index) => {
      const x = CANVAS_PADDING + (index * candleSpacing) + (candleSpacing / 2);
      const isUp = candle.close >= candle.open;
      
      // 색상
      const bullColor = '#ef4444'; // 상승 = 빨간색
      const bearColor = '#3b82f6'; // 하락 = 파란색
      const color = isUp ? bullColor : bearColor;
      
      // Y 좌표 계산
      const openY = CANVAS_PADDING + ((adjustedMax - candle.open) / adjustedRange) * chartAreaHeight;
      const closeY = CANVAS_PADDING + ((adjustedMax - candle.close) / adjustedRange) * chartAreaHeight;
      const highY = CANVAS_PADDING + ((adjustedMax - candle.high) / adjustedRange) * chartAreaHeight;
      const lowY = CANVAS_PADDING + ((adjustedMax - candle.low) / adjustedRange) * chartAreaHeight;
      
      // 심지 그리기
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();
      
      // 몸통 그리기
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(1, Math.abs(closeY - openY));
      
      ctx.fillStyle = color;
      ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
    });
    
    // 현재가 표시
    if (allCandles.length > 0) {
      const currentCandle = allCandles[allCandles.length - 1];
      const currentY = CANVAS_PADDING + ((adjustedMax - currentCandle.close) / adjustedRange) * chartAreaHeight;
      const isUp = currentCandle.close >= currentCandle.open;
      
      // 현재가 라인
      ctx.strokeStyle = isUp ? 'rgba(239, 68, 68, 0.5)' : 'rgba(59, 130, 246, 0.5)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(CANVAS_PADDING, currentY);
      ctx.lineTo(width - 50, currentY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // 현재가 라벨
      ctx.fillStyle = isUp ? '#ef4444' : '#3b82f6';
      ctx.fillRect(width - 48, currentY - 8, 46, 16);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(formatPrice(currentCandle.close), width - 4, currentY + 3);
    }
    
  }, [candles, height, isConnected]);
  
  // 가격 포맷팅
  const formatPrice = (price: number): string => {
    if (price >= 1000) return price.toFixed(2);
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  };
  
  // 현재가 정보
  const currentPrice = currentCandleRef.current?.close || (candles.length > 0 ? candles[candles.length - 1].close : 0);
  const prevClose = candles.length > 0 ? candles[candles.length - 1].close : currentPrice;
  const isUp = currentPrice >= prevClose;
  
  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas 
        ref={canvasRef} 
        className="w-full"
        style={{ height: `${height}px` }}
      />
      
      {/* 연결 상태 */}
      <div className="absolute top-2 left-2 flex items-center gap-2">
        <div className={cn(
          "w-2 h-2 rounded-full",
          isConnected ? "bg-green-500" : "bg-red-500"
        )} />
        <span className="text-[10px] text-muted-foreground">
          {isConnected ? 'LIVE' : 'OFFLINE'}
        </span>
        <span className="text-[10px] text-muted-foreground">
          봉: {candles.length + (currentCandleRef.current ? 1 : 0)}
        </span>
      </div>
      
      {/* 현재가 표시 */}
      {currentPrice > 0 && (
        <div className="absolute top-2 right-2 flex items-center gap-2">
          <span className={cn(
            "text-lg font-bold font-mono",
            isUp ? "text-red-400" : "text-blue-400"
          )}>
            {formatPrice(currentPrice)}
          </span>
          <span className={cn(
            "text-xs font-mono",
            isUp ? "text-red-400" : "text-blue-400"
          )}>
            {isUp ? '▲' : '▼'}
          </span>
        </div>
      )}
    </div>
  );
};

export default TickChart;