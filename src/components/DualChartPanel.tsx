import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import TickChart from './TickChart';
import CyberPigeon from './CyberPigeon';
import { ScreeningLog } from './ScreeningLogPanel';

interface DualChartPanelProps {
  symbol: string;
  hasPosition?: boolean;
  entryPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  positionSide?: 'long' | 'short';
  onSelectSymbol?: (symbol: string) => void;
  screeningLogs?: ScreeningLog[];
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
  positionSide,
  screeningLogs = [],
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

  // 최근 5개 로그만 표시
  const recentLogs = screeningLogs.slice(0, 5);

  // 로그 타입별 색상
  const getLogColor = (type: ScreeningLog['type']): string => {
    switch (type) {
      case 'approve': return 'text-green-400';
      case 'reject': return 'text-red-400/70';
      case 'signal': return 'text-yellow-400';
      case 'start': return 'text-cyan-400';
      case 'complete': return 'text-purple-400';
      default: return 'text-gray-400';
    }
  };

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
            positionSide={hasPosition ? positionSide : undefined}
          />
        </div>
        
        {/* Cyber Pigeon Area - 네온 효과 강화 */}
        <div className="h-24 bg-gradient-to-b from-[#0a0a0a] via-[#0a0512] to-[#0d0d1a] border-t border-cyan-500/20 relative overflow-hidden shrink-0">
          {/* 강화된 네온 그라데이션 배경 */}
          <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-purple-500/5 to-pink-500/5" />
          
          {/* 네온 글로우 라인 - 상단 */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent" />
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-cyan-400/20 to-transparent blur-sm" />
          
          <CyberPigeon />
          
          {/* 🆕 스크리닝 로그 오버레이 - 우측 하단 */}
          {recentLogs.length > 0 && (
            <div className="absolute right-2 top-1 bottom-1 w-[55%] flex flex-col justify-end pointer-events-none">
              <div className="space-y-0.5 text-right">
                {recentLogs.map((log, idx) => (
                  <div 
                    key={log.id}
                    className={cn(
                      "text-[9px] font-mono truncate transition-opacity duration-300",
                      getLogColor(log.type),
                      idx === 0 ? "opacity-90" : idx === 1 ? "opacity-60" : "opacity-30"
                    )}
                    style={{
                      textShadow: idx === 0 ? '0 0 8px currentColor' : 'none',
                    }}
                  >
                    {log.symbol && (
                      <span className="text-cyan-300/80 mr-1">{log.symbol.replace('USDT', '')}</span>
                    )}
                    {log.message}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* 그리드 패턴 */}
          <div 
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: 'linear-gradient(rgba(0,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,255,0.3) 1px, transparent 1px)',
              backgroundSize: '20px 20px',
            }}
          />
          
          {/* 네온 글로우 라인 - 하단 */}
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-pink-500/40 to-transparent" />
        </div>
      </div>
    </div>
  );
};

export default DualChartPanel;
