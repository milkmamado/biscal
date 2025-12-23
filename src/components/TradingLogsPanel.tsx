import { useState } from 'react';
import { Activity } from 'lucide-react';
import { DbTradeLog } from '@/hooks/useTradingLogs';

interface TradingLogsPanelProps {
  dbTradeLogs: DbTradeLog[];
  krwRate: number;
  isEnabled: boolean;
  onSelectSymbol?: (symbol: string) => void;
}

export function TradingLogsPanel({
  dbTradeLogs,
  krwRate,
  isEnabled,
  onSelectSymbol,
}: TradingLogsPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div 
      className="rounded-lg border border-border/50 overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)',
      }}
    >
      {/* Header */}
      <div 
        className="flex items-center justify-between px-3 py-2 cursor-pointer border-b border-border/30"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
          background: 'linear-gradient(90deg, rgba(0, 255, 255, 0.1) 0%, rgba(0, 200, 255, 0.05) 100%)',
        }}
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold text-foreground">매매 로그</span>
          <span className="text-[10px] text-muted-foreground">({dbTradeLogs.length})</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {isCollapsed ? '▼' : '▲'}
        </span>
      </div>

      {!isCollapsed && (
        <div className="p-2">
          <div className="max-h-32 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-cyan-500/30 scrollbar-track-transparent">
            {dbTradeLogs.length === 0 ? (
              <div className="text-center py-3 text-xs text-muted-foreground">
                {isEnabled ? '🔍 시그널 대기 중...' : '오늘 매매 기록이 없습니다'}
              </div>
            ) : (
              dbTradeLogs.slice(0, 10).map((log) => (
                <DbTradeLogItem 
                  key={log.id} 
                  log={log} 
                  krwRate={krwRate} 
                  onSelectSymbol={onSelectSymbol}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// DB Trade Log Item - 실제 체결된 거래 표시
const DbTradeLogItem = ({ log, krwRate, onSelectSymbol }: { 
  log: DbTradeLog; 
  krwRate: number;
  onSelectSymbol?: (symbol: string) => void;
}) => {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  
  const getActionColor = () => {
    return log.pnlUsd >= 0 ? '#00ff88' : '#ff0088';
  };
  
  const formatKRW = (usd: number) => {
    const krw = usd * krwRate;
    return krw.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };

  // 가격 변화율 계산
  const priceChange = log.side === 'long' 
    ? ((log.exitPrice - log.entryPrice) / log.entryPrice) * 100
    : ((log.entryPrice - log.exitPrice) / log.entryPrice) * 100;
  
  return (
    <div 
      className="flex items-center justify-between px-2 py-1.5 rounded cursor-pointer hover:bg-white/5 transition-colors"
      style={{
        background: 'rgba(0, 255, 255, 0.03)',
        borderLeft: `2px solid ${getActionColor()}`,
      }}
      onClick={() => onSelectSymbol?.(log.symbol)}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm">{log.pnlUsd >= 0 ? '💰' : '🛑'}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono font-semibold" style={{ color: getActionColor() }}>
              {log.symbol.replace('USDT', '')}
            </span>
            <span className="text-[10px] text-gray-500">
              {log.side === 'long' ? '롱' : '숏'}
            </span>
          </div>
          <div className="text-[9px] text-gray-500 truncate max-w-[120px]">
            {log.entryPrice.toFixed(2)} → {log.exitPrice.toFixed(2)} ({priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%)
          </div>
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-[11px] font-mono font-semibold" style={{
          color: log.pnlUsd >= 0 ? '#00ff88' : '#ff0088',
        }}>
          {log.pnlUsd >= 0 ? '+' : ''}₩{formatKRW(log.pnlUsd)}
        </div>
        <div className="text-[9px] text-gray-600">{formatTime(log.timestamp)}</div>
      </div>
    </div>
  );
};

export default TradingLogsPanel;