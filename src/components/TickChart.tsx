import { useEffect, useRef, useState, useMemo } from 'react';
import { useOrderBookWebSocket } from '@/hooks/useOrderBookWebSocket';
import { cn } from '@/lib/utils';

interface TickData {
  time: number;
  price: number;
  type: 'bid' | 'ask' | 'mid';
}

interface TickChartProps {
  symbol: string;
  height?: number;
}

const MAX_TICKS = 300; // 최대 틱 수
const CANVAS_PADDING = 40;

const TickChart = ({ symbol, height = 400 }: TickChartProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ticks, setTicks] = useState<TickData[]>([]);
  const lastPriceRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  
  // 호가창 WebSocket에서 데이터 받기 (이미 연결된 것 재사용)
  const { orderBook, isConnected } = useOrderBookWebSocket(symbol, 5);
  
  // 호가창 데이터에서 가격 추출
  useEffect(() => {
    if (!orderBook || orderBook.bids.length === 0 || orderBook.asks.length === 0) return;
    
    const bestBid = orderBook.bids[0].price;
    const bestAsk = orderBook.asks[0].price;
    const midPrice = (bestBid + bestAsk) / 2;
    
    // 가격 변화가 있을 때만 틱 추가
    if (Math.abs(midPrice - lastPriceRef.current) > 0.00001) {
      lastPriceRef.current = midPrice;
      
      const newTick: TickData = {
        time: Date.now(),
        price: midPrice,
        type: 'mid',
      };
      
      setTicks(prev => {
        const updated = [...prev, newTick];
        // 최대 개수 유지
        if (updated.length > MAX_TICKS) {
          return updated.slice(-MAX_TICKS);
        }
        return updated;
      });
    }
  }, [orderBook]);
  
  // 심볼 변경 시 초기화
  useEffect(() => {
    setTicks([]);
    lastPriceRef.current = 0;
  }, [symbol]);
  
  // 캔버스에 차트 그리기
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || ticks.length < 2) return;
    
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
    
    // 가격 범위 계산
    const prices = ticks.map(t => t.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
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
    
    // 가격 라인 그리기
    const chartWidth = width - CANVAS_PADDING - 50;
    const chartAreaHeight = chartHeight - CANVAS_PADDING * 2;
    
    ctx.beginPath();
    ctx.strokeStyle = '#ef4444'; // 빨간색 (상승 기본)
    ctx.lineWidth = 1.5;
    
    let prevY = 0;
    ticks.forEach((tick, index) => {
      const x = CANVAS_PADDING + (index / (ticks.length - 1)) * chartWidth;
      const y = CANVAS_PADDING + ((adjustedMax - tick.price) / adjustedRange) * chartAreaHeight;
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        // 가격 방향에 따라 색상 변경
        if (y < prevY) {
          ctx.strokeStyle = '#ef4444'; // 상승 = 빨간색
        } else if (y > prevY) {
          ctx.strokeStyle = '#3b82f6'; // 하락 = 파란색
        }
        ctx.lineTo(x, y);
      }
      prevY = y;
    });
    ctx.stroke();
    
    // 현재가 표시
    if (ticks.length > 0) {
      const currentTick = ticks[ticks.length - 1];
      const currentY = CANVAS_PADDING + ((adjustedMax - currentTick.price) / adjustedRange) * chartAreaHeight;
      const prevTick = ticks.length > 1 ? ticks[ticks.length - 2] : currentTick;
      const isUp = currentTick.price >= prevTick.price;
      
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
      ctx.fillText(formatPrice(currentTick.price), width - 4, currentY + 3);
    }
    
  }, [ticks, height]);
  
  // 가격 포맷팅
  const formatPrice = (price: number): string => {
    if (price >= 1000) return price.toFixed(2);
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  };
  
  // 현재가 정보
  const currentPrice = ticks.length > 0 ? ticks[ticks.length - 1].price : 0;
  const prevPrice = ticks.length > 1 ? ticks[ticks.length - 2].price : currentPrice;
  const priceChange = currentPrice - prevPrice;
  const isUp = priceChange >= 0;
  
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
          틱: {ticks.length}
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
      
      {/* 데이터 없음 */}
      {ticks.length < 2 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-muted-foreground text-sm">
            {isConnected ? '데이터 수집 중...' : '연결 중...'}
          </span>
        </div>
      )}
    </div>
  );
};

export default TickChart;
