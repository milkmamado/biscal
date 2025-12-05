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
  { label: '1시간', value: '60' },
  { label: '4시간', value: '240' },
  { label: '일봉', value: 'D' },
  { label: '주봉', value: 'W' },
  { label: '월봉', value: 'M' },
];

const DualChartPanel = ({ symbol }: DualChartPanelProps) => {
  const [leftInterval, setLeftInterval] = useState('1');
  const [rightInterval, setRightInterval] = useState('5');

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Top Chart */}
      <div className="bg-card border border-border rounded overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="px-2 py-1.5 bg-secondary/50 border-b border-border flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground mr-1">상단</span>
          {INTERVALS.map((int) => (
            <button
              key={`left-${int.value}`}
              onClick={() => setLeftInterval(int.value)}
              className={cn(
                "px-1.5 py-0.5 text-[10px] rounded transition-colors",
                leftInterval === int.value
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
            interval={leftInterval} 
            height={300}
          />
        </div>
      </div>

      {/* Bottom Chart */}
      <div className="bg-card border border-border rounded overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="px-2 py-1.5 bg-secondary/50 border-b border-border flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground mr-1">하단</span>
          {INTERVALS.map((int) => (
            <button
              key={`right-${int.value}`}
              onClick={() => setRightInterval(int.value)}
              className={cn(
                "px-1.5 py-0.5 text-[10px] rounded transition-colors",
                rightInterval === int.value
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
            interval={rightInterval} 
            height={300}
          />
        </div>
      </div>
    </div>
  );
};

export default DualChartPanel;
