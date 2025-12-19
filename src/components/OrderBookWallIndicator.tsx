import { cn } from '@/lib/utils';
import { useOrderBookWall } from '@/hooks/useOrderBookWall';
import { formatPrice, formatVolume } from '@/lib/binance';
import { Shield, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

interface OrderBookWallIndicatorProps {
  symbol: string | null;
  enabled: boolean;
}

const OrderBookWallIndicator = ({ symbol, enabled }: OrderBookWallIndicatorProps) => {
  const { analysis, isConnected, lastUpdate } = useOrderBookWall(symbol, enabled);

  if (!symbol || !enabled || !analysis) {
    return null;
  }

  const timeSinceUpdate = Date.now() - lastUpdate;
  const isStale = timeSinceUpdate > 1000;

  return (
    <div className="px-4 py-3 border-b border-border bg-secondary/20">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Shield className={cn(
            "w-4 h-4",
            isConnected ? "text-green-500" : "text-muted-foreground"
          )} />
          <span className="text-xs text-muted-foreground font-medium">오더북 분석</span>
          {!isStale && (
            <span className="text-[10px] text-green-500 animate-pulse">●</span>
          )}
        </div>
        <span className={cn(
          "text-xs font-mono font-semibold",
          analysis.imbalance > 20 ? "text-red-400" :
          analysis.imbalance < -20 ? "text-blue-400" : "text-muted-foreground"
        )}>
          {analysis.imbalance > 0 ? '매수' : '매도'} {Math.abs(analysis.imbalance).toFixed(0)}%
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* 매수벽 */}
        <div className={cn(
          "p-2 rounded text-center border transition-colors duration-200",
          analysis.hasBuyWall 
            ? "bg-red-500/10 border-red-500/30" 
            : "bg-secondary/30 border-transparent"
        )}>
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-red-400" />
            <span className="text-[11px] text-muted-foreground">매수벽</span>
          </div>
          <div className="min-h-[32px] flex flex-col justify-center">
            {analysis.nearestBuyWall ? (
              <>
                <div className={cn(
                  "text-xs font-mono font-semibold",
                  analysis.nearestBuyWall.strength === 'strong' ? "text-red-400" :
                  analysis.nearestBuyWall.strength === 'medium' ? "text-orange-400" : "text-muted-foreground"
                )}>
                  ${formatPrice(analysis.nearestBuyWall.price)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {analysis.nearestBuyWall.percentFromCurrent.toFixed(2)}% ↓
                </div>
              </>
            ) : (
              <div className="text-[11px] text-muted-foreground">없음</div>
            )}
          </div>
        </div>

        {/* 매도벽 */}
        <div className={cn(
          "p-2 rounded text-center border transition-colors duration-200",
          analysis.hasSellWall 
            ? "bg-blue-500/10 border-blue-500/30" 
            : "bg-secondary/30 border-transparent"
        )}>
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <TrendingDown className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-[11px] text-muted-foreground">매도벽</span>
          </div>
          <div className="min-h-[32px] flex flex-col justify-center">
            {analysis.nearestSellWall ? (
              <>
                <div className={cn(
                  "text-xs font-mono font-semibold",
                  analysis.nearestSellWall.strength === 'strong' ? "text-blue-400" :
                  analysis.nearestSellWall.strength === 'medium' ? "text-cyan-400" : "text-muted-foreground"
                )}>
                  ${formatPrice(analysis.nearestSellWall.price)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {analysis.nearestSellWall.percentFromCurrent.toFixed(2)}% ↑
                </div>
              </>
            ) : (
              <div className="text-[11px] text-muted-foreground">없음</div>
            )}
          </div>
        </div>
      </div>

      {/* 벽 경고 - 고정 높이로 레이아웃 안정화 */}
      <div className="mt-2 h-5 flex items-center gap-1.5 text-[11px]">
        {(analysis.hasBuyWall || analysis.hasSellWall) ? (
          <>
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
            {analysis.nearestSellWall && analysis.nearestSellWall.percentFromCurrent < 0.5 && (
              <span className="text-yellow-400">근접 매도벽 - 롱 주의</span>
            )}
            {analysis.nearestBuyWall && analysis.nearestBuyWall.percentFromCurrent < 0.5 && (
              <span className="text-yellow-400">근접 매수벽 - 숏 주의</span>
            )}
            {/* 근접하지 않은 경우에도 표시 */}
            {(!analysis.nearestSellWall || analysis.nearestSellWall.percentFromCurrent >= 0.5) &&
             (!analysis.nearestBuyWall || analysis.nearestBuyWall.percentFromCurrent >= 0.5) && (
              <span className="text-muted-foreground">벽 감지됨</span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground/50">벽 없음</span>
        )}
      </div>
    </div>
  );
};

export default OrderBookWallIndicator;
