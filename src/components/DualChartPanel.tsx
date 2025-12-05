import { useState } from 'react';
import TradingViewChart from './TradingViewChart';
import { cn } from '@/lib/utils';

interface DualChartPanelProps {
  symbol: string;
  entryPrice?: number | null;
  positionType?: 'long' | 'short' | null;
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

const DualChartPanel = ({ symbol }: DualChartPanelProps) => {
  const [topInterval, setTopInterval] = useState('1');
  const [bottomInterval, setBottomInterval] = useState('5');

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
    </div>
  );
};

export default DualChartPanel;
