import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Bot, TrendingUp, TrendingDown, Activity, Clock, AlertTriangle, Star, RefreshCw, Wallet, LogOut, Shield, ShieldOff } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { AutoTradingState, AutoTradeLog } from '@/hooks/useAutoTrading';
import { formatPrice } from '@/lib/binance';
import { useBinanceApi } from '@/hooks/useBinanceApi';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import TradingRecordModal from './TradingRecordModal';
import BacktestModal from './BacktestModal';
import OrderBookWallIndicator from './OrderBookWallIndicator';

// 스캘핑 시간대 적합도 데이터
const getScalpingRating = () => {
  const now = new Date();
  const koreaOffset = 9 * 60;
  const utcOffset = now.getTimezoneOffset();
  const koreaTime = new Date(now.getTime() + (koreaOffset + utcOffset) * 60 * 1000);
  const hour = koreaTime.getHours();
  
  // 시간대별 적합도 (한국시간 기준)
  if (hour >= 4 && hour < 8) {
    return { stars: 0, label: '데드존', color: 'text-gray-500', volume: '최저', volatility: '최저' };
  } else if (hour >= 8 && hour < 9) {
    return { stars: 1, label: '준비중', color: 'text-gray-400', volume: '낮음', volatility: '낮음' };
  } else if (hour >= 9 && hour < 11) {
    return { stars: 3, label: '아시아장', color: 'text-yellow-500', volume: '보통', volatility: '보통' };
  } else if (hour >= 11 && hour < 16) {
    return { stars: 2, label: '점심휴식', color: 'text-orange-400', volume: '낮음', volatility: '낮음' };
  } else if (hour >= 16 && hour < 18) {
    return { stars: 3, label: '유럽준비', color: 'text-yellow-500', volume: '보통', volatility: '상승' };
  } else if (hour >= 18 && hour < 21) {
    return { stars: 4, label: '유럽장', color: 'text-green-400', volume: '높음', volatility: '높음' };
  } else if (hour >= 21 && hour < 24) {
    return { stars: 5, label: '골든타임', color: 'text-green-500', volume: '최고', volatility: '최고' };
  } else if (hour >= 0 && hour < 2) {
    return { stars: 4, label: '미국장', color: 'text-green-400', volume: '높음', volatility: '높음' };
  } else {
    return { stars: 1, label: '마감', color: 'text-gray-400', volume: '낮음', volatility: '하락' };
  }
};

const LEVERAGE_OPTIONS = [1, 5, 10];

interface AutoTradingPanelProps {
  state: AutoTradingState;
  onToggle: () => void;
  onManualClose?: () => void;
  onSkipSignal?: () => void;
  onSwapSignal?: () => void;
  onToggleLossProtection?: () => void;
  onClearCooldown?: () => void;
  currentPrice?: number;
  krwRate: number;
  leverage: number;
  onLeverageChange: (leverage: number) => void;
  onSelectSymbol?: (symbol: string) => void;
  onBalanceChange?: (balance: number) => void;
  refreshTrigger?: number;
}

const AutoTradingPanel = ({ 
  state, 
  onToggle, 
  onManualClose,
  onSkipSignal,
  onSwapSignal,
  onToggleLossProtection,
  onClearCooldown,
  currentPrice = 0,
  krwRate,
  leverage,
  onLeverageChange,
  onSelectSymbol,
  onBalanceChange,
  refreshTrigger = 0,
}: AutoTradingPanelProps) => {
  const { isEnabled, isProcessing, currentPosition, pendingSignal, todayStats, tradeLogs, cooldownUntil, lossProtectionEnabled } = state;
  const { user, signOut } = useAuth();
  const { getBalances, getIncomeHistory } = useBinanceApi();
  
  const handleSignOut = async () => {
    await signOut();
    window.location.href = '/auth';
  };
  
  // 잔고 상태
  const [balanceUSD, setBalanceUSD] = useState(0);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [todayRealizedPnL, setTodayRealizedPnL] = useState(0);
  const [previousDayBalance, setPreviousDayBalance] = useState<number | null>(null);
  const [todayDeposits, setTodayDeposits] = useState(0);
  
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
  
  // 잔고 가져오기
  const getTodayMidnightKST = () => {
    const now = new Date();
    const koreaOffset = 9 * 60;
    const utcOffset = now.getTimezoneOffset();
    const koreaTime = new Date(now.getTime() + (koreaOffset + utcOffset) * 60 * 1000);
    koreaTime.setHours(0, 0, 0, 0);
    return koreaTime.getTime() - (koreaOffset + utcOffset) * 60 * 1000;
  };
  
  const getTodayDate = () => {
    const now = new Date();
    const koreaOffset = 9 * 60;
    const utcOffset = now.getTimezoneOffset();
    const koreaTime = new Date(now.getTime() + (koreaOffset + utcOffset) * 60 * 1000);
    return `${koreaTime.getFullYear()}-${String(koreaTime.getMonth() + 1).padStart(2, '0')}-${String(koreaTime.getDate()).padStart(2, '0')}`;
  };
  
  const fetchTodayRealizedPnL = async (currentBalance: number) => {
    try {
      const todayMidnight = getTodayMidnightKST();
      const now = Date.now();
      const incomeHistory = await getIncomeHistory(todayMidnight, now);
      if (!incomeHistory || !Array.isArray(incomeHistory)) return;
      
      const transferItems = incomeHistory.filter((item: any) => item.incomeType === 'TRANSFER');
      const deposits = transferItems.filter((item: any) => parseFloat(item.income || 0) > 0)
        .reduce((sum: number, item: any) => sum + parseFloat(item.income || 0), 0);
      const withdrawals = transferItems.filter((item: any) => parseFloat(item.income || 0) < 0)
        .reduce((sum: number, item: any) => sum + Math.abs(parseFloat(item.income || 0)), 0);
      
      const tradingIncomeTypes = ['REALIZED_PNL', 'COMMISSION', 'FUNDING_FEE'];
      const realizedFromBinance = incomeHistory
        .filter((item: any) => tradingIncomeTypes.includes(item.incomeType))
        .reduce((sum: number, item: any) => sum + parseFloat(item.income || 0), 0);
      
      setTodayDeposits(deposits);
      setTodayRealizedPnL(realizedFromBinance);
      const startBalance = currentBalance - realizedFromBinance - deposits + withdrawals;
      setPreviousDayBalance(startBalance);
      
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        await supabase.from('daily_balance_snapshots').upsert({
          user_id: authUser.id,
          snapshot_date: getTodayDate(),
          closing_balance_usd: currentBalance,
          daily_income_usd: realizedFromBinance,
          deposit_usd: deposits,
          withdrawal_usd: withdrawals,
        }, { onConflict: 'user_id,snapshot_date' });
      }
    } catch (error) {
      console.error('Failed to fetch realized PnL:', error);
    }
  };
  
  const fetchRealBalance = async () => {
    setBalanceLoading(true);
    try {
      const balances = await getBalances();
      const usdtBalance = balances?.find((b: any) => b.asset === 'USDT');
      if (usdtBalance) {
        const totalBalance = parseFloat(usdtBalance.balance) || parseFloat(usdtBalance.crossWalletBalance) || 0;
        setBalanceUSD(totalBalance);
        onBalanceChange?.(totalBalance);
        fetchTodayRealizedPnL(totalBalance);
      }
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    } finally {
      setBalanceLoading(false);
    }
  };
  
  // 잔고 주기적 갱신
  useEffect(() => {
    if (!user) return;
    fetchRealBalance();
    const intervalId = setInterval(fetchRealBalance, 10000);
    return () => clearInterval(intervalId);
  }, [user]);
  
  // 청산 후 즉시 갱신
  useEffect(() => {
    if (refreshTrigger > 0 && user) {
      fetchRealBalance();
    }
  }, [refreshTrigger]);
  
  // 현재 포지션 PnL (이전 값 유지)
  const [lastValidPnL, setLastValidPnL] = useState(0);
  
  const currentPnL = useMemo(() => {
    if (!currentPosition) {
      return 0;
    }
    // currentPrice가 없거나 0이면 이전 값 유지
    if (!currentPrice || currentPrice === 0) {
      return lastValidPnL;
    }
    const direction = currentPosition.side === 'long' ? 1 : -1;
    const priceDiff = (currentPrice - currentPosition.entryPrice) * direction;
    return priceDiff * currentPosition.remainingQuantity;
  }, [currentPosition, currentPrice, lastValidPnL]);
  
  // 유효한 PnL 값 업데이트
  useEffect(() => {
    if (currentPosition && currentPrice && currentPrice > 0) {
      const direction = currentPosition.side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - currentPosition.entryPrice) * direction;
      const newPnL = priceDiff * currentPosition.remainingQuantity;
      setLastValidPnL(newPnL);
    } else if (!currentPosition) {
      setLastValidPnL(0);
    }
  }, [currentPosition, currentPrice]);
  
  const winRate = todayStats.trades > 0 
    ? ((todayStats.wins / todayStats.trades) * 100).toFixed(1) 
    : '0.0';
  
  const formatKRW = (usd: number) => {
    const krw = usd * krwRate;
    return krw.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };
  
  // Daily P&L calculations
  const dailyPnL = todayRealizedPnL;
  const effectiveStartingBalance = (previousDayBalance !== null ? Math.max(0, previousDayBalance) : 0) + todayDeposits;
  const baseBalance = effectiveStartingBalance > 0 ? effectiveStartingBalance : balanceUSD;
  const dailyPnLPercent = baseBalance > 0 ? (dailyPnL / baseBalance) * 100 : 0;
  const dailyPnLPercentStr = dailyPnLPercent.toFixed(2);
  
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col w-full">
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
          <span className="font-semibold text-sm tracking-wide">System Trading</span>
          {isProcessing && (
            <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 연속 손실 보호 토글 */}
          <button
            onClick={onToggleLossProtection}
            className={cn(
              "p-1 rounded transition-colors",
              lossProtectionEnabled 
                ? "bg-amber-500/20 text-amber-500 hover:bg-amber-500/30" 
                : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
            )}
            title={lossProtectionEnabled ? "연속 손실 보호 ON (5연패시 60분 휴식)" : "연속 손실 보호 OFF"}
          >
            {lossProtectionEnabled ? <Shield className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
          </button>
          {cooldownRemaining && (
            <button 
              onClick={onClearCooldown}
              className="text-[10px] text-yellow-500 flex items-center gap-1 hover:bg-yellow-500/20 px-1.5 py-0.5 rounded"
              title="클릭하여 휴식 해제"
            >
              <Clock className="w-3 h-3" />
              {cooldownRemaining}
            </button>
          )}
          <Switch
            checked={isEnabled}
            onCheckedChange={onToggle}
            className="data-[state=checked]:bg-green-500"
          />
          <button
            onClick={handleSignOut}
            className="p-1 rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
            title="로그아웃"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {/* Balance Section */}
      <div className="px-3 py-2 border-b border-border bg-secondary/20">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="flex items-center gap-1">
              <Wallet className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">잔고</span>
              <button onClick={fetchRealBalance} className="p-0.5 hover:bg-secondary rounded">
                <RefreshCw className={cn("w-3 h-3 text-muted-foreground", balanceLoading && "animate-spin")} />
              </button>
            </div>
            <div className="text-base font-bold font-mono">{balanceLoading ? '...' : `₩${formatKRW(balanceUSD)}`}</div>
          </div>
          <div className="text-right">
            <span className="text-xs text-muted-foreground">수익률</span>
            <div className={cn(
              "text-base font-bold font-mono",
              dailyPnLPercent >= 5 ? "text-green-400" : 
              dailyPnLPercent >= 0 ? "text-red-400" : "text-blue-400"
            )}>
              {dailyPnL >= 0 ? '+' : ''}{dailyPnLPercentStr}%
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
          <div>
            <span className="text-[10px] text-muted-foreground">실현손익</span>
            <div className={cn("text-sm font-mono font-semibold", todayRealizedPnL >= 0 ? "text-red-400" : "text-blue-400")}>
              {todayRealizedPnL >= 0 ? '+' : ''}₩{formatKRW(todayRealizedPnL)}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {currentPosition && (
              <BacktestModal symbol={currentPosition.symbol} />
            )}
            {pendingSignal && !currentPosition && (
              <BacktestModal symbol={pendingSignal.symbol} />
            )}
            <TradingRecordModal krwRate={krwRate} />
          </div>
        </div>
      </div>
      
      {/* Leverage Setting */}
      <div className="px-4 py-2 border-b border-border bg-secondary/30">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">레버리지</span>
          <div className="flex gap-1.5">
            {LEVERAGE_OPTIONS.map((lev) => (
              <button
                key={lev}
                onClick={() => onLeverageChange(lev)}
                disabled={isEnabled || !!currentPosition}
                className={cn(
                  "px-3 py-1 text-xs font-mono rounded transition-colors",
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
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-muted-foreground">거래</p>
            <p className="text-base font-bold font-mono">{todayStats.trades}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">승/패</p>
            <p className="text-base font-bold font-mono">
              <span className="text-green-500">{todayStats.wins}</span>
              /
              <span className="text-red-500">{todayStats.losses}</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">승률</p>
            <p className={cn(
              "text-base font-bold font-mono",
              parseFloat(winRate) >= 50 ? "text-green-500" : "text-red-500"
            )}>
              {winRate}%
            </p>
          </div>
        </div>
      </div>
      
      {/* Order Book Wall Analysis */}
      <OrderBookWallIndicator 
        symbol={currentPosition?.symbol || pendingSignal?.symbol || null} 
        enabled={isEnabled} 
      />
      
      {/* Pending Signal */}
      {pendingSignal && !currentPosition && (
        <div className="px-4 py-3 border-b border-border bg-yellow-500/10">
          <div className="flex items-center justify-between">
            <div 
              className="flex items-center gap-2 cursor-pointer hover:opacity-80"
              onClick={() => onSelectSymbol?.(pendingSignal.symbol)}
            >
              <Clock className="w-4 h-4 text-yellow-500 animate-pulse" />
              <span className="font-semibold text-sm text-yellow-500">
                {pendingSignal.symbol} {pendingSignal.direction === 'short' ? '숏' : '롱'} 대기
              </span>
              {/* 시그널 강도 배지 */}
              <span className={cn(
                "text-[9px] px-1.5 py-0.5 rounded font-semibold",
                pendingSignal.strength === 'strong' ? "bg-green-500/20 text-green-400" :
                pendingSignal.strength === 'medium' ? "bg-yellow-500/20 text-yellow-400" :
                "bg-gray-500/20 text-gray-400"
              )}>
                {pendingSignal.strength === 'strong' ? '강함' : pendingSignal.strength === 'medium' ? '보통' : '약함'}
              </span>
            </div>
            <div className="flex gap-1">
              {onSwapSignal && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onSwapSignal}
                  className="h-6 px-2 text-[10px] border-blue-500/50 text-blue-400 hover:bg-blue-500/20"
                >
                  🔄
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={onSkipSignal}
                className="h-6 px-2 text-[10px] border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/20"
              >
                패스
              </Button>
            </div>
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            시그널 @ ${pendingSignal.signalPrice.toFixed(4)} | 봉 완성 대기 중
          </div>
          {/* 시그널 근거 표시 */}
          {pendingSignal.reasons && pendingSignal.reasons.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {pendingSignal.reasons.slice(0, 3).map((reason, idx) => (
                <span key={idx} className="text-[9px] px-1.5 py-0.5 bg-secondary/50 rounded text-muted-foreground">
                  {reason}
                </span>
              ))}
            </div>
          )}
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
            <span>수량: {currentPosition.remainingQuantity.toFixed(4)}</span>
          </div>
          {/* 3단계 익절 진행 상태 */}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">익절:</span>
            <div className="flex gap-2">
              <span className={cn(
                "text-[11px] px-2 py-1 rounded font-mono",
                currentPosition.takeProfitState?.stage1Hit 
                  ? "bg-green-500/30 text-green-400" 
                  : "bg-secondary/50 text-muted-foreground"
              )}>
                1단계 {currentPosition.takeProfitState?.stage1Hit ? '✓' : '0.3%'}
              </span>
              <span className={cn(
                "text-[11px] px-2 py-1 rounded font-mono",
                currentPosition.takeProfitState?.stage2Hit 
                  ? "bg-green-500/30 text-green-400" 
                  : "bg-secondary/50 text-muted-foreground"
              )}>
                2단계 {currentPosition.takeProfitState?.stage2Hit ? '✓' : '0.8%'}
              </span>
              <span className={cn(
                "text-[11px] px-2 py-1 rounded font-mono",
                currentPosition.takeProfitState?.stage3Hit 
                  ? "bg-green-500/30 text-green-400" 
                  : "bg-secondary/50 text-muted-foreground"
              )}>
                3단계 {currentPosition.takeProfitState?.stage3Hit ? '✓' : '1.5%'}
              </span>
            </div>
          </div>
          {/* 트레일링 스탑 상태 */}
          {currentPosition.takeProfitState?.trailingActive && (
            <div className="mt-1.5 flex items-center gap-1">
              <span className="text-[11px] px-2 py-1 rounded bg-blue-500/20 text-blue-400 font-mono">
                📈 트레일링 활성 @ ${currentPosition.takeProfitState.trailingHighPrice.toFixed(4)}
              </span>
            </div>
          )}
          <div className="flex gap-2 mt-2">
            {onManualClose && (
              <Button
                variant="destructive"
                size="sm"
                onClick={onManualClose}
                className="w-full h-8 text-sm font-semibold"
                disabled={isProcessing}
              >
                {isProcessing ? '처리중...' : '즉시 청산'}
              </Button>
            )}
          </div>
        </div>
      )}
      
      {/* Trade Logs */}
      <div className="px-3 py-2 flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-1.5 px-2 mb-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-medium">매매 로그</span>
        </div>
        <div className="overflow-y-auto space-y-1.5 max-h-[160px]">
          {tradeLogs.length === 0 ? (
            <div className="text-center py-4 text-xs text-muted-foreground">
              {isEnabled ? '기술적 분석 시그널 대기 중...' : '자동매매를 시작하세요'}
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
      
      {/* Scalping Suitability Indicator */}
      <ScalpingIndicator />
      
      {/* Status Message */}
      <div className={cn(
        "mx-3 mb-3 px-3 py-2 rounded-md text-xs font-medium text-center",
        state.currentPosition ? "bg-green-500/10 text-green-400 border border-green-500/30" :
        state.pendingSignal ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30" :
        isEnabled ? "bg-blue-500/10 text-blue-400 border border-blue-500/30" :
        "bg-secondary/50 text-muted-foreground border border-border"
      )}>
        {state.statusMessage || (isEnabled ? '🔍 기술적 분석 스캔 중...' : '자동매매를 시작하세요')}
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

// Scalping Indicator
const ScalpingIndicator = () => {
  const [rating, setRating] = useState(getScalpingRating());
  
  useEffect(() => {
    const interval = setInterval(() => {
      setRating(getScalpingRating());
    }, 60000); // 1분마다 업데이트
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="mx-3 px-3 py-2 bg-secondary/30 rounded-md border border-border/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">스캘핑 적합도</span>
          <span className={cn("text-[10px] font-semibold", rating.color)}>
            {rating.label}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Star
              key={i}
              className={cn(
                "w-3 h-3",
                i <= rating.stars ? "text-yellow-500 fill-yellow-500" : "text-gray-600"
              )}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-1 text-[9px] text-muted-foreground">
        <span>거래량: <span className={rating.color}>{rating.volume}</span></span>
        <span>변동성: <span className={rating.color}>{rating.volatility}</span></span>
      </div>
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
        "px-3 py-2 rounded text-xs cursor-pointer hover:ring-1 hover:ring-primary/50 transition-all",
        log.action === 'error' ? "bg-red-500/10" : 
        log.action === 'cancel' ? "bg-yellow-500/10" :
        log.action === 'pending' ? "bg-blue-500/10" :
        "bg-secondary/50"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm">{getActionIcon()}</span>
        <span className="text-muted-foreground">{formatTime(log.timestamp)}</span>
        <span className="font-semibold text-primary">{log.symbol.replace('USDT', '')}</span>
        <span>{getActionText()}</span>
        {log.pnl !== undefined && (
          <span className={cn(
            "font-mono ml-auto font-semibold",
            log.pnl >= 0 ? "text-green-500" : "text-red-500"
          )}>
            {log.pnl >= 0 ? '+' : ''}₩{formatKRW(log.pnl)}
          </span>
        )}
      </div>
      {showReason && log.reason && (
        <div className="mt-1 ml-6 text-[10px] text-muted-foreground truncate">
          → {log.reason}
        </div>
      )}
    </div>
  );
};

export default AutoTradingPanel;
