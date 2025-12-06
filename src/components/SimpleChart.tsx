import { useEffect, useState, useMemo, memo } from 'react';
import { fetchKlines, calculateBollingerBands, KlineData } from '@/lib/binance';
import { cn } from '@/lib/utils';

interface SimpleChartProps {
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

const SimpleChart = memo(({ symbol, interval = '1', height = 500 }: SimpleChartProps) => {
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const loadKlines = async () => {
      try {
        const binanceInterval = intervalMap[interval] || '1m';
        const data = await fetchKlines(symbol, binanceInterval, 60);
        if (mounted) {
          setKlines(data);
          setLoading(false);
        }
      } catch (error) {
        console.error('Failed to fetch klines:', error);
      }
    };

    loadKlines();
    const timer = setInterval(loadKlines, 500); // 500ms마다 업데이트

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [symbol, interval]);

  const chartData = useMemo(() => {
    if (klines.length < 20) return null;

    const bb = calculateBollingerBands(klines, 20, 2);
    const prices = klines.map(k => k.close);
    const minPrice = Math.min(...klines.map(k => Math.min(k.low, bb.lower)));
    const maxPrice = Math.max(...klines.map(k => Math.max(k.high, bb.upper)));
    const range = maxPrice - minPrice;
    const padding = range * 0.05;

    return {
      klines,
      bb,
      minPrice: minPrice - padding,
      maxPrice: maxPrice + padding,
      range: range + padding * 2,
      currentPrice: klines[klines.length - 1].close,
      isUp: klines[klines.length - 1].close >= klines[klines.length - 1].open,
    };
  }, [klines]);

  const getY = (price: number) => {
    if (!chartData) return 0;
    return ((chartData.maxPrice - price) / chartData.range) * 100;
  };

  if (loading || !chartData) {
    return (
      <div style={{ height }} className="bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const candleWidth = 100 / chartData.klines.length;

  return (
    <div style={{ height }} className="bg-[#0a0a0a] relative overflow-hidden">
      {/* Price info */}
      <div className="absolute top-2 left-2 z-20 flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground font-mono">{symbol}</span>
        <span className={cn(
          "text-sm font-bold font-mono",
          chartData.isUp ? "text-red-400" : "text-blue-400"
        )}>
          {chartData.currentPrice.toLocaleString()}
        </span>
      </div>

      {/* BB info */}
      <div className="absolute top-2 right-2 z-20 text-[9px] font-mono text-muted-foreground">
        <div>상단: <span className="text-amber-400">{chartData.bb.upper.toFixed(2)}</span></div>
        <div>중심: <span className="text-purple-400">{chartData.bb.middle.toFixed(2)}</span></div>
        <div>하단: <span className="text-amber-400">{chartData.bb.lower.toFixed(2)}</span></div>
      </div>

      {/* Chart area */}
      <div className="absolute inset-0 pt-8 pb-4 px-2">
        {/* Price grid lines */}
        {[0, 25, 50, 75, 100].map(pct => {
          const price = chartData.maxPrice - (chartData.range * pct / 100);
          return (
            <div
              key={pct}
              className="absolute left-0 right-8 border-t border-border/30"
              style={{ top: `${pct}%` }}
            >
              <span className="absolute right-0 -top-2 text-[8px] text-muted-foreground font-mono translate-x-full px-1">
                {price.toFixed(1)}
              </span>
            </div>
          );
        })}

        {/* Bollinger Bands - Upper */}
        <div
          className="absolute left-0 right-8 border-t border-amber-500/50 border-dashed"
          style={{ top: `${getY(chartData.bb.upper)}%` }}
        />
        
        {/* Bollinger Bands - Middle */}
        <div
          className="absolute left-0 right-8 border-t border-purple-500/50"
          style={{ top: `${getY(chartData.bb.middle)}%` }}
        />
        
        {/* Bollinger Bands - Lower */}
        <div
          className="absolute left-0 right-8 border-t border-amber-500/50 border-dashed"
          style={{ top: `${getY(chartData.bb.lower)}%` }}
        />

        {/* Current price line */}
        <div
          className="absolute left-0 right-8 border-t-2 border-yellow-400"
          style={{ top: `${getY(chartData.currentPrice)}%` }}
        >
          <span className="absolute right-0 -top-2 bg-yellow-400 text-black text-[8px] font-mono font-bold px-1 rounded translate-x-full">
            {chartData.currentPrice.toFixed(2)}
          </span>
        </div>

        {/* Candlesticks */}
        <div className="absolute inset-0 right-8 flex items-stretch">
          {chartData.klines.map((k, i) => {
            const isUp = k.close >= k.open;
            const bodyTop = getY(Math.max(k.open, k.close));
            const bodyBottom = getY(Math.min(k.open, k.close));
            const bodyHeight = Math.max(bodyBottom - bodyTop, 0.3);
            const wickTop = getY(k.high);
            const wickBottom = getY(k.low);

            return (
              <div
                key={i}
                className="relative"
                style={{ width: `${candleWidth}%` }}
              >
                {/* Wick */}
                <div
                  className={cn(
                    "absolute left-1/2 w-px -translate-x-1/2",
                    isUp ? "bg-red-400" : "bg-blue-400"
                  )}
                  style={{
                    top: `${wickTop}%`,
                    height: `${wickBottom - wickTop}%`,
                  }}
                />
                {/* Body */}
                <div
                  className={cn(
                    "absolute left-1/2 -translate-x-1/2 rounded-sm",
                    isUp ? "bg-red-400" : "bg-blue-400"
                  )}
                  style={{
                    top: `${bodyTop}%`,
                    height: `${bodyHeight}%`,
                    width: '60%',
                    minHeight: '2px',
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Volume bars */}
      <div className="absolute bottom-0 left-0 right-8 h-[15%] flex items-end px-2">
        {chartData.klines.map((k, i) => {
          const maxVol = Math.max(...chartData.klines.map(kl => kl.volume));
          const volHeight = (k.volume / maxVol) * 100;
          const isUp = k.close >= k.open;

          return (
            <div
              key={i}
              className="flex-1 flex justify-center"
            >
              <div
                className={cn(
                  "w-[60%] rounded-t-sm",
                  isUp ? "bg-red-400/40" : "bg-blue-400/40"
                )}
                style={{ height: `${volHeight}%` }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

SimpleChart.displayName = 'SimpleChart';

export default SimpleChart;
