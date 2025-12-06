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
    const timer = setInterval(loadKlines, 500);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [symbol, interval]);

  const chartData = useMemo(() => {
    if (klines.length < 20) return null;

    const bb = calculateBollingerBands(klines, 20, 2);
    const minPrice = Math.min(...klines.map(k => Math.min(k.low, bb.lower)));
    const maxPrice = Math.max(...klines.map(k => Math.max(k.high, bb.upper)));
    const range = maxPrice - minPrice;
    const padding = range * 0.1;

    return {
      klines,
      bb,
      minPrice: minPrice - padding,
      maxPrice: maxPrice + padding,
      range: range + padding * 2,
      currentPrice: klines[klines.length - 1].close,
      isUp: klines[klines.length - 1].close >= klines[klines.length - 1].open,
      maxVolume: Math.max(...klines.map(k => k.volume)),
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

  const priceChartHeight = height * 0.75;
  const volumeChartHeight = height * 0.20;
  const headerHeight = height * 0.05;

  return (
    <div style={{ height }} className="bg-[#0a0a0a] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-2 shrink-0" style={{ height: headerHeight }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground font-mono">{symbol}</span>
          <span className={cn(
            "text-sm font-bold font-mono",
            chartData.isUp ? "text-red-400" : "text-blue-400"
          )}>
            {chartData.currentPrice.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[9px] font-mono">
          <span className="text-amber-400">상:{chartData.bb.upper.toFixed(1)}</span>
          <span className="text-purple-400">중:{chartData.bb.middle.toFixed(1)}</span>
          <span className="text-amber-400">하:{chartData.bb.lower.toFixed(1)}</span>
        </div>
      </div>

      {/* Price Chart */}
      <div className="relative flex-1" style={{ height: priceChartHeight }}>
        {/* Y-axis labels */}
        <div className="absolute right-0 top-0 bottom-0 w-12 flex flex-col justify-between py-1 text-[8px] font-mono text-muted-foreground">
          {[0, 25, 50, 75, 100].map(pct => (
            <span key={pct} className="text-right pr-1">
              {(chartData.maxPrice - (chartData.range * pct / 100)).toFixed(1)}
            </span>
          ))}
        </div>

        {/* Chart area */}
        <div className="absolute left-1 right-12 top-0 bottom-0">
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map(pct => (
            <div
              key={pct}
              className="absolute left-0 right-0 border-t border-gray-800"
              style={{ top: `${pct}%` }}
            />
          ))}

          {/* Bollinger Band fill */}
          <div 
            className="absolute left-0 right-0 bg-amber-500/10"
            style={{ 
              top: `${getY(chartData.bb.upper)}%`,
              height: `${getY(chartData.bb.lower) - getY(chartData.bb.upper)}%`
            }}
          />

          {/* Bollinger Bands lines */}
          <div
            className="absolute left-0 right-0 h-0.5 bg-amber-500"
            style={{ top: `${getY(chartData.bb.upper)}%` }}
          />
          <div
            className="absolute left-0 right-0 h-0.5 bg-purple-500"
            style={{ top: `${getY(chartData.bb.middle)}%` }}
          />
          <div
            className="absolute left-0 right-0 h-0.5 bg-amber-500"
            style={{ top: `${getY(chartData.bb.lower)}%` }}
          />

          {/* Current price line */}
          <div
            className="absolute left-0 right-0 h-0.5 bg-yellow-400 z-10"
            style={{ top: `${getY(chartData.currentPrice)}%` }}
          />

          {/* Candlesticks */}
          <div className="absolute inset-0 flex">
            {chartData.klines.map((k, i) => {
              const isUp = k.close >= k.open;
              const bodyTop = getY(Math.max(k.open, k.close));
              const bodyBottom = getY(Math.min(k.open, k.close));
              const bodyHeight = Math.max(bodyBottom - bodyTop, 0.5);
              const wickTop = getY(k.high);
              const wickBottom = getY(k.low);

              return (
                <div key={i} className="flex-1 relative">
                  {/* Wick */}
                  <div
                    className={cn(
                      "absolute left-1/2 w-px -translate-x-1/2",
                      isUp ? "bg-red-500" : "bg-blue-500"
                    )}
                    style={{
                      top: `${wickTop}%`,
                      height: `${Math.max(wickBottom - wickTop, 1)}%`,
                    }}
                  />
                  {/* Body */}
                  <div
                    className={cn(
                      "absolute left-1/2 -translate-x-1/2",
                      isUp ? "bg-red-500" : "bg-blue-500"
                    )}
                    style={{
                      top: `${bodyTop}%`,
                      height: `${bodyHeight}%`,
                      width: '70%',
                      minHeight: '2px',
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Volume Chart */}
      <div className="relative shrink-0 border-t border-gray-800" style={{ height: volumeChartHeight }}>
        <div className="absolute left-1 right-12 top-1 bottom-1 flex gap-px">
          {chartData.klines.map((k, i) => {
            const volPct = Math.max((k.volume / chartData.maxVolume) * 100, 5); // 최소 5%
            const isUp = k.close >= k.open;

            return (
              <div key={i} className="flex-1 flex flex-col justify-end">
                <div
                  className={cn(
                    "w-full rounded-t-sm",
                    isUp ? "bg-red-500/70" : "bg-blue-500/70"
                  )}
                  style={{ height: `${volPct}%` }}
                />
              </div>
            );
          })}
        </div>
        <span className="absolute right-1 top-0.5 text-[8px] text-muted-foreground">VOL</span>
      </div>
    </div>
  );
});

SimpleChart.displayName = 'SimpleChart';

export default SimpleChart;
