import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useOrderBookWall } from '@/hooks/useOrderBookWall';
import { formatPrice } from '@/lib/binance';
import { Shield, TrendingUp, TrendingDown } from 'lucide-react';

interface OrderBookWallIndicatorProps {
  symbol: string | null;
  enabled: boolean;
}

const OrderBookWallIndicator = ({ symbol, enabled }: OrderBookWallIndicatorProps) => {
  const { analysis, isConnected, lastUpdate } = useOrderBookWall(symbol, enabled);
  
  // 디바운스된 분석 결과 (급격한 변화 방지)
  const [stableAnalysis, setStableAnalysis] = useState(analysis);
  const lastChangeRef = useRef(Date.now());
  
  useEffect(() => {
    if (!analysis) {
      setStableAnalysis(null);
      return;
    }
    
    // 벽 상태가 변경되면 최소 2초 후에만 UI 업데이트
    const hasWallChange = 
      stableAnalysis?.hasBuyWall !== analysis.hasBuyWall ||
      stableAnalysis?.hasSellWall !== analysis.hasSellWall;
    
    if (hasWallChange) {
      const timeSinceLastChange = Date.now() - lastChangeRef.current;
      if (timeSinceLastChange > 2000) {
        setStableAnalysis(analysis);
        lastChangeRef.current = Date.now();
      }
    } else {
      // 벽 상태 변화 없으면 바로 업데이트 (퍼센트, 가격 등)
      setStableAnalysis(analysis);
    }
  }, [analysis]);

  if (!symbol || !enabled || !stableAnalysis) {
    return null;
  }

  const timeSinceUpdate = Date.now() - lastUpdate;
  const isStale = timeSinceUpdate > 3000;

  return (
    <div className="px-4 py-3 border-b border-border bg-secondary/20">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Shield className={cn(
            "w-4 h-4 transition-colors duration-500",
            isConnected && !isStale ? "text-green-500" : "text-muted-foreground"
          )} />
          <span className="text-xs text-muted-foreground font-medium">오더북 분석</span>
          {!isStale && isConnected && (
            <span className="text-[10px] text-green-500/70">●</span>
          )}
        </div>
        <span className={cn(
          "text-xs font-mono font-semibold transition-colors duration-500",
          stableAnalysis.imbalance > 20 ? "text-red-400" :
          stableAnalysis.imbalance < -20 ? "text-blue-400" : "text-muted-foreground"
        )}>
          {stableAnalysis.imbalance > 0 ? '매수' : '매도'} {Math.abs(stableAnalysis.imbalance).toFixed(0)}%
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* 매수벽 */}
        <div className={cn(
          "p-2 rounded text-center border transition-all duration-500",
          stableAnalysis.hasBuyWall 
            ? "bg-red-500/10 border-red-500/20" 
            : "bg-secondary/30 border-transparent"
        )}>
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-red-400/70" />
            <span className="text-[11px] text-muted-foreground">매수벽</span>
          </div>
          <div className="min-h-[32px] flex flex-col justify-center">
            {stableAnalysis.nearestBuyWall ? (
              <>
                <div className="text-xs font-mono font-semibold text-red-400/80">
                  ${formatPrice(stableAnalysis.nearestBuyWall.price)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {stableAnalysis.nearestBuyWall.percentFromCurrent.toFixed(2)}% ↓
                </div>
              </>
            ) : (
              <div className="text-[11px] text-muted-foreground/50">-</div>
            )}
          </div>
        </div>

        {/* 매도벽 */}
        <div className={cn(
          "p-2 rounded text-center border transition-all duration-500",
          stableAnalysis.hasSellWall 
            ? "bg-blue-500/10 border-blue-500/20" 
            : "bg-secondary/30 border-transparent"
        )}>
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <TrendingDown className="w-3.5 h-3.5 text-blue-400/70" />
            <span className="text-[11px] text-muted-foreground">매도벽</span>
          </div>
          <div className="min-h-[32px] flex flex-col justify-center">
            {stableAnalysis.nearestSellWall ? (
              <>
                <div className="text-xs font-mono font-semibold text-blue-400/80">
                  ${formatPrice(stableAnalysis.nearestSellWall.price)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {stableAnalysis.nearestSellWall.percentFromCurrent.toFixed(2)}% ↑
                </div>
              </>
            ) : (
              <div className="text-[11px] text-muted-foreground/50">-</div>
            )}
          </div>
        </div>
      </div>

      {/* 벽 경고 - 심플하게 */}
      <div className="mt-2 h-4 flex items-center text-[10px] text-muted-foreground/60">
        {stableAnalysis.nearestSellWall && stableAnalysis.nearestSellWall.percentFromCurrent < 0.5 && (
          <span className="text-yellow-500/70">⚠ 근접 매도벽</span>
        )}
        {stableAnalysis.nearestBuyWall && stableAnalysis.nearestBuyWall.percentFromCurrent < 0.5 && (
          <span className="text-yellow-500/70">⚠ 근접 매수벽</span>
        )}
      </div>
    </div>
  );
};

export default OrderBookWallIndicator;
