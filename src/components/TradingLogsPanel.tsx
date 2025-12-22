import { useState } from 'react';
import { Activity } from 'lucide-react';
import { LimitOrderTradeLog } from '@/hooks/useLimitOrderTrading';

interface TradingLogsPanelProps {
  tradeLogs: LimitOrderTradeLog[];
  krwRate: number;
  isEnabled: boolean;
  onSelectSymbol?: (symbol: string) => void;
}

export function TradingLogsPanel({
  tradeLogs,
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
          <span className="text-[10px] text-muted-foreground">({tradeLogs.length})</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {isCollapsed ? '▼' : '▲'}
        </span>
      </div>

      {!isCollapsed && (
        <div className="p-2">
          <div className="max-h-32 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-cyan-500/30 scrollbar-track-transparent">
            {tradeLogs.length === 0 ? (
              <div className="text-center py-3 text-xs text-muted-foreground">
                {isEnabled ? '🔍 시그널 대기 중...' : '자동매매를 시작하세요'}
              </div>
            ) : (
              tradeLogs.slice(0, 10).map((log) => (
                <TradeLogItem 
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

// Trade Log Item
const TradeLogItem = ({ log, krwRate, onSelectSymbol }: { 
  log: LimitOrderTradeLog; 
  krwRate: number;
  onSelectSymbol?: (symbol: string) => void;
}) => {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  
  const getActionIcon = () => {
    switch (log.action) {
      case 'order': return '📝';
      case 'fill': return '✅';
      case 'cancel': return '🚫';
      case 'tp': return '💰';
      case 'sl': return '🛑';
      case 'timeout': return '⏰';
      case 'error': return '❌';
      default: return '📋';
    }
  };
  
  const getActionColor = () => {
    switch (log.action) {
      case 'tp': case 'fill': return '#00ff88';
      case 'sl': case 'error': return '#ff0088';
      case 'order': case 'cancel': case 'timeout': return '#ffff00';
      default: return '#00ffff';
    }
  };
  
  const formatKRW = (usd: number) => {
    const krw = usd * krwRate;
    return krw.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };
  
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
        <span className="text-sm">{getActionIcon()}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono font-semibold" style={{ color: getActionColor() }}>
              {log.symbol.replace('USDT', '')}
            </span>
            <span className="text-[10px] text-gray-500">
              {log.side === 'long' ? '롱' : '숏'}
            </span>
          </div>
          {log.reason && (
            <div className="text-[9px] text-gray-500 truncate max-w-[120px]">
              {log.reason}
            </div>
          )}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        {log.pnl !== undefined && (
          <div className="text-[11px] font-mono font-semibold" style={{
            color: log.pnl >= 0 ? '#00ff88' : '#ff0088',
          }}>
            {log.pnl >= 0 ? '+' : ''}₩{formatKRW(log.pnl)}
          </div>
        )}
        <div className="text-[9px] text-gray-600">{formatTime(log.timestamp)}</div>
      </div>
    </div>
  );
};

export default TradingLogsPanel;
