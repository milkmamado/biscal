import { useEffect, useRef, useState, memo } from 'react';
import { createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, CandlestickData, LineData, Time, HistogramData } from 'lightweight-charts';
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

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    // Create chart
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: height,
      layout: {
        background: { type: ColorType.Solid, color: '#0a0a0a' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
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
    const upperBand = chart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 1,
      lineStyle: 0,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    upperBandRef.current = upperBand;

    const middleBand = chart.addLineSeries({
      color: '#8b5cf6',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    middleBandRef.current = middleBand;

    const lowerBand = chart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 1,
      lineStyle: 0,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    lowerBandRef.current = lowerBand;

    // Handle resize
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
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
        const candleData: CandlestickData<Time>[] = klines.map(k => ({
          time: (k.openTime / 1000) as Time,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
        }));

        const volumeData: HistogramData<Time>[] = klines.map(k => ({
          time: (k.openTime / 1000) as Time,
          value: k.volume,
          color: k.close >= k.open ? 'rgba(239, 68, 68, 0.3)' : 'rgba(59, 130, 246, 0.3)',
        }));

        // Calculate Bollinger Bands for each point
        const upperData: LineData<Time>[] = [];
        const middleData: LineData<Time>[] = [];
        const lowerData: LineData<Time>[] = [];

        for (let i = 19; i < klines.length; i++) {
          const slice = klines.slice(i - 19, i + 1);
          const bb = calculateBollingerBands(slice, 20, 2);
          const time = (klines[i].openTime / 1000) as Time;
          
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
      } catch (error) {
        console.error('Failed to fetch klines:', error);
        setIsLoading(false);
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
      const data = JSON.parse(event.data);
      if (data.k) {
        const kline = data.k;
        const candle: CandlestickData<Time> = {
          time: (kline.t / 1000) as Time,
          open: parseFloat(kline.o),
          high: parseFloat(kline.h),
          low: parseFloat(kline.l),
          close: parseFloat(kline.c),
        };
        
        candleSeriesRef.current?.update(candle);
        
        volumeSeriesRef.current?.update({
          time: (kline.t / 1000) as Time,
          value: parseFloat(kline.v),
          color: candle.close >= candle.open 
            ? 'rgba(239, 68, 68, 0.3)' 
            : 'rgba(59, 130, 246, 0.3)',
        });
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [symbol, interval]);

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
