import { useState } from 'react';
import TradingViewChart from './TradingViewChart';
import { cn } from '@/lib/utils';

interface DualChartPanelProps {
  symbol: string;
}

const INTERVALS = [
  { label: '1분', value: '1' },
  { label: '3분', value: '3' },
  { label: '5분', value: '5' },
  { label: '15분', value: '15' },
  { label: '30분', value: '30' },
  { label: '1H', value: '60' },
  { label: '4H', value: '240' },
  { label: '일', value: 'D' },
];

const KRW_RATE = 1380; // USD to KRW

const DualChartPanel = ({ symbol }: DualChartPanelProps) => {
  const [topInterval, setTopInterval] = useState('1');
  const [bottomInterval, setBottomInterval] = useState('5');
  
  // Mock data - 실제로는 API나 상태관리에서 가져와야 함
  const [balance] = useState(1000); // USDT 잔고
  const [dailyPnL] = useState(0); // 당일 손익

  const formatKRW = (usd: number) => {
    const krw = usd * KRW_RATE;
    return krw.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };

  return (
    <div className="flex flex-col gap-1 h-full">
      {/* Top Chart */}
      <div className="bg-card border border-border rounded overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="px-2 py-1 bg-secondary/50 border-b border-border flex items-center gap-0.5 flex-wrap">
          {INTERVALS.map((int) => (
            <button
              key={`top-${int.value}`}
              onClick={() => setTopInterval(int.value)}
              className={cn(
                "px-1.5 py-0.5 text-[10px] rounded transition-colors",
                topInterval === int.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary hover:bg-secondary/80"
              )}
            >
              {int.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0">
          <TradingViewChart 
            symbol={symbol} 
            interval={topInterval}
            height={300}
          />
        </div>
      </div>

      {/* Bottom Chart */}
      <div className="bg-card border border-border rounded overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="px-2 py-1 bg-secondary/50 border-b border-border flex items-center gap-0.5 flex-wrap">
          {INTERVALS.map((int) => (
            <button
              key={`bottom-${int.value}`}
              onClick={() => setBottomInterval(int.value)}
              className={cn(
                "px-1.5 py-0.5 text-[10px] rounded transition-colors",
                bottomInterval === int.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary hover:bg-secondary/80"
              )}
            >
              {int.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0">
          <TradingViewChart 
            symbol={symbol} 
            interval={bottomInterval}
            height={300}
          />
        </div>
      </div>

      {/* Balance & Daily PnL Panel */}
      <div className="bg-card border border-border rounded px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground">잔고</span>
            <div className="flex items-baseline gap-1">
              <span className="text-sm font-bold font-mono text-foreground">
                ${balance.toFixed(2)}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                (₩{formatKRW(balance)})
              </span>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col items-end">
          <span className="text-[10px] text-muted-foreground">당일 손익</span>
          <div className="flex items-baseline gap-1">
            <span className={cn(
              "text-sm font-bold font-mono",
              dailyPnL >= 0 ? "text-red-400" : "text-blue-400"
            )}>
              {dailyPnL >= 0 ? '+' : ''}{dailyPnL.toFixed(2)}$
            </span>
            <span className={cn(
              "text-[10px] font-mono",
              dailyPnL >= 0 ? "text-red-400" : "text-blue-400"
            )}>
              ({dailyPnL >= 0 ? '+' : ''}₩{formatKRW(dailyPnL)})
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DualChartPanel;
