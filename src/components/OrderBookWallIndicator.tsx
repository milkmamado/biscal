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
    <div className="px-4 py-2 border-b border-border bg-secondary/20">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Shield className={cn(
            "w-3 h-3",
            isConnected ? "text-green-500" : "text-muted-foreground"
          )} />
          <span className="text-[10px] text-muted-foreground">오더북 분석</span>
          {!isStale && (
            <span className="text-[8px] text-green-500 animate-pulse">●</span>
          )}
        </div>
        <span className={cn(
          "text-[10px] font-mono",
          analysis.imbalance > 20 ? "text-red-400" :
          analysis.imbalance < -20 ? "text-blue-400" : "text-muted-foreground"
        )}>
          {analysis.imbalance > 0 ? '매수' : '매도'} {Math.abs(analysis.imbalance).toFixed(0)}%
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* 매수벽 */}
        <div className={cn(
          "p-1.5 rounded text-center",
          analysis.hasBuyWall ? "bg-red-500/10 border border-red-500/30" : "bg-secondary/30"
        )}>
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <TrendingUp className="w-2.5 h-2.5 text-red-400" />
            <span className="text-[9px] text-muted-foreground">매수벽</span>
          </div>
          {analysis.nearestBuyWall ? (
            <>
              <div className={cn(
                "text-[10px] font-mono font-semibold",
                analysis.nearestBuyWall.strength === 'strong' ? "text-red-400" :
                analysis.nearestBuyWall.strength === 'medium' ? "text-orange-400" : "text-muted-foreground"
              )}>
                ${formatPrice(analysis.nearestBuyWall.price)}
              </div>
              <div className="text-[8px] text-muted-foreground">
                {analysis.nearestBuyWall.percentFromCurrent.toFixed(2)}% ↓
              </div>
            </>
          ) : (
            <div className="text-[9px] text-muted-foreground">없음</div>
          )}
        </div>

        {/* 매도벽 */}
        <div className={cn(
          "p-1.5 rounded text-center",
          analysis.hasSellWall ? "bg-blue-500/10 border border-blue-500/30" : "bg-secondary/30"
        )}>
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <TrendingDown className="w-2.5 h-2.5 text-blue-400" />
            <span className="text-[9px] text-muted-foreground">매도벽</span>
          </div>
          {analysis.nearestSellWall ? (
            <>
              <div className={cn(
                "text-[10px] font-mono font-semibold",
                analysis.nearestSellWall.strength === 'strong' ? "text-blue-400" :
                analysis.nearestSellWall.strength === 'medium' ? "text-cyan-400" : "text-muted-foreground"
              )}>
                ${formatPrice(analysis.nearestSellWall.price)}
              </div>
              <div className="text-[8px] text-muted-foreground">
                {analysis.nearestSellWall.percentFromCurrent.toFixed(2)}% ↑
              </div>
            </>
          ) : (
            <div className="text-[9px] text-muted-foreground">없음</div>
          )}
        </div>
      </div>

      {/* 벽 경고 */}
      {(analysis.hasBuyWall || analysis.hasSellWall) && (
        <div className="mt-1.5 flex items-center gap-1 text-[9px]">
          <AlertTriangle className="w-2.5 h-2.5 text-yellow-500" />
          {analysis.nearestSellWall && analysis.nearestSellWall.percentFromCurrent < 0.5 && (
            <span className="text-yellow-400">근접 매도벽 - 롱 주의</span>
          )}
          {analysis.nearestBuyWall && analysis.nearestBuyWall.percentFromCurrent < 0.5 && (
            <span className="text-yellow-400">근접 매수벽 - 숏 주의</span>
          )}
        </div>
      )}
    </div>
  );
};

export default OrderBookWallIndicator;
