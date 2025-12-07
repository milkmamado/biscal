import { useEffect, useState, useMemo, memo, useRef } from 'react';
import { fetchKlines, calculateBollingerBands, KlineData } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { ZoomIn, ZoomOut } from 'lucide-react';

interface SimpleChartProps {
  symbol: string;
  interval?: string;
  height?: number;
  onPriceRangeChange?: (range: { high: number; low: number }) => void;
}

interface SupportResistanceLevel {
  price: number;
  type: 'support' | 'resistance';
  strength: number; // 1-3 based on volume
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

// Detect support/resistance levels based on high volume candles
const detectSupportResistance = (klines: KlineData[], avgVolume: number): SupportResistanceLevel[] => {
  const levels: SupportResistanceLevel[] = [];
  const priceThreshold = 0.002; // 0.2% price clustering threshold
  
  klines.forEach((k, i) => {
    // Skip first and last candles
    if (i < 2 || i >= klines.length - 1) return;
    
    // Only consider high volume candles (> 2x average)
    const volumeRatio = k.volume / avgVolume;
    if (volumeRatio < 2) return;
    
    const isUp = k.close >= k.open;
    const strength = volumeRatio >= 4 ? 3 : volumeRatio >= 3 ? 2 : 1;
    
    // For bullish candles with high volume: low is potential support
    if (isUp) {
      levels.push({
        price: k.low,
        type: 'support',
        strength,
      });
    }
    // For bearish candles with high volume: high is potential resistance
    else {
      levels.push({
        price: k.high,
        type: 'resistance',
        strength,
      });
    }
  });
  
  // Cluster similar price levels
  const clustered: SupportResistanceLevel[] = [];
  const used = new Set<number>();
  
  levels.forEach((level, i) => {
    if (used.has(i)) return;
    
    const similar = levels.filter((l, j) => {
      if (used.has(j) || l.type !== level.type) return false;
      const diff = Math.abs(l.price - level.price) / level.price;
      return diff < priceThreshold;
    });
    
    if (similar.length > 0) {
      const avgPrice = similar.reduce((sum, l) => sum + l.price, 0) / similar.length;
      const maxStrength = Math.min(3, Math.max(...similar.map(l => l.strength)));
      clustered.push({
        price: avgPrice,
        type: level.type,
        strength: maxStrength,
      });
      similar.forEach((_, idx) => {
        const foundIdx = levels.findIndex((l, li) => !used.has(li) && l === similar[idx]);
        if (foundIdx >= 0) used.add(foundIdx);
      });
    } else {
      clustered.push(level);
    }
    used.add(i);
  });
  
  // Return only the strongest level of each type (max 1 each)
  const support = clustered.filter(l => l.type === 'support').sort((a, b) => b.strength - a.strength)[0];
  const resistance = clustered.filter(l => l.type === 'resistance').sort((a, b) => b.strength - a.strength)[0];
  
  return [support, resistance].filter(Boolean) as SupportResistanceLevel[];
};

const ZOOM_LEVELS = [30, 45, 60, 90, 120];

const SimpleChart = memo(({ symbol, interval = '1', height = 500, onPriceRangeChange }: SimpleChartProps) => {
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(true);
  const [zoomIndex, setZoomIndex] = useState(2); // Default 60 candles
  const candleCount = ZOOM_LEVELS[zoomIndex];

  useEffect(() => {
    let mounted = true;

    const loadKlines = async () => {
      try {
        const binanceInterval = intervalMap[interval] || '1m';
        // Fetch max candles, we'll slice based on zoom
        const data = await fetchKlines(symbol, binanceInterval, 120);
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
    // Slice klines based on zoom level
    const displayKlines = klines.slice(-candleCount);
    if (displayKlines.length < 20) return null;

    const avgVolume = displayKlines.reduce((sum, k) => sum + k.volume, 0) / displayKlines.length;
    const srLevels = detectSupportResistance(displayKlines, avgVolume);
    
    const allPrices = displayKlines.flatMap(k => [k.low, k.high]);
    const minPrice = Math.min(...allPrices);
    const maxPrice = Math.max(...allPrices);
    const range = maxPrice - minPrice;
    const padding = range * 0.1;

    return {
      klines: displayKlines,
      srLevels,
      avgVolume,
      minPrice: minPrice - padding,
      maxPrice: maxPrice + padding,
      range: range + padding * 2,
      currentPrice: klines[klines.length - 1].close,
      isUp: displayKlines[displayKlines.length - 1].close >= displayKlines[displayKlines.length - 1].open,
      maxVolume: Math.max(...displayKlines.map(k => k.volume)),
    };
  }, [klines, candleCount]);

  // Notify parent of price range changes - use refs to avoid infinite loops
  const lastRangeRef = useRef({ high: 0, low: 0 });
  useEffect(() => {
    if (chartData && onPriceRangeChange) {
      const newHigh = chartData.maxPrice;
      const newLow = chartData.minPrice;
      // Only call if values actually changed
      if (lastRangeRef.current.high !== newHigh || lastRangeRef.current.low !== newLow) {
        lastRangeRef.current.high = newHigh;
        lastRangeRef.current.low = newLow;
        onPriceRangeChange({ high: newHigh, low: newLow });
      }
    }
  }, [chartData?.maxPrice, chartData?.minPrice, onPriceRangeChange]);

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
          {/* Legend */}
          <div className="flex items-center gap-2 ml-2">
            <div className="flex items-center gap-0.5">
              <div className="w-2 h-0.5 bg-yellow-500" />
              <span className="text-[8px] text-muted-foreground">현재가</span>
            </div>
            <div className="flex items-center gap-0.5">
              <div className="w-2 h-0.5 bg-green-500/50" />
              <span className="text-[8px] text-muted-foreground">지지</span>
            </div>
            <div className="flex items-center gap-0.5">
              <div className="w-2 h-0.5 bg-red-500/50" />
              <span className="text-[8px] text-muted-foreground">저항</span>
            </div>
          </div>
        </div>
        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoomIndex(prev => Math.min(prev + 1, ZOOM_LEVELS.length - 1))}
            className="p-1 hover:bg-gray-800 rounded text-muted-foreground hover:text-foreground"
            title="축소 (더 많은 캔들)"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="text-[8px] text-muted-foreground w-6 text-center">{candleCount}</span>
          <button
            onClick={() => setZoomIndex(prev => Math.max(prev - 1, 0))}
            className="p-1 hover:bg-gray-800 rounded text-muted-foreground hover:text-foreground"
            title="확대 (더 적은 캔들)"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
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


          {/* Support/Resistance - 지지선 녹색, 저항선 빨강 */}
          {chartData.srLevels.map((level, i) => {
            const y = getY(level.price);
            if (y < 5 || y > 95) return null;
            
            const isSupport = level.type === 'support';
            
            return (
              <div key={`sr-${i}`} className="absolute left-0 right-0" style={{ top: `${y}%` }}>
                <div
                  className={cn(
                    "w-full border-t-2",
                    isSupport ? "border-green-500" : "border-red-500"
                  )}
                  style={{ borderStyle: 'dashed' }}
                />
              </div>
            );
          })}

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
            const volPct = Math.max((k.volume / chartData.maxVolume) * 100, 5);
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
