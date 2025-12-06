import { useEffect, useState, useRef, memo, useCallback } from 'react';
import { ComposedChart, Line, Bar, XAxis, YAxis, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { fetchKlines, calculateBollingerBands, KlineData } from '@/lib/binance';

interface RealtimeChartProps {
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
  isUp: boolean;
}

const RealtimeChart = memo(({ symbol, interval = '1', height = 500 }: RealtimeChartProps) => {
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);

  const processKlines = useCallback((klines: KlineData[]): ChartDataPoint[] => {
    return klines.map((k, i) => {
      const point: ChartDataPoint = {
        time: k.openTime,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
        isUp: k.close >= k.open,
      };

      if (i >= 19) {
        const slice = klines.slice(i - 19, i + 1);
        const bb = calculateBollingerBands(slice, 20, 2);
        point.upper = bb.upper;
        point.middle = bb.middle;
        point.lower = bb.lower;
      }

      return point;
    });
  }, []);

  const loadData = useCallback(async () => {
    const binanceInterval = intervalMap[interval] || '1m';
    setIsLoading(true);

    try {
      const klines = await fetchKlines(symbol, binanceInterval, 100);
      if (mountedRef.current) {
        setData(processKlines(klines));
        setIsLoading(false);
      }
    } catch (err) {
      console.error('Chart data load error:', err);
      if (mountedRef.current) setIsLoading(false);
    }
  }, [symbol, interval, processKlines]);

  useEffect(() => {
    mountedRef.current = true;
    loadData();

    return () => {
      mountedRef.current = false;
    };
  }, [loadData]);

  useEffect(() => {
    if (isLoading) return;

    const binanceInterval = intervalMap[interval] || '1m';
    
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@kline_${binanceInterval}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      
      try {
        const msg = JSON.parse(event.data);
        if (!msg.k) return;

        const k = msg.k;
        const newPoint: ChartDataPoint = {
          time: k.t,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          isUp: parseFloat(k.c) >= parseFloat(k.o),
        };

        setData(prev => {
          if (prev.length === 0) return prev;
          
          const updated = [...prev];
          const lastIdx = updated.length - 1;

          if (updated[lastIdx].time === newPoint.time) {
            // Update existing candle
            updated[lastIdx] = { ...updated[lastIdx], ...newPoint };
          } else if (newPoint.time > updated[lastIdx].time) {
            // New candle - calculate BB
            if (updated.length >= 19) {
              const recentKlines = updated.slice(-19).map(p => ({
                openTime: p.time,
                closeTime: p.time + 60000,
                open: p.open,
                high: p.high,
                low: p.low,
                close: p.close,
                volume: p.volume,
              }));
              recentKlines.push({
                openTime: newPoint.time,
                closeTime: newPoint.time + 60000,
                open: newPoint.open,
                high: newPoint.high,
                low: newPoint.low,
                close: newPoint.close,
                volume: newPoint.volume,
              });
              const bb = calculateBollingerBands(recentKlines, 20, 2);
              newPoint.upper = bb.upper;
              newPoint.middle = bb.middle;
              newPoint.lower = bb.lower;
            }
            updated.push(newPoint);
            if (updated.length > 100) updated.shift();
          }

          return updated;
        });
      } catch (e) {
        // Ignore
      }
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [symbol, interval, isLoading]);

  if (isLoading || data.length === 0) {
    return (
      <div style={{ width: '100%', height }} className="flex items-center justify-center bg-[#0a0a0a]">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const currentPrice = data[data.length - 1]?.close || 0;
  const prices = data.flatMap(d => [d.low, d.high, d.lower || d.low, d.upper || d.high]);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const padding = (maxPrice - minPrice) * 0.05;

  return (
    <div style={{ width: '100%', height }} className="bg-[#0a0a0a] relative">
      {/* Price info */}
      <div className="absolute top-1 left-2 z-10 text-[10px] font-mono">
        <span className="text-muted-foreground">{symbol}</span>
        <span className={`ml-2 font-bold ${data[data.length - 1]?.isUp ? 'text-red-400' : 'text-blue-400'}`}>
          {currentPrice.toLocaleString()}
        </span>
      </div>

      {/* Main chart */}
      <ResponsiveContainer width="100%" height={height * 0.78}>
        <ComposedChart data={data} margin={{ top: 20, right: 50, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="time"
            tickFormatter={(t) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
            stroke="#4b5563"
            fontSize={9}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minPrice - padding, maxPrice + padding]}
            orientation="right"
            stroke="#4b5563"
            fontSize={9}
            tickFormatter={(v) => v.toFixed(1)}
            tickLine={false}
            axisLine={false}
            width={45}
          />
          
          {/* Bollinger Bands */}
          <Line type="monotone" dataKey="upper" stroke="#f59e0b" dot={false} strokeWidth={1} isAnimationActive={false} />
          <Line type="monotone" dataKey="middle" stroke="#8b5cf6" dot={false} strokeWidth={1} isAnimationActive={false} />
          <Line type="monotone" dataKey="lower" stroke="#f59e0b" dot={false} strokeWidth={1} isAnimationActive={false} />
          
          {/* Price line */}
          <Line
            type="monotone"
            dataKey="close"
            stroke="#10b981"
            dot={false}
            strokeWidth={1.5}
            isAnimationActive={false}
          />

          {/* Current price reference */}
          <ReferenceLine y={currentPrice} stroke="#fbbf24" strokeDasharray="2 2" strokeWidth={1} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Volume chart */}
      <ResponsiveContainer width="100%" height={height * 0.18}>
        <ComposedChart data={data} margin={{ top: 0, right: 50, left: 0, bottom: 5 }}>
          <XAxis dataKey="time" hide />
          <YAxis hide />
          <Bar dataKey="volume" isAnimationActive={false}>
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.isUp ? 'rgba(239, 68, 68, 0.4)' : 'rgba(59, 130, 246, 0.4)'} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});

RealtimeChart.displayName = 'RealtimeChart';

export default RealtimeChart;
