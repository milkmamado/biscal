import { useEffect, useRef, memo } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, LineStyle, CandlestickSeries } from 'lightweight-charts';
import { fetchKlines } from '@/lib/binance';

interface LightweightChartProps {
  symbol: string;
  interval?: string;
  entryPrice?: number | null;
  positionType?: 'long' | 'short' | null;
}

const INTERVAL_MAP: Record<string, string> = {
  '1': '1m',
  '3': '3m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '60': '1h',
  '240': '4h',
  'D': '1d',
  'W': '1w',
  'M': '1M',
};

const LightweightChart = memo(({ 
  symbol, 
  interval = '1', 
  entryPrice = null,
  positionType = null 
}: LightweightChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const entryLineRef = useRef<any>(null);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#0a0a0a' },
        textColor: '#888',
      },
      grid: {
        vertLines: { color: '#1a1a1a' },
        horzLines: { color: '#1a1a1a' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#333',
      },
      timeScale: {
        borderColor: '#333',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#ef4444',
      downColor: '#3b82f6',
      borderUpColor: '#ef4444',
      borderDownColor: '#3b82f6',
      wickUpColor: '#ef4444',
      wickDownColor: '#3b82f6',
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Load data
  useEffect(() => {
    const loadData = async () => {
      if (!candleSeriesRef.current) return;

      try {
        const binanceInterval = INTERVAL_MAP[interval] || '1m';
        const klines = await fetchKlines(symbol, binanceInterval, 200);
        
        const candleData: CandlestickData[] = klines.map(k => ({
          time: (k.openTime / 1000) as any,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
        }));

        candleSeriesRef.current.setData(candleData);
      } catch (error) {
        console.error('Failed to load chart data:', error);
      }
    };

    loadData();
    const dataInterval = setInterval(loadData, 5000);

    return () => clearInterval(dataInterval);
  }, [symbol, interval]);

  // Update entry price line
  useEffect(() => {
    if (!candleSeriesRef.current) return;

    // Remove existing line
    if (entryLineRef.current) {
      candleSeriesRef.current.removePriceLine(entryLineRef.current);
      entryLineRef.current = null;
    }

    // Add new line if entry price exists
    if (entryPrice && positionType) {
      entryLineRef.current = candleSeriesRef.current.createPriceLine({
        price: entryPrice,
        color: '#22c55e',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: positionType === 'long' ? '롱 진입' : '숏 진입',
      });
    }
  }, [entryPrice, positionType]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full"
    />
  );
});

LightweightChart.displayName = 'LightweightChart';

export default LightweightChart;
