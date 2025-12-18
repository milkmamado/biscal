import { useEffect, useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ZoomIn, ZoomOut } from 'lucide-react';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface OrderBook {
  bids: { price: number; quantity: number }[];
  asks: { price: number; quantity: number }[];
  lastUpdateId: number;
}

interface TickChartProps {
  symbol: string;
  orderBook?: OrderBook | null;
  isConnected?: boolean;
  height?: number;
  interval?: number; // 봉 간격 (초)
  entryPrice?: number; // 포지션 진입가
}

const MAX_CANDLES = 200;
const CANVAS_PADDING = 40;
const VOLUME_HEIGHT_RATIO = 0.15; // 거래량 영역 비율
const BB_PERIOD = 20; // 볼린저 밴드 기간
const BB_STD_DEV = 2; // 표준편차 배수

// 볼린저 밴드 계산
interface BollingerBand {
  middle: number;
  upper: number;
  lower: number;
}

const calculateBollingerBands = (candles: Candle[], period: number = BB_PERIOD, stdDev: number = BB_STD_DEV): (BollingerBand | null)[] => {
  return candles.map((_, index) => {
    if (index < period - 1) return null;
    
    // 최근 period개 종가
    const closes = candles.slice(index - period + 1, index + 1).map(c => c.close);
    
    // SMA 계산
    const sma = closes.reduce((sum, c) => sum + c, 0) / period;
    
    // 표준편차 계산
    const squaredDiffs = closes.map(c => Math.pow(c - sma, 2));
    const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / period;
    const std = Math.sqrt(variance);
    
    return {
      middle: sma,
      upper: sma + stdDev * std,
      lower: sma - stdDev * std,
    };
  });
};

// 변동성 급등 캔들 감지 (최근 20봉 평균 대비 2배 이상 변동)
const detectHighVolatilityCandles = (candles: Candle[], threshold: number = 2.0): boolean[] => {
  const period = 20;
  return candles.map((candle, index) => {
    if (index < period) return false;
    
    // 해당 캔들의 변동폭 (고가 - 저가)
    const candleRange = candle.high - candle.low;
    
    // 최근 period개 캔들의 평균 변동폭
    const recentCandles = candles.slice(Math.max(0, index - period), index);
    const avgRange = recentCandles.reduce((sum, c) => sum + (c.high - c.low), 0) / recentCandles.length;
    
    // 평균 대비 threshold배 이상이면 변동성 급등
    return candleRange >= avgRange * threshold;
  });
};

// Binance interval string 변환
const getIntervalString = (seconds: number): string => {
  if (seconds <= 60) return '1m';
  if (seconds <= 180) return '3m';
  if (seconds <= 300) return '5m';
  if (seconds <= 900) return '15m';
  if (seconds <= 1800) return '30m';
  if (seconds <= 3600) return '1h';
  if (seconds <= 14400) return '4h';
  return '1d';
};

const TickChart = ({ symbol, orderBook = null, isConnected = false, height = 400, interval = 60, entryPrice }: TickChartProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(50);
  const [displaySymbol, setDisplaySymbol] = useState(symbol); // 현재 표시 중인 심볼
  const [currentPriceDisplay, setCurrentPriceDisplay] = useState(0); // 현재가 표시용
  const [klineConnected, setKlineConnected] = useState(false);

  const lastCandleTimeRef = useRef<number>(0);
  const currentCandleRef = useRef<Candle | null>(null);
  const fetchIdRef = useRef<number>(0); // fetch 요청 ID
  const rafIdRef = useRef<number>(0); // requestAnimationFrame ID
  const lastDrawTimeRef = useRef<number>(0); // 마지막 그리기 시간

  const klineWsRef = useRef<WebSocket | null>(null);
  const klineReconnectTimeoutRef = useRef<number | null>(null);
  const klineConnIdRef = useRef(0);
  
  // 줌 인/아웃
  const handleZoomIn = useCallback(() => {
    setVisibleCount(prev => Math.max(20, prev - 10));
  }, []);
  
  const handleZoomOut = useCallback(() => {
    setVisibleCount(prev => Math.min(MAX_CANDLES, prev + 10));
  }, []);
  
  // 마우스 휠로 줌
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      handleZoomIn();
    } else {
      handleZoomOut();
    }
  }, [handleZoomIn, handleZoomOut]);
  
  // 휠 이벤트 등록
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);
  
  // Binance에서 히스토리컬 klines 가져오기
  useEffect(() => {
    // 새 요청 ID 생성
    const currentFetchId = ++fetchIdRef.current;
    
    // 즉시 상태 초기화 (동기적으로)
    currentCandleRef.current = null;
    lastCandleTimeRef.current = 0;
    
    // 상태 동시 업데이트로 깜빡임 최소화
    setCandles([]);
    setLoading(true);
    setDisplaySymbol(symbol);
    
    const fetchKlines = async () => {
      try {
        const intervalStr = getIntervalString(interval);
        const res = await fetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${intervalStr}&limit=${MAX_CANDLES}`
        );
        const data = await res.json();
        
        // 이 fetch가 최신 요청인지 확인 (race condition 방지)
        if (fetchIdRef.current !== currentFetchId) return;
        
        if (Array.isArray(data)) {
          const historicalCandles: Candle[] = data.map((k: any[]) => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
          }));
          
          // 다시 한번 확인 (fetch 후 symbol 변경되었을 수 있음)
          if (fetchIdRef.current !== currentFetchId) return;
          
          if (historicalCandles.length > 0) {
            const lastCandle = historicalCandles[historicalCandles.length - 1];
            currentCandleRef.current = { ...lastCandle };
            lastCandleTimeRef.current = lastCandle.time;
          }
          
          setCandles(historicalCandles);
          setLoading(false);
        }
      } catch (error) {
        console.error('Failed to fetch klines:', error);
        if (fetchIdRef.current === currentFetchId) {
          setLoading(false);
        }
      }
    };
    
    fetchKlines();
    
    return () => {
      // no periodic REST refresh: realtime updates come from kline websocket
    };
  }, [symbol, interval]);

  // Kline WebSocket으로 실시간 봉 업데이트 (바이낸스 차트와 동일한 소스)
  useEffect(() => {
    const intervalStr = getIntervalString(interval);
    const connId = ++klineConnIdRef.current;

    setKlineConnected(false);

    if (klineReconnectTimeoutRef.current) {
      window.clearTimeout(klineReconnectTimeoutRef.current);
      klineReconnectTimeoutRef.current = null;
    }

    if (klineWsRef.current) {
      try {
        klineWsRef.current.close();
      } catch {
        // ignore
      }
      klineWsRef.current = null;
    }

    const connect = () => {
      if (klineConnIdRef.current !== connId) return;

      const ws = new WebSocket(
        `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${intervalStr}`
      );
      klineWsRef.current = ws;

      const scheduleReconnect = () => {
        if (klineConnIdRef.current !== connId) return;
        if (klineReconnectTimeoutRef.current) return;
        klineReconnectTimeoutRef.current = window.setTimeout(() => {
          klineReconnectTimeoutRef.current = null;
          connect();
        }, 1000);
      };

      ws.onopen = () => {
        if (klineConnIdRef.current !== connId) return;
        setKlineConnected(true);
      };

      ws.onmessage = (event) => {
        if (klineConnIdRef.current !== connId) return;
        try {
          const msg = JSON.parse(event.data);
          const k = msg?.k;
          if (!k || typeof k.t !== 'number') return;

          const candle: Candle = {
            time: k.t,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
          };

          currentCandleRef.current = candle;
          lastCandleTimeRef.current = candle.time;
          setCurrentPriceDisplay(candle.close);
          setLoading(false);

          setCandles((prev) => {
            if (prev.length === 0) return [candle];
            const last = prev[prev.length - 1];

            // 같은 봉 업데이트
            if (last.time === candle.time) {
              const next = prev.slice();
              next[next.length - 1] = candle;
              return next;
            }

            // 새 봉 시작
            if (last.time < candle.time) {
              return [...prev, candle].slice(-MAX_CANDLES);
            }

            // out-of-order는 무시
            return prev;
          });
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        if (klineConnIdRef.current !== connId) return;
        setKlineConnected(false);
        scheduleReconnect();
      };

      ws.onclose = () => {
        if (klineConnIdRef.current !== connId) return;
        setKlineConnected(false);
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      if (klineReconnectTimeoutRef.current) {
        window.clearTimeout(klineReconnectTimeoutRef.current);
        klineReconnectTimeoutRef.current = null;
      }
      if (klineWsRef.current) {
        try {
          klineWsRef.current.close();
        } catch {
          // ignore
        }
        klineWsRef.current = null;
      }
    };
  }, [symbol, interval]);

  // orderBook에서 현재가로 현재 봉 업데이트 (requestAnimationFrame으로 최적화)
  useEffect(() => {
    // 로딩 중이거나 캔들이 없으면 무시
    if (loading || candles.length === 0) return;
    if (!orderBook || orderBook.bids.length === 0 || orderBook.asks.length === 0) return;
    if (!currentCandleRef.current) return;
    
    const bestBid = orderBook.bids[0].price;
    const bestAsk = orderBook.asks[0].price;
    const midPrice = (bestBid + bestAsk) / 2;
    
    // 현재 봉 업데이트 (ref만 업데이트)
    currentCandleRef.current.high = Math.max(currentCandleRef.current.high, midPrice);
    currentCandleRef.current.low = Math.min(currentCandleRef.current.low, midPrice);
    currentCandleRef.current.close = midPrice;
    
    // 현재가 상태 업데이트 (UI 표시용)
    setCurrentPriceDisplay(midPrice);
    
    // 쓰로틀링: 50ms마다 한번만 그리기 (바이낸스보다 빠른 반응)
    const now = performance.now();
    if (now - lastDrawTimeRef.current < 50) return;
    lastDrawTimeRef.current = now;
    
    // requestAnimationFrame으로 부드러운 업데이트
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(() => {
      setCandles(prev => [...prev]);
    });
    
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [orderBook, candles.length, loading]);
  
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
    const volumeHeight = chartHeight * VOLUME_HEIGHT_RATIO;
    const priceChartHeight = chartHeight - volumeHeight - CANVAS_PADDING;
    
    // 배경
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, chartHeight);
    
    if (loading) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('로딩 중...', width / 2, chartHeight / 2);
      return;
    }
    
    // 현재 봉 포함한 전체 봉 (마지막 봉을 현재 봉으로 대체)
    const allCandles = candles.length > 0 && currentCandleRef.current
      ? [...candles.slice(0, -1), currentCandleRef.current]
      : candles;
    
    // 표시할 봉만 선택 (최근 N개)
    const displayCandles = allCandles.slice(-visibleCount);
    
    if (displayCandles.length < 2) {
      const connected = klineConnected || isConnected || (!!orderBook && orderBook.bids.length > 0);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(connected ? '데이터 수집 중...' : '연결 중...', width / 2, chartHeight / 2);
      return;
    }
    
    // 볼린저 밴드 계산
    const bbData = calculateBollingerBands(displayCandles);
    
    // 가격 범위 계산 (볼린저 밴드 포함)
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVolume = 0;
    displayCandles.forEach((c, i) => {
      minPrice = Math.min(minPrice, c.low);
      maxPrice = Math.max(maxPrice, c.high);
      maxVolume = Math.max(maxVolume, c.volume);
      
      // 볼린저 밴드도 범위에 포함
      const bb = bbData[i];
      if (bb) {
        minPrice = Math.min(minPrice, bb.lower);
        maxPrice = Math.max(maxPrice, bb.upper);
      }
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
      const y = CANVAS_PADDING / 2 + ((priceChartHeight) * i / gridLines);
      const price = adjustedMax - (adjustedRange * i / gridLines);
      
      ctx.beginPath();
      ctx.moveTo(CANVAS_PADDING, y);
      ctx.lineTo(width - 10, y);
      ctx.stroke();
      
      ctx.fillText(formatPrice(price), width - 2, y + 3);
    }
    
    // 거래량/가격 구분선
    const volumeStartY = priceChartHeight + CANVAS_PADDING / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.moveTo(CANVAS_PADDING, volumeStartY);
    ctx.lineTo(width - 10, volumeStartY);
    ctx.stroke();
    
    // 봉차트와 거래량 그리기
    const chartWidth = width - CANVAS_PADDING - 50;
    const candleWidth = Math.max(2, Math.floor(chartWidth / displayCandles.length) - 2);
    const candleSpacing = chartWidth / displayCandles.length;
    
    // === 볼린저 밴드 그리기 (봉차트 뒤에 먼저 그림) ===
    const getY = (price: number) => CANVAS_PADDING / 2 + ((adjustedMax - price) / adjustedRange) * priceChartHeight;
    
    // 상단 밴드
    ctx.strokeStyle = 'rgba(156, 163, 175, 0.6)'; // gray-400
    ctx.lineWidth = 1;
    ctx.beginPath();
    let started = false;
    bbData.forEach((bb, index) => {
      if (!bb) return;
      const x = CANVAS_PADDING + (index * candleSpacing) + (candleSpacing / 2);
      if (!started) {
        ctx.moveTo(x, getY(bb.upper));
        started = true;
      } else {
        ctx.lineTo(x, getY(bb.upper));
      }
    });
    ctx.stroke();
    
    // 중간선 (SMA)
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)'; // amber-400
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    started = false;
    bbData.forEach((bb, index) => {
      if (!bb) return;
      const x = CANVAS_PADDING + (index * candleSpacing) + (candleSpacing / 2);
      if (!started) {
        ctx.moveTo(x, getY(bb.middle));
        started = true;
      } else {
        ctx.lineTo(x, getY(bb.middle));
      }
    });
    ctx.stroke();
    
    // 하단 밴드
    ctx.strokeStyle = 'rgba(156, 163, 175, 0.6)'; // gray-400
    ctx.lineWidth = 1;
    ctx.beginPath();
    started = false;
    bbData.forEach((bb, index) => {
      if (!bb) return;
      const x = CANVAS_PADDING + (index * candleSpacing) + (candleSpacing / 2);
      if (!started) {
        ctx.moveTo(x, getY(bb.lower));
        started = true;
      } else {
        ctx.lineTo(x, getY(bb.lower));
      }
    });
    ctx.stroke();
    
    // === 변동성 급등 캔들 감지 ===
    const highVolatilityFlags = detectHighVolatilityCandles(displayCandles);
    
    // === 봉차트 그리기 ===
    displayCandles.forEach((candle, index) => {
      const x = CANVAS_PADDING + (index * candleSpacing) + (candleSpacing / 2);
      const isUp = candle.close >= candle.open;
      const isHighVolatility = highVolatilityFlags[index];
      
      // 색상 - 변동성 급등 캔들은 노란색/주황색으로 강조
      const bullColor = isHighVolatility ? '#fbbf24' : '#ef4444'; // 급등: amber-400, 일반: 빨간색
      const bearColor = isHighVolatility ? '#f97316' : '#3b82f6'; // 급등: orange-500, 일반: 파란색
      const color = isUp ? bullColor : bearColor;
      
      // === 가격 봉 ===
      const openY = CANVAS_PADDING / 2 + ((adjustedMax - candle.open) / adjustedRange) * priceChartHeight;
      const closeY = CANVAS_PADDING / 2 + ((adjustedMax - candle.close) / adjustedRange) * priceChartHeight;
      const highY = CANVAS_PADDING / 2 + ((adjustedMax - candle.high) / adjustedRange) * priceChartHeight;
      const lowY = CANVAS_PADDING / 2 + ((adjustedMax - candle.low) / adjustedRange) * priceChartHeight;
      
      // 변동성 급등 캔들 - 글로우 효과
      if (isHighVolatility) {
        ctx.shadowColor = isUp ? '#fbbf24' : '#f97316';
        ctx.shadowBlur = 8;
      }
      
      // 심지 그리기
      ctx.strokeStyle = color;
      ctx.lineWidth = isHighVolatility ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();
      
      // 몸통 그리기
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(1, Math.abs(closeY - openY));
      ctx.fillStyle = color;
      ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
      
      // 글로우 효과 리셋
      if (isHighVolatility) {
        ctx.shadowBlur = 0;
      }
      
      // === 거래량 바 ===
      if (maxVolume > 0) {
        const volumeBarHeight = (candle.volume / maxVolume) * (volumeHeight - 10);
        const volumeY = chartHeight - volumeBarHeight - 5;
        ctx.fillStyle = isUp ? 'rgba(239, 68, 68, 0.5)' : 'rgba(59, 130, 246, 0.5)';
        ctx.fillRect(x - candleWidth / 2, volumeY, candleWidth, volumeBarHeight);
      }
    });
    
    // 진입가 표시 (녹색 점선)
    if (entryPrice && entryPrice >= adjustedMin && entryPrice <= adjustedMax) {
      const entryY = CANVAS_PADDING / 2 + ((adjustedMax - entryPrice) / adjustedRange) * priceChartHeight;
      
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.7)'; // green-500
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(CANVAS_PADDING, entryY);
      ctx.lineTo(width - 50, entryY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    
    // 현재가 표시
    if (displayCandles.length > 0) {
      const currentCandle = displayCandles[displayCandles.length - 1];
      const currentY = CANVAS_PADDING / 2 + ((adjustedMax - currentCandle.close) / adjustedRange) * priceChartHeight;
      const isUp = currentCandle.close >= currentCandle.open;
      
      // 현재가 라인
      ctx.strokeStyle = isUp ? 'rgba(239, 68, 68, 0.5)' : 'rgba(59, 130, 246, 0.5)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(CANVAS_PADDING, currentY);
      ctx.lineTo(width - 50, currentY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    
  }, [candles, height, isConnected, loading, visibleCount, entryPrice]);
  
  // 가격 포맷팅
  const formatPrice = (price: number): string => {
    if (price >= 1000) return price.toFixed(2);
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  };
  
  // 현재가 정보 (상태에서 가져와 빠르게 반응)
  const currentPrice = currentPriceDisplay || currentCandleRef.current?.close || 0;
  const prevClose = candles.length > 1 ? candles[candles.length - 2].close : currentPrice;
  const isUp = currentPrice >= prevClose;
  
  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas 
        ref={canvasRef} 
        className="w-full"
        style={{ height: `${height}px` }}
      />
      
      {/* 심볼명 + 현재가 (좌측 상단) */}
      <div className="absolute top-2 left-2 flex items-center gap-3">
        <span className="text-sm font-bold text-foreground">
          {displaySymbol.replace('USDT', '')}
        </span>
        {currentPrice > 0 && (
          <span className={cn(
            "text-sm font-bold font-mono",
            isUp ? "text-red-400" : "text-blue-400"
          )}>
            ${formatPrice(currentPrice)} {isUp ? '▲' : '▼'}
          </span>
        )}
        <div className={cn(
          "w-2 h-2 rounded-full",
          (klineConnected || isConnected || (orderBook && orderBook.bids.length > 0))
            ? "bg-green-500 animate-pulse"
            : "bg-red-500"
        )} />
      </div>
      
      {/* 우측 상단: 분봉 정보 */}
      <div className="absolute top-2 right-2 flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground font-mono">
          {getIntervalString(interval)} | {visibleCount}봉
        </span>
      </div>
      
      {/* 줌 컨트롤 (중앙) */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1">
        <button
          onClick={handleZoomIn}
          className="p-1 bg-secondary/80 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors"
          title="확대 (스크롤 업)"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleZoomOut}
          className="p-1 bg-secondary/80 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors"
          title="축소 (스크롤 다운)"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default TickChart;