import { useEffect, useRef, useState, memo } from 'react';
import { createChart, IChartApi } from 'lightweight-charts';
import { fetchKlines, calculateBollingerBands, KlineData } from '@/lib/binance';

interface LightweightChartProps {
  symbol: string;
  interval?: string;
  height?: number;
}

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

const LightweightChart = memo(({ symbol, interval = '1', height = 500 }: LightweightChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{
    candle: any;
    volume: any;
    upper: any;
    middle: any;
    lower: any;
  }>({ candle: null, volume: null, upper: null, middle: null, lower: null });
  const wsRef = useRef<WebSocket | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isChartReady, setIsChartReady] = useState(false);

  // Initialize chart - wait for container to have dimensions
  useEffect(() => {
    if (!containerRef.current) return;

    // Check container dimensions - this is critical!
    const initChart = () => {
      const container = containerRef.current;
      if (!container) return;

      const width = container.clientWidth;
      const containerHeight = height;

      // If container has no width, wait and retry
      if (width === 0) {
        console.log('Container width is 0, retrying...');
        setTimeout(initChart, 100);
        return;
      }

      console.log('Creating chart with dimensions:', width, containerHeight);

      try {
        // Create chart with explicit dimensions
        const chart = createChart(container, {
          width: width,
          height: containerHeight,
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

        // Add series
        seriesRef.current.candle = chart.addCandlestickSeries({
          upColor: '#ef4444',
          downColor: '#3b82f6',
          borderUpColor: '#ef4444',
          borderDownColor: '#3b82f6',
          wickUpColor: '#ef4444',
          wickDownColor: '#3b82f6',
        });

        seriesRef.current.volume = chart.addHistogramSeries({
          color: '#4b5563',
          priceFormat: { type: 'volume' },
          priceScaleId: 'volume',
        });
        chart.priceScale('volume').applyOptions({
          scaleMargins: { top: 0.85, bottom: 0 },
        });

        seriesRef.current.upper = chart.addLineSeries({
          color: '#f59e0b',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        seriesRef.current.middle = chart.addLineSeries({
          color: '#8b5cf6',
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        seriesRef.current.lower = chart.addLineSeries({
          color: '#f59e0b',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });

        setIsChartReady(true);
        setError(null);
        console.log('Chart created successfully');
      } catch (err) {
        console.error('Chart creation error:', err);
        setError('차트 생성 실패');
      }
    };

    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      initChart();
    });

    // Resize handler
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ 
          width: containerRef.current.clientWidth 
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        setIsChartReady(false);
      }
    };
  }, [height]);

  // Load data when chart is ready and symbol/interval changes
  useEffect(() => {
    if (!isChartReady || !seriesRef.current.candle) return;

    const binanceInterval = intervalMap[interval] || '1m';
    setIsLoading(true);
    setError(null);

    const loadData = async () => {
      try {
        const klines = await fetchKlines(symbol, binanceInterval, 200);

        const candleData = klines.map((k: KlineData) => ({
          time: Math.floor(k.openTime / 1000) as any,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
        }));

        const volumeData = klines.map((k: KlineData) => ({
          time: Math.floor(k.openTime / 1000) as any,
          value: k.volume,
          color: k.close >= k.open ? 'rgba(239, 68, 68, 0.3)' : 'rgba(59, 130, 246, 0.3)',
        }));

        // Bollinger Bands
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

        seriesRef.current.candle?.setData(candleData);
        seriesRef.current.volume?.setData(volumeData);
        seriesRef.current.upper?.setData(upperData);
        seriesRef.current.middle?.setData(middleData);
        seriesRef.current.lower?.setData(lowerData);

        chartRef.current?.timeScale().fitContent();
        setIsLoading(false);
      } catch (err) {
        console.error('Data load error:', err);
        setError('데이터 로딩 실패');
        setIsLoading(false);
      }
    };

    loadData();

    // WebSocket for real-time updates
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
          const k = data.k;
          seriesRef.current.candle?.update({
            time: Math.floor(k.t / 1000) as any,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
          });
          seriesRef.current.volume?.update({
            time: Math.floor(k.t / 1000) as any,
            value: parseFloat(k.v),
            color: parseFloat(k.c) >= parseFloat(k.o) 
              ? 'rgba(239, 68, 68, 0.3)' 
              : 'rgba(59, 130, 246, 0.3)',
          });
        }
      } catch (e) {
        // ignore
      }
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [symbol, interval, isChartReady]);

  if (error) {
    return (
      <div 
        style={{ width: '100%', height: `${height}px` }}
        className="flex items-center justify-center bg-card text-destructive text-sm"
      >
        {error}
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: `${height}px`, position: 'relative' }}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-card/80 z-10">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {/* Container with explicit dimensions */}
      <div 
        ref={containerRef} 
        style={{ width: '100%', height: `${height}px` }}
      />
    </div>
  );
});

LightweightChart.displayName = 'LightweightChart';

export default LightweightChart;
