import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Bot, TrendingUp, TrendingDown, Activity, Clock, AlertTriangle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { AutoTradingState, AutoTradeLog } from '@/hooks/useAutoTrading';
import { formatPrice } from '@/lib/binance';

const LEVERAGE_OPTIONS = [1, 5, 10];

interface AutoTradingPanelProps {
  state: AutoTradingState;
  onToggle: () => void;
  onManualClose?: () => void;
  currentPrice?: number;
  krwRate: number;
  leverage: number;
  onLeverageChange: (leverage: number) => void;
  onSelectSymbol?: (symbol: string) => void;
}

const AutoTradingPanel = ({ 
  state, 
  onToggle, 
  onManualClose,
  currentPrice = 0,
  krwRate,
  leverage,
  onLeverageChange,
  onSelectSymbol,
}: AutoTradingPanelProps) => {
  const { isEnabled, isProcessing, currentPosition, pendingSignal, todayStats, tradeLogs, cooldownUntil } = state;
  
  // 쿨다운 타이머
  const [cooldownRemaining, setCooldownRemaining] = useState<string | null>(null);
  
  useEffect(() => {
    if (!cooldownUntil) {
      setCooldownRemaining(null);
      return;
    }
    
    const updateRemaining = () => {
      const remaining = cooldownUntil - Date.now();
      if (remaining <= 0) {
        setCooldownRemaining(null);
        return;
      }
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      setCooldownRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    };
    
    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil]);
  
  // 현재 포지션 PnL
  const currentPnL = useMemo(() => {
    if (!currentPosition || !currentPrice) return 0;
    const direction = currentPosition.side === 'long' ? 1 : -1;
    const priceDiff = (currentPrice - currentPosition.entryPrice) * direction;
    return priceDiff * currentPosition.quantity;
  }, [currentPosition, currentPrice]);
  
  const winRate = todayStats.trades > 0 
    ? ((todayStats.wins / todayStats.trades) * 100).toFixed(1) 
    : '0.0';
  
  const formatKRW = (usd: number) => {
    const krw = usd * krwRate;
    return krw.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };
  
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className={cn(
        "px-4 py-3 border-b border-border flex items-center justify-between",
        isEnabled ? "bg-green-500/10" : "bg-secondary/50"
      )}>
        <div className="flex items-center gap-2">
          <Bot className={cn(
            "w-5 h-5",
            isEnabled ? "text-green-500" : "text-muted-foreground"
          )} />
          <span className="font-semibold text-sm">자동매매</span>
          {isProcessing && (
            <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {cooldownRemaining && (
            <span className="text-[10px] text-yellow-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {cooldownRemaining}
            </span>
          )}
          <Switch
            checked={isEnabled}
            onCheckedChange={onToggle}
            className="data-[state=checked]:bg-green-500"
          />
        </div>
      </div>
      
      {/* Leverage Setting */}
      <div className="px-4 py-2 border-b border-border bg-secondary/30">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">레버리지</span>
          <div className="flex gap-1">
            {LEVERAGE_OPTIONS.map((lev) => (
              <button
                key={lev}
                onClick={() => onLeverageChange(lev)}
                disabled={isEnabled || !!currentPosition}
                className={cn(
                  "px-2 py-0.5 text-[10px] font-mono rounded transition-colors",
                  leverage === lev 
                    ? "bg-primary text-primary-foreground" 
                    : "bg-secondary hover:bg-secondary/80",
                  (isEnabled || currentPosition) && "opacity-50 cursor-not-allowed"
                )}
              >
                {lev}x
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Today Stats */}
      <div className="px-4 py-3 border-b border-border bg-secondary/20">
        <div className="grid grid-cols-4 gap-2 text-center">
          <div>
            <p className="text-[10px] text-muted-foreground">거래</p>
            <p className="text-sm font-bold font-mono">{todayStats.trades}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">승/패</p>
            <p className="text-sm font-bold font-mono">
              <span className="text-green-500">{todayStats.wins}</span>
              /
              <span className="text-red-500">{todayStats.losses}</span>
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">승률</p>
            <p className={cn(
              "text-sm font-bold font-mono",
              parseFloat(winRate) >= 50 ? "text-green-500" : "text-red-500"
            )}>
              {winRate}%
            </p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">손익</p>
            <p className={cn(
              "text-sm font-bold font-mono",
              todayStats.totalPnL >= 0 ? "text-green-500" : "text-red-500"
            )}>
              {todayStats.totalPnL >= 0 ? '+' : ''}₩{formatKRW(todayStats.totalPnL)}
            </p>
          </div>
        </div>
      </div>
      
      {/* Pending Signal */}
      {pendingSignal && !currentPosition && (
        <div className="px-4 py-3 border-b border-border bg-yellow-500/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-yellow-500 animate-pulse" />
              <span className="font-semibold text-sm text-yellow-500">
                {pendingSignal.symbol} {pendingSignal.touchType === 'upper' ? '숏' : '롱'} 대기
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground">
              봉 완성 대기 중
            </span>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            BB {pendingSignal.touchType === 'upper' ? '상단' : '하단'} 터치 @ ${pendingSignal.signalPrice.toFixed(2)}
          </div>
        </div>
      )}
      
      {/* Current Position */}
      {currentPosition && (
        <div className={cn(
          "px-4 py-3 border-b border-border",
          currentPosition.side === 'long' ? "bg-red-500/5" : "bg-blue-500/5"
        )}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {currentPosition.side === 'long' ? (
                <TrendingUp className="w-4 h-4 text-red-500" />
              ) : (
                <TrendingDown className="w-4 h-4 text-blue-500" />
              )}
              <span className="font-semibold text-sm">
                {currentPosition.symbol.replace('USDT', '')} {currentPosition.side === 'long' ? '롱' : '숏'}
              </span>
            </div>
            <span className={cn(
              "text-sm font-bold font-mono",
              currentPnL >= 0 ? "text-green-500" : "text-red-500"
            )}>
              {currentPnL >= 0 ? '+' : ''}₩{formatKRW(currentPnL)}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>진입가: ${formatPrice(currentPosition.entryPrice)}</span>
            <span>TP: {state.tpPercent.toFixed(2)}%</span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-0.5">
            <span>수량: {currentPosition.quantity.toFixed(4)}</span>
            <span>SL: 봉기준</span>
          </div>
          {onManualClose && (
            <Button
              variant="destructive"
              size="sm"
              onClick={onManualClose}
              className="w-full mt-2 h-7 text-xs"
              disabled={isProcessing}
            >
              수동 청산
            </Button>
          )}
        </div>
      )}
      
      {/* Trade Logs */}
      <div className="px-2 py-2 flex flex-col min-h-0">
        <div className="flex items-center gap-1 px-2 mb-2">
          <Activity className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">매매 로그</span>
        </div>
        <div className="overflow-y-auto space-y-1 max-h-[150px]">
          {tradeLogs.length === 0 ? (
            <div className="text-center py-4 text-[11px] text-muted-foreground">
              {isEnabled ? 'BB 시그널 대기 중...' : '자동매매를 시작하세요'}
            </div>
          ) : (
            tradeLogs.slice(0, 50).map((log) => (
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
      
      {/* Status Message */}
      <div className={cn(
        "mx-3 mb-3 px-3 py-2 rounded-md text-xs font-medium text-center",
        state.currentPosition ? "bg-green-500/10 text-green-400 border border-green-500/30" :
        state.pendingSignal ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30" :
        isEnabled ? "bg-blue-500/10 text-blue-400 border border-blue-500/30" :
        "bg-secondary/50 text-muted-foreground border border-border"
      )}>
        {state.statusMessage || (isEnabled ? '🔍 BB 시그널 종목 검색 중...' : '자동매매를 시작하세요')}
      </div>
      
      {/* Warning */}
      {!isEnabled && (
        <div className="px-4 py-2 bg-yellow-500/10 border-t border-yellow-500/20">
          <div className="flex items-center gap-2 text-[10px] text-yellow-600">
            <AlertTriangle className="w-3 h-3" />
            <span>자동매매 비활성화 상태</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Trade Log Item
const TradeLogItem = ({ log, krwRate, onSelectSymbol }: { 
  log: AutoTradeLog; 
  krwRate: number;
  onSelectSymbol?: (symbol: string) => void;
}) => {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  
  const getActionIcon = () => {
    switch (log.action) {
      case 'entry':
        return log.side === 'long' ? '🟢' : '🔴';
      case 'tp':
        return '✅';
      case 'sl':
        return '🛑';
      case 'exit':
        return '📤';
      case 'error':
        return '⚠️';
      case 'cancel':
        return '🚫';
      case 'pending':
        return '⏳';
      default:
        return '•';
    }
  };
  
  const getActionText = () => {
    switch (log.action) {
      case 'entry':
        return log.side === 'long' ? '롱 진입' : '숏 진입';
      case 'tp':
        return '익절';
      case 'sl':
        return '손절';
      case 'exit':
        return '청산';
      case 'error':
        return '오류';
      case 'cancel':
        return '취소';
      case 'pending':
        return '대기';
      default:
        return log.action;
    }
  };
  
  const formatKRW = (usd: number) => {
    const krw = usd * krwRate;
    return krw.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };
  
  // 사유 표시 (cancel, error, pending만)
  const showReason = ['cancel', 'error', 'pending'].includes(log.action);
  
  return (
    <div 
      onClick={() => onSelectSymbol?.(log.symbol)}
      className={cn(
        "px-2 py-1.5 rounded text-[10px] cursor-pointer hover:ring-1 hover:ring-primary/50 transition-all",
        log.action === 'error' ? "bg-red-500/10" : 
        log.action === 'cancel' ? "bg-yellow-500/10" :
        log.action === 'pending' ? "bg-blue-500/10" :
        "bg-secondary/50"
      )}
    >
      <div className="flex items-center gap-2">
        <span>{getActionIcon()}</span>
        <span className="text-muted-foreground">{formatTime(log.timestamp)}</span>
        <span className="font-semibold text-primary">{log.symbol.replace('USDT', '')}</span>
        <span>{getActionText()}</span>
        {log.pnl !== undefined && (
          <span className={cn(
            "font-mono ml-auto",
            log.pnl >= 0 ? "text-green-500" : "text-red-500"
          )}>
            {log.pnl >= 0 ? '+' : ''}₩{formatKRW(log.pnl)}
          </span>
        )}
      </div>
      {showReason && log.reason && (
        <div className="mt-0.5 ml-5 text-[9px] text-muted-foreground truncate">
          → {log.reason}
        </div>
      )}
    </div>
  );
};

export default AutoTradingPanel;
