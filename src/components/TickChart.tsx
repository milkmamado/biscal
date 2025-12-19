import { useEffect, useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ZoomIn, ZoomOut } from 'lucide-react';
import cyberpunkGirl from '@/assets/cyberpunk-girl.png';

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
  stopLossPrice?: number; // 손절 예정 가격
  takeProfitPrice?: number; // 익절 예정 가격
  positionSide?: 'long' | 'short'; // 포지션 방향
}

const MAX_CANDLES = 200;
const CANVAS_PADDING = 40;
const BB_STD_DEV = 2; // 표준편차 배수

// MACD 계산
interface MACDData {
  macd: number;
  signal: number;
  histogram: number;
}

const calculateEMA = (prices: number[], period: number): number[] => {
  const k = 2 / (period + 1);
  const emaArray: number[] = [];
  let ema = prices[0];
  
  for (let i = 0; i < prices.length; i++) {
    if (i === 0) {
      ema = prices[0];
    } else {
      ema = prices[i] * k + ema * (1 - k);
    }
    emaArray.push(ema);
  }
  return emaArray;
};

const calculateMACD = (candles: Candle[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): (MACDData | null)[] => {
  if (candles.length < slowPeriod) return candles.map(() => null);
  
  const closes = candles.map(c => c.close);
  const emaFast = calculateEMA(closes, fastPeriod);
  const emaSlow = calculateEMA(closes, slowPeriod);
  
  const macdLine = emaFast.map((fast, i) => fast - emaSlow[i]);
  const signalLine = calculateEMA(macdLine, signalPeriod);
  
  return candles.map((_, i) => {
    if (i < slowPeriod - 1) return null;
    return {
      macd: macdLine[i],
      signal: signalLine[i],
      histogram: macdLine[i] - signalLine[i],
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

const TickChart = ({ symbol, orderBook = null, isConnected = false, height, interval = 60, entryPrice, stopLossPrice, takeProfitPrice, positionSide }: TickChartProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(50);
  const [displaySymbol, setDisplaySymbol] = useState(symbol); // 현재 표시 중인 심볼
  const [currentPriceDisplay, setCurrentPriceDisplay] = useState(0); // 현재가 표시용
  const [klineConnected, setKlineConnected] = useState(false);
  const [containerHeight, setContainerHeight] = useState(height || 400);
  
  // 나방 효과 상태
  const [mothVisible, setMothVisible] = useState(false);
  const [mothPhase, setMothPhase] = useState(0);
  
  // 사이버 눈물 효과 상태
  const [tearsVisible, setTearsVisible] = useState(false);
  const [tearsPhase, setTearsPhase] = useState(0);

  const lastCandleTimeRef = useRef<number>(0);
  const currentCandleRef = useRef<Candle | null>(null);
  const fetchIdRef = useRef<number>(0); // fetch 요청 ID
  const rafIdRef = useRef<number>(0); // requestAnimationFrame ID
  const lastDrawTimeRef = useRef<number>(0); // 마지막 그리기 시간

  const klineWsRef = useRef<WebSocket | null>(null);
  const klineReconnectTimeoutRef = useRef<number | null>(null);
  const klineConnIdRef = useRef(0);
  
  // 컨테이너 높이 동적 감지
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const updateHeight = () => {
      const rect = container.getBoundingClientRect();
      if (rect.height > 100) {
        setContainerHeight(rect.height);
      }
    };
    
    updateHeight();
    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(container);
    
    return () => resizeObserver.disconnect();
  }, []);
  
  // 나방 나타났다 사라지는 효과
  useEffect(() => {
    const mothInterval = setInterval(() => {
      setMothVisible(true);
      setMothPhase(0);
      
      // 페이드인
      setTimeout(() => setMothPhase(1), 100);
      
      // 사라지기 시작
      setTimeout(() => setMothPhase(2), 5000);
      
      // 완전히 사라짐
      setTimeout(() => {
        setMothVisible(false);
        setMothPhase(0);
      }, 5500);
    }, 10000);

    // 초기 표시
    setTimeout(() => {
      setMothVisible(true);
      setMothPhase(1);
    }, 2000);

    return () => clearInterval(mothInterval);
  }, []);

  // 사이버 눈물 효과
  useEffect(() => {
    const tearsInterval = setInterval(() => {
      setTearsVisible(true);
      setTearsPhase(0);
      
      // 눈물 시작
      setTimeout(() => setTearsPhase(1), 100);
      
      // 눈물 흐르는 중
      setTimeout(() => setTearsPhase(2), 2000);
      
      // 사라지기 시작
      setTimeout(() => setTearsPhase(3), 4000);
      
      // 완전히 사라짐
      setTimeout(() => {
        setTearsVisible(false);
        setTearsPhase(0);
      }, 4500);
    }, 12000);

    // 초기 표시 (나방보다 늦게)
    setTimeout(() => {
      setTearsVisible(true);
      setTearsPhase(1);
    }, 4000);

    return () => clearInterval(tearsInterval);
  }, []);

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
    const chartHeight = containerHeight;
    canvas.width = rect.width * dpr;
    canvas.height = chartHeight * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${chartHeight}px`;
    ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const priceChartHeight = chartHeight - CANVAS_PADDING;
    
    // 배경 (캔버스는 반투명으로 칠해서 뒤 배경 이미지가 보이게)
    ctx.clearRect(0, 0, width, chartHeight);
    ctx.fillStyle = 'rgba(10, 10, 10, 0.35)';
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
    
    // 가격 범위 계산
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    displayCandles.forEach((c) => {
      minPrice = Math.min(minPrice, c.low);
      maxPrice = Math.max(maxPrice, c.high);
    });
    
    const priceRange = maxPrice - minPrice || 1;
    const pricePadding = priceRange * 0.1;
    const adjustedMin = minPrice - pricePadding;
    const adjustedMax = maxPrice + pricePadding;
    const adjustedRange = adjustedMax - adjustedMin;
    
    // Y축 그리드 및 가격 레이블 (사이버펑크 스타일)
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.15)';
    ctx.fillStyle = 'rgba(0, 255, 255, 0.7)';
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
    
    // 봉차트 그리기 (사이버펑크 스타일)
    const chartWidth = width - CANVAS_PADDING - 50;
    const candleWidth = Math.max(3, Math.floor(chartWidth / displayCandles.length) - 2);
    const candleSpacing = chartWidth / displayCandles.length;
    
    // === 변동성 급등 캔들 감지 ===
    const highVolatilityFlags = detectHighVolatilityCandles(displayCandles);
    
    // === 사이버펑크 스타일 봉차트 그리기 ===
    displayCandles.forEach((candle, index) => {
      const x = CANVAS_PADDING + (index * candleSpacing) + (candleSpacing / 2);
      const isUp = candle.close >= candle.open;
      const isHighVolatility = highVolatilityFlags[index];
      const isLastCandle = index === displayCandles.length - 1;
      
      // 사이버펑크 네온 색상
      const bullColor = isHighVolatility ? '#ffff00' : '#00ff88'; // 급등: 옐로우, 일반: 사이버 그린
      const bearColor = isHighVolatility ? '#ff6600' : '#ff0088'; // 급등: 오렌지, 일반: 사이버 핑크
      const color = isUp ? bullColor : bearColor;
      const glowColor = isUp 
        ? (isHighVolatility ? 'rgba(255, 255, 0, 0.6)' : 'rgba(0, 255, 136, 0.5)') 
        : (isHighVolatility ? 'rgba(255, 102, 0, 0.6)' : 'rgba(255, 0, 136, 0.5)');
      
      // === 가격 봉 ===
      const openY = CANVAS_PADDING / 2 + ((adjustedMax - candle.open) / adjustedRange) * priceChartHeight;
      const closeY = CANVAS_PADDING / 2 + ((adjustedMax - candle.close) / adjustedRange) * priceChartHeight;
      const highY = CANVAS_PADDING / 2 + ((adjustedMax - candle.high) / adjustedRange) * priceChartHeight;
      const lowY = CANVAS_PADDING / 2 + ((adjustedMax - candle.low) / adjustedRange) * priceChartHeight;
      
      // 네온 글로우 효과
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = isLastCandle ? 15 : (isHighVolatility ? 12 : 8);
      
      // 심지 그리기 (네온 스타일)
      ctx.strokeStyle = color;
      ctx.lineWidth = isLastCandle ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(x, highY);
      ctx.lineTo(x, lowY);
      ctx.stroke();
      
      // 몸통 그리기 (네온 글로우 + 그라데이션)
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(2, Math.abs(closeY - openY));
      
      // 그라데이션 몸통
      const gradient = ctx.createLinearGradient(x - candleWidth / 2, bodyTop, x + candleWidth / 2, bodyTop + bodyHeight);
      if (isUp) {
        gradient.addColorStop(0, isHighVolatility ? '#ffff00' : '#00ff88');
        gradient.addColorStop(0.5, isHighVolatility ? '#cccc00' : '#00cc66');
        gradient.addColorStop(1, isHighVolatility ? '#ffff00' : '#00ff88');
      } else {
        gradient.addColorStop(0, isHighVolatility ? '#ff6600' : '#ff0088');
        gradient.addColorStop(0.5, isHighVolatility ? '#cc4400' : '#cc0066');
        gradient.addColorStop(1, isHighVolatility ? '#ff6600' : '#ff0088');
      }
      
      ctx.fillStyle = gradient;
      ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
      
      // 몸통 테두리 (더 선명한 네온 효과)
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
      
      // 글로우 리셋
      ctx.shadowBlur = 0;
    });
    
    // (MACD 제거됨)
    
    // 진입가 표시 (녹색 점선)
    if (entryPrice && entryPrice >= adjustedMin && entryPrice <= adjustedMax) {
      const entryY = CANVAS_PADDING / 2 + ((adjustedMax - entryPrice) / adjustedRange) * priceChartHeight;
      
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.8)'; // green-500
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(CANVAS_PADDING, entryY);
      ctx.lineTo(width - 50, entryY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // 진입가 라벨
      ctx.fillStyle = 'rgba(34, 197, 94, 0.9)';
      ctx.fillRect(width - 48, entryY - 8, 46, 16);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('진입', width - 25, entryY + 3);
    }
    
    // 손절가 표시 (빨간색 점선)
    if (stopLossPrice && stopLossPrice >= adjustedMin && stopLossPrice <= adjustedMax) {
      const slY = CANVAS_PADDING / 2 + ((adjustedMax - stopLossPrice) / adjustedRange) * priceChartHeight;
      
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)'; // red-500
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(CANVAS_PADDING, slY);
      ctx.lineTo(width - 50, slY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // 손절가 라벨
      ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
      ctx.fillRect(width - 48, slY - 8, 46, 16);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SL', width - 25, slY + 3);
    }
    
    // 익절가 1단계 표시 (노란색/금색 점선)
    if (takeProfitPrice && takeProfitPrice >= adjustedMin && takeProfitPrice <= adjustedMax) {
      const tpY = CANVAS_PADDING / 2 + ((adjustedMax - takeProfitPrice) / adjustedRange) * priceChartHeight;
      
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)'; // amber-400
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(CANVAS_PADDING, tpY);
      ctx.lineTo(width - 50, tpY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // 익절가 라벨
      ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
      ctx.fillRect(width - 48, tpY - 8, 46, 16);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('TP', width - 25, tpY + 3);
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
    
  }, [candles, containerHeight, isConnected, loading, visibleCount, entryPrice, stopLossPrice, takeProfitPrice]);
  
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
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      {/* 사이버펑크 배경 이미지 */}
      <div 
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${cyberpunkGirl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center right',
          opacity: 0.40,
        }}
      />
      {/* 그라데이션 오버레이 */}
      <div 
        className="absolute inset-0 z-0"
        style={{
          background: 'linear-gradient(135deg, rgba(10,10,10,0.25) 0%, rgba(10,10,20,0.15) 50%, rgba(10,10,10,0.25) 100%)',
        }}
      />
      
      {/* 사이버 눈물 효과 - 일러스트 눈 위치 */}
      {tearsVisible && (
        <div 
          className="absolute z-[3] pointer-events-none"
          style={{
            right: '22%',
            top: '28%',
            opacity: tearsPhase === 0 ? 0 : tearsPhase === 3 ? 0 : 1,
            transition: 'opacity 0.5s ease-out',
          }}
        >
          {/* 왼쪽 눈 눈물 */}
          <div className="relative">
            {/* 눈물 방울 1 */}
            <div 
              className="absolute w-[3px] rounded-full"
              style={{
                left: '0px',
                height: tearsPhase >= 1 ? '40px' : '0px',
                background: 'linear-gradient(to bottom, transparent, #00ffff, #ff00ff, transparent)',
                boxShadow: '0 0 8px #00ffff, 0 0 15px #00ffff',
                transition: 'height 2s ease-out',
                animation: tearsPhase >= 1 ? 'tearDrop 2s ease-in-out infinite' : 'none',
              }}
            />
            {/* 눈물 방울 2 - 약간 지연 */}
            <div 
              className="absolute w-[2px] rounded-full"
              style={{
                left: '8px',
                height: tearsPhase >= 2 ? '30px' : '0px',
                background: 'linear-gradient(to bottom, transparent, #ff00ff, #00ffff, transparent)',
                boxShadow: '0 0 6px #ff00ff, 0 0 12px #ff00ff',
                transition: 'height 1.5s ease-out',
                animation: tearsPhase >= 2 ? 'tearDrop 2.5s ease-in-out infinite 0.5s' : 'none',
              }}
            />
            {/* 눈물 파티클 */}
            {tearsPhase >= 1 && (
              <div className="absolute top-10 left-0 flex flex-col gap-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-1 h-1 rounded-full"
                    style={{
                      background: i % 2 === 0 ? '#00ffff' : '#ff00ff',
                      boxShadow: `0 0 4px ${i % 2 === 0 ? '#00ffff' : '#ff00ff'}`,
                      animation: `tearParticle ${1.5 + i * 0.3}s ease-in-out infinite ${i * 0.2}s`,
                      opacity: 0.8,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* 飛蛾赴火 사이버 나방 효과 (우측 상단 가로 배치) */}
      {mothVisible && (
        <div 
          className="absolute right-[170px] top-[120px] z-[5] flex items-center gap-5 pointer-events-none"
          style={{
            opacity: mothPhase === 0 ? 0 : mothPhase === 1 ? 1 : 0,
            transform: `scale(${mothPhase === 1 ? 1 : 0.9})`,
            transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
          }}
        >
          {/* 사이버펑크 나방 SVG */}
          <div 
            className="relative"
            style={{
              animation: 'float 2.5s ease-in-out infinite',
            }}
          >
            <svg 
              width="56" 
              height="56" 
              viewBox="0 0 100 100" 
              className="drop-shadow-lg"
              style={{
                filter: 'drop-shadow(0 0 20px #ff6600) drop-shadow(0 0 40px #ff4400) drop-shadow(0 0 8px #00ffff)',
              }}
            >
              {/* 기계적 몸통 - 육각형 */}
              <polygon points="50,32 56,40 56,60 50,68 44,60 44,40" fill="#1a1a2e" stroke="#ff6600" strokeWidth="1.5" />
              <line x1="50" y1="35" x2="50" y2="65" stroke="#ff4400" strokeWidth="1" opacity="0.8" />
              
              {/* 코어 발광 */}
              <circle cx="50" cy="50" r="4" fill="#ff4400">
                <animate attributeName="opacity" values="1;0.5;1" dur="0.5s" repeatCount="indefinite" />
              </circle>
              <circle cx="50" cy="50" r="6" fill="none" stroke="#ff6600" strokeWidth="0.5" opacity="0.6" />
              
              {/* 왼쪽 날개 - 날카로운 기계 날개 */}
              <g style={{ transformOrigin: '44px 50px', animation: 'wingFlap 0.12s ease-in-out infinite alternate' }}>
                <polygon 
                  points="44,42 10,25 5,50 10,75 44,58" 
                  fill="url(#cyberWingGradient)" 
                  stroke="#00ffff" 
                  strokeWidth="0.5"
                  opacity="0.9"
                />
                {/* 날개 회로 패턴 */}
                <line x1="40" y1="45" x2="15" y2="35" stroke="#00ffff" strokeWidth="0.5" opacity="0.7" />
                <line x1="40" y1="50" x2="10" y2="50" stroke="#00ffff" strokeWidth="0.5" opacity="0.7" />
                <line x1="40" y1="55" x2="15" y2="65" stroke="#00ffff" strokeWidth="0.5" opacity="0.7" />
                {/* 날개 노드 */}
                <circle cx="20" cy="40" r="2" fill="#ff00ff" opacity="0.8">
                  <animate attributeName="opacity" values="0.8;0.3;0.8" dur="0.8s" repeatCount="indefinite" />
                </circle>
                <circle cx="15" cy="55" r="2" fill="#00ffff" opacity="0.8">
                  <animate attributeName="opacity" values="0.3;0.8;0.3" dur="0.8s" repeatCount="indefinite" />
                </circle>
              </g>
              
              {/* 오른쪽 날개 - 날카로운 기계 날개 */}
              <g style={{ transformOrigin: '56px 50px', animation: 'wingFlap 0.12s ease-in-out infinite alternate-reverse' }}>
                <polygon 
                  points="56,42 90,25 95,50 90,75 56,58" 
                  fill="url(#cyberWingGradient)" 
                  stroke="#00ffff" 
                  strokeWidth="0.5"
                  opacity="0.9"
                />
                {/* 날개 회로 패턴 */}
                <line x1="60" y1="45" x2="85" y2="35" stroke="#00ffff" strokeWidth="0.5" opacity="0.7" />
                <line x1="60" y1="50" x2="90" y2="50" stroke="#00ffff" strokeWidth="0.5" opacity="0.7" />
                <line x1="60" y1="55" x2="85" y2="65" stroke="#00ffff" strokeWidth="0.5" opacity="0.7" />
                {/* 날개 노드 */}
                <circle cx="80" cy="40" r="2" fill="#ff00ff" opacity="0.8">
                  <animate attributeName="opacity" values="0.8;0.3;0.8" dur="0.8s" repeatCount="indefinite" />
                </circle>
                <circle cx="85" cy="55" r="2" fill="#00ffff" opacity="0.8">
                  <animate attributeName="opacity" values="0.3;0.8;0.3" dur="0.8s" repeatCount="indefinite" />
                </circle>
              </g>
              
              {/* 기계 더듬이 - 안테나 스타일 */}
              <line x1="47" y1="35" x2="35" y2="15" stroke="#ff6600" strokeWidth="1.5" />
              <line x1="53" y1="35" x2="65" y2="15" stroke="#ff6600" strokeWidth="1.5" />
              <polygon points="35,15 32,10 38,10" fill="#ff4400" />
              <polygon points="65,15 62,10 68,10" fill="#ff4400" />
              {/* 안테나 신호 */}
              <circle cx="35" cy="12" r="3" fill="none" stroke="#ff4400" strokeWidth="0.5" opacity="0.5">
                <animate attributeName="r" values="3;6;3" dur="1s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="1s" repeatCount="indefinite" />
              </circle>
              <circle cx="65" cy="12" r="3" fill="none" stroke="#ff4400" strokeWidth="0.5" opacity="0.5">
                <animate attributeName="r" values="3;6;3" dur="1s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0;0.5" dur="1s" repeatCount="indefinite" />
              </circle>
              
              {/* 그라디언트 정의 */}
              <defs>
                <linearGradient id="cyberWingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ff6600" stopOpacity="0.8" />
                  <stop offset="30%" stopColor="#ff4400" stopOpacity="0.6" />
                  <stop offset="70%" stopColor="#cc2200" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#1a1a2e" stopOpacity="0.3" />
                </linearGradient>
              </defs>
            </svg>
            
            {/* 엔진 불꽃 이펙트 */}
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex gap-0.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div 
                  key={i}
                  className="rounded-sm"
                  style={{
                    width: i === 2 ? '3px' : '2px',
                    height: i === 2 ? '12px' : '8px',
                    background: `linear-gradient(to top, ${i === 2 ? '#ff4400' : '#ff6600'}, #ffcc00, transparent)`,
                    animation: `flameFlicker ${0.2 + i * 0.05}s ease-in-out infinite alternate`,
                    opacity: 0.9,
                  }}
                />
              ))}
            </div>
          </div>

          {/* 한자 문구 - 가로 배열 */}
          <div className="flex items-center gap-1.5">
            {['飛', '蛾', '赴', '火'].map((char, index) => (
              <span 
                key={char}
                className="text-3xl font-bold"
                style={{
                  color: index === 3 ? '#ff4400' : '#ff8844',
                  textShadow: `
                    0 0 5px ${index === 3 ? '#ff4400' : '#ff6600'},
                    0 0 15px ${index === 3 ? '#ff2200' : '#ff4400'},
                    0 0 30px ${index === 3 ? '#ff0000' : '#ff2200'},
                    0 0 50px ${index === 3 ? '#cc0000' : '#cc2200'}
                  `,
                }}
              >
                {char}
              </span>
            ))}
          </div>

          {/* 구분선 - 사이버 스타일 */}
          <div 
            className="w-px h-10 relative"
            style={{
              background: 'linear-gradient(to bottom, transparent, #00ffff, #ff6600, transparent)',
            }}
          >
            <div 
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rotate-45"
              style={{
                background: '#ff6600',
                boxShadow: '0 0 8px #ff6600',
              }}
            />
          </div>

          {/* 부제 */}
          <div className="flex flex-col items-start gap-0.5">
            <span 
              className="text-[10px] tracking-widest font-mono"
              style={{
                color: '#00ffff',
                textShadow: '0 0 5px #00ffff, 0 0 10px #00ffff',
              }}
            >
              INTO THE
            </span>
            <span 
              className="text-sm tracking-wider font-bold"
              style={{
                color: '#ff4400',
                textShadow: '0 0 8px #ff4400, 0 0 20px #ff2200',
              }}
            >
              FLAME
            </span>
          </div>
        </div>
      )}
      
      <canvas 
        ref={canvasRef} 
        className="w-full h-full absolute inset-0 z-10"
      />
      
      {/* 심볼명 + 현재가 (좌측 상단) */}
      <div className="absolute top-2 left-2 flex items-center gap-3 z-20">
        <span className="text-sm font-bold text-foreground drop-shadow-lg">
          {displaySymbol.replace('USDT', '')}
        </span>
        {currentPrice > 0 && (
          <span className={cn(
            "text-sm font-bold font-mono drop-shadow-lg",
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
      
      {/* 줌 컨트롤 + 분봉 정보 (중앙 상단) */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 z-20">
        <div className="flex items-center gap-1">
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
        <span className="text-[10px] text-muted-foreground font-mono bg-secondary/60 px-1.5 py-0.5 rounded">
          {getIntervalString(interval)} {visibleCount}봉
        </span>
      </div>
    </div>
  );
};

export default TickChart;