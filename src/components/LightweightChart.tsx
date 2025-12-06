import { useEffect, useRef, useState, memo } from 'react';
import { createChart, IChartApi, ISeriesApi } from 'lightweight-charts';
import { fetchKlines, calculateBollingerBands } from '@/lib/binance';

interface LightweightChartProps {
  symbol: string;
  interval?: string;
  height?: number;
}

// Convert interval to Binance format
const intervalMap: Record<string, string> = {
  '1': '1m',
  '3': '3m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '60': '1h',
  '240': '4h',
  'D': '1d',
};

const LightweightChart = memo(({ symbol, interval = '1', height = 600 }: LightweightChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const upperBandRef = useRef<ISeriesApi<'Line'> | null>(null);
  const middleBandRef = useRef<ISeriesApi<'Line'> | null>(null);
  const lowerBandRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    try {
      // Create chart
      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: height,
        layout: {
          background: { color: '#0a0a0a' },
          textColor: '#9ca3af',
        },
        grid: {
          vertLines: { color: '#1f2937' },
          horzLines: { color: '#1f2937' },
        },
        crosshair: {
          mode: 0,
          vertLine: { color: '#4b5563', width: 1, style: 2 },
          horzLine: { color: '#4b5563', width: 1, style: 2 },
        },
        rightPriceScale: {
          borderColor: '#374151',
          scaleMargins: { top: 0.1, bottom: 0.2 },
        },
        timeScale: {
          borderColor: '#374151',
          timeVisible: true,
          secondsVisible: false,
        },
      });

      chartRef.current = chart;

      // Add candlestick series
      const candleSeries = chart.addCandlestickSeries({
        upColor: '#ef4444',
        downColor: '#3b82f6',
        borderUpColor: '#ef4444',
        borderDownColor: '#3b82f6',
        wickUpColor: '#ef4444',
        wickDownColor: '#3b82f6',
      });
      candleSeriesRef.current = candleSeries;

      // Add volume series
      const volumeSeries = chart.addHistogramSeries({
        color: '#4b5563',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });
      volumeSeriesRef.current = volumeSeries;

      // Add Bollinger Bands
      upperBandRef.current = chart.addLineSeries({
        color: '#f59e0b',
        lineWidth: 1,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      middleBandRef.current = chart.addLineSeries({
        color: '#8b5cf6',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      lowerBandRef.current = chart.addLineSeries({
        color: '#f59e0b',
        lineWidth: 1,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: false,
      });

      // Handle resize
      const handleResize = () => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
        }
      };
      window.addEventListener('resize', handleResize);

      setError(null);

      return () => {
        window.removeEventListener('resize', handleResize);
        if (chartRef.current) {
          chartRef.current.remove();
          chartRef.current = null;
        }
      };
    } catch (err) {
      console.error('Chart initialization error:', err);
      setError('차트 초기화 실패');
    }
  }, [height]);

  // Fetch and update data when symbol or interval changes
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    const binanceInterval = intervalMap[interval] || '1m';
    setIsLoading(true);

    const fetchData = async () => {
      try {
        // Fetch 200 candles for Bollinger Bands calculation
        const klines = await fetchKlines(symbol, binanceInterval, 200);
        
        // Convert to chart format
        const candleData = klines.map(k => ({
          time: Math.floor(k.openTime / 1000) as any,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
        }));

        const volumeData = klines.map(k => ({
          time: Math.floor(k.openTime / 1000) as any,
          value: k.volume,
          color: k.close >= k.open ? 'rgba(239, 68, 68, 0.3)' : 'rgba(59, 130, 246, 0.3)',
        }));

        // Calculate Bollinger Bands for each point
        const upperData: any[] = [];
        const middleData: any[] = [];
        const lowerData: any[] = [];

        for (let i = 19; i < klines.length; i++) {
          const slice = klines.slice(i - 19, i + 1);
          const bb = calculateBollingerBands(slice, 20, 2);
          const time = Math.floor(klines[i].openTime / 1000);
          
          upperData.push({ time, value: bb.upper });
          middleData.push({ time, value: bb.middle });
          lowerData.push({ time, value: bb.lower });
        }

        // Set data
        candleSeriesRef.current?.setData(candleData);
        volumeSeriesRef.current?.setData(volumeData);
        upperBandRef.current?.setData(upperData);
        middleBandRef.current?.setData(middleData);
        lowerBandRef.current?.setData(lowerData);

        // Fit content
        chartRef.current?.timeScale().fitContent();
        setIsLoading(false);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch klines:', err);
        setIsLoading(false);
        setError('데이터 로딩 실패');
      }
    };

    fetchData();

    // Setup WebSocket for real-time updates
    if (wsRef.current) {
      wsRef.current.close();
    }

    const wsUrl = `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${binanceInterval}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.k) {
          const kline = data.k;
          const candle = {
            time: Math.floor(kline.t / 1000) as any,
            open: parseFloat(kline.o),
            high: parseFloat(kline.h),
            low: parseFloat(kline.l),
            close: parseFloat(kline.c),
          };
          
          candleSeriesRef.current?.update(candle);
          
          volumeSeriesRef.current?.update({
            time: Math.floor(kline.t / 1000) as any,
            value: parseFloat(kline.v),
            color: candle.close >= candle.open 
              ? 'rgba(239, 68, 68, 0.3)' 
              : 'rgba(59, 130, 246, 0.3)',
          });
        }
      } catch (e) {
        console.error('WebSocket message error:', e);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [symbol, interval]);

  if (error) {
    return (
      <div className="relative w-full h-full flex items-center justify-center bg-card">
        <div className="text-red-400 text-sm">{error}</div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-muted-foreground">차트 로딩중...</span>
          </div>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
});

LightweightChart.displayName = 'LightweightChart';

export default LightweightChart;
