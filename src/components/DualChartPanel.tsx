import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import TickChart from './TickChart';
import CyberPigeon from './CyberPigeon';

interface DualChartPanelProps {
  symbol: string;
  hasPosition?: boolean;
  entryPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  takeProfit2Price?: number;
  takeProfit3Price?: number;
  positionSide?: 'long' | 'short';
  onSelectSymbol?: (symbol: string) => void;
}

const INTERVALS = [
  { label: '1분', value: 60 },
  { label: '3분', value: 180 },
  { label: '5분', value: 300 },
  { label: '15분', value: 900 },
  { label: '30분', value: 1800 },
  { label: '1H', value: 3600 },
  { label: '4H', value: 14400 },
  { label: '일', value: 86400 },
];

const DualChartPanel = ({ 
  symbol, 
  hasPosition = false,
  entryPrice,
  stopLossPrice,
  takeProfitPrice,
  takeProfit2Price,
  takeProfit3Price,
  positionSide,
}: DualChartPanelProps) => {
  const [interval, setInterval] = useState(60);
  const prevSymbolRef = useRef<string>(symbol);

  // 심볼 변경 시 차트 분봉 자동 전환 (3분 → 1분)
  useEffect(() => {
    if (prevSymbolRef.current !== symbol) {
      prevSymbolRef.current = symbol;
      setInterval(180);
      const timer = setTimeout(() => setInterval(60), 200);
      return () => clearTimeout(timer);
    }
  }, [symbol]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Chart Area */}
      <div className="bg-card border border-border rounded overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="px-2 py-1 bg-secondary/50 border-b border-border flex items-center gap-0.5 flex-wrap shrink-0">
          {INTERVALS.map((int) => (
            <button
              key={int.value}
              onClick={() => setInterval(int.value)}
              className={cn(
                "px-1.5 py-0.5 text-[10px] rounded transition-colors",
                interval === int.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary hover:bg-secondary/80"
              )}
            >
              {int.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 relative">
          <TickChart 
            symbol={symbol}
            interval={interval}
            entryPrice={hasPosition ? entryPrice : undefined}
            stopLossPrice={hasPosition ? stopLossPrice : undefined}
            takeProfitPrice={hasPosition ? takeProfitPrice : undefined}
            takeProfit2Price={hasPosition ? takeProfit2Price : undefined}
            takeProfit3Price={hasPosition ? takeProfit3Price : undefined}
            positionSide={hasPosition ? positionSide : undefined}
          />
        </div>
        
        {/* Cyber Pigeon Area */}
        <div className="h-10 bg-gradient-to-b from-[#0a0a0a] to-[#0d0d1a] border-t border-cyan-500/10 relative overflow-hidden shrink-0">
          <CyberPigeon />
          <div 
            className="absolute inset-0 opacity-5"
            style={{
              backgroundImage: 'linear-gradient(rgba(0,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,255,0.1) 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default DualChartPanel;
