import { useEffect, useState } from 'react';
import { fetchKlines, calculateBollingerBands, KlineData, BollingerBands, formatPrice } from '@/lib/binance';
import { cn } from '@/lib/utils';

interface BollingerChartProps {
  symbol: string;
}

const BollingerChart = ({ symbol }: BollingerChartProps) => {
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [bb, setBb] = useState<BollingerBands | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await fetchKlines(symbol, '5m', 50);
        setKlines(data);
        const bbData = calculateBollingerBands(data);
        setBb(bbData);
      } catch (error) {
        console.error('Failed to fetch klines:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [symbol]);

  if (loading) {
    return (
      <div className="bg-card rounded-lg border border-border p-4 h-64">
        <div className="h-full shimmer rounded" />
      </div>
    );
  }

  if (!bb || klines.length === 0) return null;

  // Calculate chart dimensions
  const prices = klines.map(k => [k.high, k.low]).flat();
  const minPrice = Math.min(...prices, bb.lower) * 0.999;
  const maxPrice = Math.max(...prices, bb.upper) * 1.001;
  const priceRange = maxPrice - minPrice;

  const chartWidth = 100;
  const chartHeight = 100;
  const candleWidth = chartWidth / klines.length;

  const scaleY = (price: number) => ((maxPrice - price) / priceRange) * chartHeight;

  // Position indicator
  const pricePosition = ((bb.currentPrice - bb.lower) / (bb.upper - bb.lower)) * 100;

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">볼린저 밴드</h3>
          <p className="text-xs text-muted-foreground">5분봉 · 20MA · 2σ</p>
        </div>
        <div className={cn(
          "text-xs font-medium px-2 py-1 rounded",
          bb.isAboveUpper ? "bg-ask/20 text-ask" : "bg-bid/20 text-bid"
        )}>
          {bb.isAboveUpper ? '상단 돌파' : '밴드 내'}
        </div>
      </div>

      {/* Mini Chart */}
      <div className="p-4">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-32">
          {/* Upper Band Line */}
          <line
            x1="0"
            y1={scaleY(bb.upper)}
            x2={chartWidth}
            y2={scaleY(bb.upper)}
            stroke="hsl(var(--ask))"
            strokeWidth="0.3"
            strokeDasharray="2,2"
            opacity="0.6"
          />
          
          {/* Middle Band Line */}
          <line
            x1="0"
            y1={scaleY(bb.middle)}
            x2={chartWidth}
            y2={scaleY(bb.middle)}
            stroke="hsl(var(--muted-foreground))"
            strokeWidth="0.3"
            strokeDasharray="2,2"
            opacity="0.4"
          />
          
          {/* Lower Band Line */}
          <line
            x1="0"
            y1={scaleY(bb.lower)}
            x2={chartWidth}
            y2={scaleY(bb.lower)}
            stroke="hsl(var(--bid))"
            strokeWidth="0.3"
            strokeDasharray="2,2"
            opacity="0.6"
          />

          {/* Candlesticks */}
          {klines.map((kline, i) => {
            const x = i * candleWidth + candleWidth / 2;
            const isGreen = kline.close >= kline.open;
            const color = isGreen ? 'hsl(var(--positive))' : 'hsl(var(--negative))';
            
            return (
              <g key={i}>
                {/* Wick */}
                <line
                  x1={x}
                  y1={scaleY(kline.high)}
                  x2={x}
                  y2={scaleY(kline.low)}
                  stroke={color}
                  strokeWidth="0.3"
                />
                {/* Body */}
                <rect
                  x={x - candleWidth * 0.3}
                  y={scaleY(Math.max(kline.open, kline.close))}
                  width={candleWidth * 0.6}
                  height={Math.max(1, Math.abs(scaleY(kline.open) - scaleY(kline.close)))}
                  fill={color}
                  rx="0.2"
                />
              </g>
            );
          })}

          {/* Current Price Line */}
          <line
            x1="0"
            y1={scaleY(bb.currentPrice)}
            x2={chartWidth}
            y2={scaleY(bb.currentPrice)}
            stroke="hsl(var(--primary))"
            strokeWidth="0.5"
          />
        </svg>
      </div>

      {/* BB Values */}
      <div className="px-4 py-3 bg-secondary/30 border-t border-border">
        <div className="grid grid-cols-4 gap-4 text-xs">
          <div>
            <p className="text-muted-foreground mb-1">상단</p>
            <p className="font-mono font-medium text-ask">${formatPrice(bb.upper)}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">중앙</p>
            <p className="font-mono font-medium">${formatPrice(bb.middle)}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">하단</p>
            <p className="font-mono font-medium text-bid">${formatPrice(bb.lower)}</p>
          </div>
          <div>
            <p className="text-muted-foreground mb-1">현재가</p>
            <p className={cn(
              "font-mono font-medium",
              bb.isAboveUpper ? "text-ask" : "text-foreground"
            )}>
              ${formatPrice(bb.currentPrice)}
            </p>
          </div>
        </div>

        {/* Position Bar */}
        <div className="mt-3">
          <div className="h-2 bg-secondary rounded-full overflow-hidden relative">
            <div 
              className="absolute left-0 h-full bg-gradient-to-r from-bid via-muted-foreground to-ask"
              style={{ width: '100%' }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-foreground rounded-full border-2 border-background shadow-lg transition-all"
              style={{ left: `calc(${Math.min(100, Math.max(0, pricePosition))}% - 6px)` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
            <span>하단</span>
            <span>중앙</span>
            <span>상단</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BollingerChart;
