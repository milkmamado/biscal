import { useState, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import TradingViewChart from './TradingViewChart';
import { cn } from '@/lib/utils';
import { GripHorizontal } from 'lucide-react';

interface DualChartPanelProps {
  symbol: string;
  unrealizedPnL?: number;
  realizedPnL?: number;
  tradeCount?: number;
  winCount?: number;
  hasPosition?: boolean;
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

const KRW_RATE = 1380;

const LAYOUT_STORAGE_KEY = 'trading-panel-layout';

interface SavedLayout {
  topChartSize: number;
  bottomChartSize: number;
  balancePosition: 'top' | 'middle' | 'bottom';
}

const defaultLayout: SavedLayout = {
  topChartSize: 45,
  bottomChartSize: 45,
  balancePosition: 'bottom'
};

const DualChartPanel = ({ 
  symbol, 
  unrealizedPnL = 0, 
  realizedPnL = 0,
  tradeCount = 0,
  winCount = 0,
  hasPosition = false
}: DualChartPanelProps) => {
  const [topInterval, setTopInterval] = useState('1');
  const [bottomInterval, setBottomInterval] = useState('5');
  const [balance] = useState(1000);
  const [layout, setLayout] = useState<SavedLayout>(defaultLayout);

  // Load saved layout on mount
  useEffect(() => {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (saved) {
      try {
        setLayout(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse saved layout');
      }
    }
  }, []);

  // Save layout when it changes
  const handleLayoutChange = (sizes: number[]) => {
    const newLayout = {
      ...layout,
      topChartSize: sizes[0],
      bottomChartSize: sizes[1]
    };
    setLayout(newLayout);
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(newLayout));
  };

  const cycleBalancePosition = () => {
    const positions: ('top' | 'middle' | 'bottom')[] = ['top', 'middle', 'bottom'];
    const currentIndex = positions.indexOf(layout.balancePosition);
    const nextIndex = (currentIndex + 1) % positions.length;
    const newLayout = { ...layout, balancePosition: positions[nextIndex] };
    setLayout(newLayout);
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(newLayout));
  };

  const formatKRW = (usd: number) => {
    const krw = usd * KRW_RATE;
    return krw.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };

  const winRate = tradeCount > 0 ? ((winCount / tradeCount) * 100).toFixed(1) : '0.0';
  const totalPnL = unrealizedPnL + realizedPnL;

  const BalancePanel = () => (
    <div 
      className="bg-card border border-border rounded px-3 py-2 cursor-pointer hover:bg-card/80 transition-colors"
      onClick={cycleBalancePosition}
      title="클릭하여 위치 변경 (상단/중간/하단)"
    >
      <div className="flex items-center justify-between">
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
        
        {hasPosition && (
          <div className="flex flex-col items-center">
            <span className="text-[10px] text-muted-foreground">미실현</span>
            <span className={cn(
              "text-sm font-bold font-mono",
              unrealizedPnL >= 0 ? "text-red-400" : "text-blue-400"
            )}>
              {unrealizedPnL >= 0 ? '+' : ''}{unrealizedPnL.toFixed(2)}$
            </span>
          </div>
        )}
        
        <div className="flex flex-col items-center">
          <span className="text-[10px] text-muted-foreground">실현손익</span>
          <span className={cn(
            "text-sm font-bold font-mono",
            realizedPnL >= 0 ? "text-red-400" : "text-blue-400"
          )}>
            {realizedPnL >= 0 ? '+' : ''}{realizedPnL.toFixed(2)}$
          </span>
        </div>
        
        <div className="flex flex-col items-end">
          <span className="text-[10px] text-muted-foreground">당일 총손익</span>
          <div className="flex items-baseline gap-1">
            <span className={cn(
              "text-sm font-bold font-mono",
              totalPnL >= 0 ? "text-red-400" : "text-blue-400"
            )}>
              {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}$
            </span>
            <span className={cn(
              "text-[10px] font-mono",
              totalPnL >= 0 ? "text-red-400" : "text-blue-400"
            )}>
              (₩{formatKRW(totalPnL)})
            </span>
          </div>
        </div>

        <GripHorizontal className="w-4 h-4 text-muted-foreground/50" />
      </div>
      
      {tradeCount > 0 && (
        <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-[10px]">
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground">
              거래: <span className="text-foreground font-mono">{tradeCount}회</span>
            </span>
            <span className="text-muted-foreground">
              승: <span className="text-red-400 font-mono">{winCount}</span>
            </span>
            <span className="text-muted-foreground">
              패: <span className="text-blue-400 font-mono">{tradeCount - winCount}</span>
            </span>
          </div>
          <span className={cn(
            "font-bold",
            parseFloat(winRate) >= 50 ? "text-red-400" : "text-blue-400"
          )}>
            승률 {winRate}%
          </span>
        </div>
      )}
    </div>
  );

  const ChartPanel = ({ interval, setIntervalFn, chartKey }: { 
    interval: string; 
    setIntervalFn: (v: string) => void;
    chartKey: string;
  }) => (
    <div className="bg-card border border-border rounded overflow-hidden flex flex-col h-full">
      <div className="px-2 py-1 bg-secondary/50 border-b border-border flex items-center gap-0.5 flex-wrap shrink-0">
        {INTERVALS.map((int) => (
          <button
            key={`${chartKey}-${int.value}`}
            onClick={() => setIntervalFn(int.value)}
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
      <div className="flex-1 min-h-0">
        <TradingViewChart 
          symbol={symbol} 
          interval={interval}
          height={400}
        />
      </div>
    </div>
  );

  const ResizeHandle = () => (
    <PanelResizeHandle className="h-2 flex items-center justify-center group cursor-row-resize">
      <div className="w-12 h-1 bg-border rounded-full group-hover:bg-primary/50 transition-colors" />
    </PanelResizeHandle>
  );

  return (
    <div className="flex flex-col gap-1 h-full">
      {layout.balancePosition === 'top' && <BalancePanel />}
      
      <PanelGroup 
        direction="vertical" 
        onLayout={handleLayoutChange}
        className="flex-1"
      >
        <Panel defaultSize={layout.topChartSize} minSize={20}>
          <ChartPanel 
            interval={topInterval} 
            setIntervalFn={setTopInterval}
            chartKey="top"
          />
        </Panel>
        
        <ResizeHandle />
        
        {layout.balancePosition === 'middle' && (
          <>
            <Panel defaultSize={10} minSize={8} maxSize={15}>
              <BalancePanel />
            </Panel>
            <ResizeHandle />
          </>
        )}
        
        <Panel defaultSize={layout.bottomChartSize} minSize={20}>
          <ChartPanel 
            interval={bottomInterval} 
            setIntervalFn={setBottomInterval}
            chartKey="bottom"
          />
        </Panel>
      </PanelGroup>
      
      {layout.balancePosition === 'bottom' && <BalancePanel />}
    </div>
  );
};

export default DualChartPanel;