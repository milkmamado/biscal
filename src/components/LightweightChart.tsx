import { useEffect, useState, memo } from 'react';
import { ComposedChart, Line, Bar, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from 'recharts';
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

interface ChartDataPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  upper?: number;
  middle?: number;
  lower?: number;
}

const LightweightChart = memo(({ symbol, interval = '1', height = 500 }: LightweightChartProps) => {
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let wsRef: WebSocket | null = null;

    const loadData = async () => {
      const binanceInterval = intervalMap[interval] || '1m';
      setIsLoading(true);

      try {
        const klines = await fetchKlines(symbol, binanceInterval, 100);

        if (!mounted) return;

        const chartData: ChartDataPoint[] = klines.map((k: KlineData, i: number) => {
          const point: ChartDataPoint = {
            time: k.openTime,
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
            volume: k.volume,
          };

          // Calculate Bollinger Bands for points with enough history
          if (i >= 19) {
            const slice = klines.slice(i - 19, i + 1);
            const bb = calculateBollingerBands(slice, 20, 2);
            point.upper = bb.upper;
            point.middle = bb.middle;
            point.lower = bb.lower;
          }

          return point;
        });

        setData(chartData);
        setError(null);
        setIsLoading(false);
      } catch (err) {
        console.error('Data load error:', err);
        if (mounted) {
          setError('차트 데이터 로드 실패');
          setIsLoading(false);
        }
      }
    };

    const setupWebSocket = () => {
      const binanceInterval = intervalMap[interval] || '1m';
      const ws = new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${binanceInterval}`);
      wsRef = ws;

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.k && mounted) {
            const k = message.k;
            const newPoint: ChartDataPoint = {
              time: k.t,
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: parseFloat(k.v),
            };

            setData(prev => {
              const updated = [...prev];
              const lastIndex = updated.length - 1;
              if (lastIndex >= 0 && updated[lastIndex].time === newPoint.time) {
                updated[lastIndex] = { ...updated[lastIndex], ...newPoint };
              } else if (lastIndex >= 0 && newPoint.time > updated[lastIndex].time) {
                // New candle
                if (updated.length >= 19) {
                  const slice = updated.slice(-19);
                  slice.push(newPoint);
                  const bb = calculateBollingerBands(
                    slice.map(p => ({ open: p.open, high: p.high, low: p.low, close: p.close, volume: p.volume, openTime: p.time, closeTime: p.time + 60000 })),
                    20, 2
                  );
                  newPoint.upper = bb.upper;
                  newPoint.middle = bb.middle;
                  newPoint.lower = bb.lower;
                }
                updated.push(newPoint);
                if (updated.length > 100) updated.shift();
              }
              return updated;
            });
          }
        } catch (e) {
          // Ignore parse errors
        }
      };
    };

    loadData().then(() => {
      if (mounted) setupWebSocket();
    });

    return () => {
      mounted = false;
      if (wsRef) wsRef.close();
    };
  }, [symbol, interval]);

  if (error) {
    return (
      <div style={{ width: '100%', height }} className="flex items-center justify-center bg-card text-destructive">
        {error}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ width: '100%', height }} className="flex items-center justify-center bg-card">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const currentPrice = data.length > 0 ? data[data.length - 1].close : 0;
  const minPrice = Math.min(...data.map(d => Math.min(d.low, d.lower || d.low)));
  const maxPrice = Math.max(...data.map(d => Math.max(d.high, d.upper || d.high)));
  const priceRange = maxPrice - minPrice;
  const domainMin = minPrice - priceRange * 0.05;
  const domainMax = maxPrice + priceRange * 0.05;

  return (
    <div style={{ width: '100%', height, position: 'relative' }} className="bg-[#0a0a0a]">
      <ResponsiveContainer width="100%" height={height * 0.75}>
        <ComposedChart data={data} margin={{ top: 10, right: 60, left: 0, bottom: 0 }}>
          <XAxis 
            dataKey="time" 
            tickFormatter={(t) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
            stroke="#6b7280"
            fontSize={10}
            tickLine={false}
          />
          <YAxis 
            domain={[domainMin, domainMax]}
            orientation="right"
            stroke="#6b7280"
            fontSize={10}
            tickFormatter={(v) => v.toLocaleString()}
            tickLine={false}
          />
          
          {/* Bollinger Bands */}
          <Line type="monotone" dataKey="upper" stroke="#f59e0b" dot={false} strokeWidth={1} />
          <Line type="monotone" dataKey="middle" stroke="#8b5cf6" dot={false} strokeWidth={1} />
          <Line type="monotone" dataKey="lower" stroke="#f59e0b" dot={false} strokeWidth={1} />
          
          {/* Candlestick approximation using high-low range */}
          <Line 
            type="monotone" 
            dataKey="close" 
            stroke="#10b981" 
            dot={false} 
            strokeWidth={2}
          />
          
          {/* Current price line */}
          <ReferenceLine y={currentPrice} stroke="#fbbf24" strokeDasharray="3 3" />
        </ComposedChart>
      </ResponsiveContainer>
      
      {/* Volume chart */}
      <ResponsiveContainer width="100%" height={height * 0.2}>
        <ComposedChart data={data} margin={{ top: 0, right: 60, left: 0, bottom: 10 }}>
          <XAxis dataKey="time" hide />
          <YAxis hide />
          <Bar 
            dataKey="volume" 
            fill="#4b5563"
            opacity={0.5}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Current price display */}
      <div className="absolute top-2 left-2 text-xs text-muted-foreground">
        {symbol} | {currentPrice.toLocaleString()}
      </div>
    </div>
  );
});

LightweightChart.displayName = 'LightweightChart';

export default LightweightChart;
