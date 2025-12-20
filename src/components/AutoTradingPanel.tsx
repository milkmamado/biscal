import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Bot, TrendingUp, TrendingDown, Activity, Clock, AlertTriangle, Star, RefreshCw, Wallet, LogOut, Shield, ShieldOff, Crown, Brain } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { PyramidTradingState, PyramidTradeLog, PyramidPosition } from '@/hooks/usePyramidTrading';
import { formatPrice } from '@/lib/binance';
import { useBinanceApi } from '@/hooks/useBinanceApi';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import TradingRecordModal from './TradingRecordModal';
import BacktestModal from './BacktestModal';
import ScreeningLogPanel from './ScreeningLogPanel';
import TradingDocsModal from './TradingDocsModal';
import MarketAnalysisPanel from './MarketAnalysisPanel';

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

const LEVERAGE_OPTIONS = [1, 5, 10, 15, 20];

interface AutoTradingPanelProps {
  state: PyramidTradingState;
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
  scanStatus?: {
    isScanning: boolean;
    tickersCount: number;
    screenedCount: number;
    signalsCount: number;
    lastScanTime: number;
  };
  isTestnet?: boolean;
  majorCoinMode?: boolean;
  onToggleMajorCoinMode?: () => void;
  onToggleAiAnalysis?: () => void;
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
  scanStatus,
  isTestnet = false,
  majorCoinMode = false,
  onToggleMajorCoinMode,
  onToggleAiAnalysis,
}: AutoTradingPanelProps) => {
  const { isEnabled, isProcessing, currentPosition, pendingSignal, todayStats, tradeLogs, aiAnalysis, isAiAnalyzing, aiEnabled } = state;
  const cooldownUntil = 0; // 스윙 매매에선 미사용
  const lossProtectionEnabled = false; // 스윙 매매에선 미사용
  const { user, signOut } = useAuth();
  const { getBalances, getIncomeHistory, isTestnetReady } = useBinanceApi({ isTestnet });
  
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
          is_testnet: isTestnet,
        }, { onConflict: 'user_id,snapshot_date,is_testnet' });
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

        // ✅ 모의투자(testnet)는 거래소 incomeHistory가 부정확/빈값인 경우가 많아서
        // DB(우리 거래로그) 기준 실현손익(todayStats.totalPnL)을 사용
        if (isTestnet) {
          const realized = todayStats.totalPnL;
          setTodayDeposits(0);
          setTodayRealizedPnL(realized);
          setPreviousDayBalance(totalBalance - realized);

          const { data: { user: authUser } } = await supabase.auth.getUser();
          if (authUser) {
            await supabase.from('daily_balance_snapshots').upsert({
              user_id: authUser.id,
              snapshot_date: getTodayDate(),
              closing_balance_usd: totalBalance,
              daily_income_usd: realized,
              deposit_usd: 0,
              withdrawal_usd: 0,
              is_testnet: true,
            }, { onConflict: 'user_id,snapshot_date,is_testnet' });
          }
        } else {
          fetchTodayRealizedPnL(totalBalance);
        }
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
    const priceDiff = (currentPrice - currentPosition.avgPrice) * direction;
    return priceDiff * currentPosition.totalQuantity;
  }, [currentPosition, currentPrice, lastValidPnL]);
  
  // 유효한 PnL 값 업데이트
  useEffect(() => {
    if (currentPosition && currentPrice && currentPrice > 0) {
      const direction = currentPosition.side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - currentPosition.avgPrice) * direction;
      const newPnL = priceDiff * currentPosition.totalQuantity;
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
  const realizedPnLUsd = isTestnet
    ? todayStats.totalPnL
    : (todayRealizedPnL !== 0 ? todayRealizedPnL : todayStats.totalPnL);

  const dailyPnL = realizedPnLUsd;
  const effectiveStartingBalance = (previousDayBalance !== null ? Math.max(0, previousDayBalance) : 0) + todayDeposits;
  const fallbackStartBalance = Math.max(0, balanceUSD - dailyPnL);
  const baseBalance = effectiveStartingBalance > 0 ? effectiveStartingBalance : (fallbackStartBalance > 0 ? fallbackStartBalance : balanceUSD);
  const dailyPnLPercent = baseBalance > 0 ? (dailyPnL / baseBalance) * 100 : 0;
  const dailyPnLPercentStr = dailyPnLPercent.toFixed(2);
  
  return (
    <div className="relative overflow-hidden rounded-lg flex flex-col w-full h-full" style={{
      background: 'linear-gradient(180deg, rgba(10,10,15,0.95) 0%, rgba(5,5,10,0.98) 100%)',
      border: '1px solid rgba(0, 255, 255, 0.2)',
      boxShadow: '0 0 20px rgba(0, 255, 255, 0.1), inset 0 0 30px rgba(0, 0, 0, 0.5)',
    }}>
      {/* 사이버펑크 배경 그리드 효과 */}
      <div className="absolute inset-0 opacity-5" style={{
        backgroundImage: `
          linear-gradient(rgba(0, 255, 255, 0.3) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0, 255, 255, 0.3) 1px, transparent 1px)
        `,
        backgroundSize: '20px 20px',
      }} />
      
      {/* Header */}
      <div className={cn(
        "relative z-10 px-4 py-3 flex items-center justify-between",
        isEnabled 
          ? "border-b border-cyan-500/30" 
          : "border-b border-border/30"
      )} style={{
        background: isEnabled 
          ? 'linear-gradient(90deg, rgba(0, 255, 136, 0.15) 0%, rgba(0, 255, 255, 0.1) 100%)'
          : 'rgba(20, 20, 30, 0.5)',
      }}>
        <div className="flex items-center gap-2">
          <Bot className={cn(
            "w-5 h-5",
            isEnabled ? "text-cyan-400" : "text-gray-500"
          )} style={{
            filter: isEnabled ? 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.8))' : 'none',
          }} />
          <span className="font-bold text-sm tracking-widest uppercase" style={{
            color: isEnabled ? '#00ffff' : '#888',
            textShadow: isEnabled ? '0 0 10px rgba(0, 255, 255, 0.8)' : 'none',
          }}>System Trading</span>
          {isProcessing && (
            <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" style={{
              boxShadow: '0 0 10px rgba(255, 255, 0, 0.8)',
            }} />
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 🆕 메이저 코인 모드 토글 */}
          <button
            onClick={onToggleMajorCoinMode}
            disabled={isEnabled}
            className={cn(
              "p-1.5 rounded transition-all",
              majorCoinMode 
                ? "text-yellow-400" 
                : "text-gray-500 hover:text-gray-300",
              isEnabled && "opacity-50 cursor-not-allowed"
            )}
            style={{
              background: majorCoinMode ? 'rgba(255, 215, 0, 0.2)' : 'transparent',
              boxShadow: majorCoinMode ? '0 0 10px rgba(255, 215, 0, 0.4)' : 'none',
            }}
            title={majorCoinMode ? "🏆 메이저 코인 모드 (BTC, ETH 등)" : "잡코인 모드 (저가 알트코인)"}
          >
            <Crown className="w-4 h-4" />
          </button>
          {/* 📚 매매 가이드 문서 */}
          <TradingDocsModal majorCoinMode={majorCoinMode} />
          {/* 🤖 AI 분석 토글 */}
          <button
            onClick={onToggleAiAnalysis}
            className={cn(
              "p-1.5 rounded transition-all",
              aiEnabled 
                ? "text-cyan-400" 
                : "text-gray-500 hover:text-gray-300"
            )}
            style={{
              background: aiEnabled ? 'rgba(0, 255, 255, 0.2)' : 'transparent',
              boxShadow: aiEnabled ? '0 0 10px rgba(0, 255, 255, 0.4)' : 'none',
            }}
            title={aiEnabled ? "🤖 AI 분석 ON" : "🤖 AI 분석 OFF"}
          >
            <Brain className={cn("w-4 h-4", isAiAnalyzing && "animate-pulse")} />
          </button>
          {/* 연속 손실 보호 토글 */}
          <button
            onClick={onToggleLossProtection}
            className={cn(
              "p-1.5 rounded transition-all",
              lossProtectionEnabled 
                ? "text-amber-400" 
                : "text-gray-500 hover:text-gray-300"
            )}
            style={{
              background: lossProtectionEnabled ? 'rgba(255, 191, 0, 0.2)' : 'transparent',
              boxShadow: lossProtectionEnabled ? '0 0 10px rgba(255, 191, 0, 0.4)' : 'none',
            }}
            title={lossProtectionEnabled ? "연속 손실 보호 ON (5연패시 60분 휴식)" : "연속 손실 보호 OFF"}
          >
            {lossProtectionEnabled ? <Shield className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
          </button>
          {cooldownRemaining && (
            <button 
              onClick={onClearCooldown}
              className="text-[10px] text-yellow-400 flex items-center gap-1 px-2 py-1 rounded"
              style={{
                background: 'rgba(255, 255, 0, 0.1)',
                border: '1px solid rgba(255, 255, 0, 0.3)',
              }}
              title="클릭하여 휴식 해제"
            >
              <Clock className="w-3 h-3" />
              {cooldownRemaining}
            </button>
          )}
          <Switch
            checked={isEnabled}
            onCheckedChange={onToggle}
            className="data-[state=checked]:bg-cyan-500"
            style={{
              boxShadow: isEnabled ? '0 0 10px rgba(0, 255, 255, 0.5)' : 'none',
            }}
          />
          <button
            onClick={handleSignOut}
            className="p-1.5 rounded text-gray-500 hover:text-pink-400 transition-colors"
            style={{
              background: 'rgba(255, 0, 136, 0.1)',
            }}
            title="로그아웃"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      {/* Balance Section */}
      <div className="relative z-10 px-3 py-3" style={{
        background: 'linear-gradient(180deg, rgba(0, 255, 255, 0.05) 0%, transparent 100%)',
        borderBottom: '1px solid rgba(0, 255, 255, 0.15)',
      }}>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="flex items-center gap-1">
              <Wallet className="w-4 h-4 text-cyan-400" />
              <span className="text-xs text-cyan-400/70">잔고</span>
              <button onClick={fetchRealBalance} className="p-0.5 hover:bg-cyan-500/20 rounded">
                <RefreshCw className={cn("w-3 h-3 text-cyan-400", balanceLoading && "animate-spin")} />
              </button>
            </div>
            <div className="text-lg font-bold font-mono text-cyan-300" style={{
              textShadow: '0 0 10px rgba(0, 255, 255, 0.5)',
            }}>{balanceLoading ? '...' : `₩${formatKRW(balanceUSD)}`}</div>
          </div>
          <div className="text-right">
            <span className="text-xs text-pink-400/70">수익률</span>
            <div className={cn(
              "text-lg font-bold font-mono"
            )} style={{
              color: dailyPnLPercent >= 0 ? '#00ff88' : '#ff0088',
              textShadow: dailyPnLPercent >= 0 ? '0 0 10px rgba(0, 255, 136, 0.6)' : '0 0 10px rgba(255, 0, 136, 0.6)',
            }}>
              {dailyPnL >= 0 ? '+' : ''}{dailyPnLPercentStr}%
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-2 pt-2" style={{
          borderTop: '1px solid rgba(0, 255, 255, 0.1)',
        }}>
          <div>
            <span className="text-[10px] text-gray-500">실현손익</span>
            <div className="text-sm font-mono font-semibold" style={{
              color: realizedPnLUsd >= 0 ? '#00ff88' : '#ff0088',
              textShadow: realizedPnLUsd >= 0 ? '0 0 8px rgba(0, 255, 136, 0.5)' : '0 0 8px rgba(255, 0, 136, 0.5)',
            }}>
              {realizedPnLUsd >= 0 ? '+' : ''}₩{formatKRW(realizedPnLUsd)}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {currentPosition && (
              <BacktestModal symbol={currentPosition.symbol} />
            )}
            {pendingSignal && !currentPosition && (
              <BacktestModal symbol={pendingSignal.symbol} />
            )}
            <TradingRecordModal krwRate={krwRate} isTestnet={isTestnet} refreshTrigger={refreshTrigger} />
          </div>
        </div>
      </div>
      
      {/* Leverage Setting */}
      <div className="relative z-10 px-4 py-2" style={{
        background: 'rgba(20, 20, 30, 0.5)',
        borderBottom: '1px solid rgba(0, 255, 255, 0.1)',
      }}>
        <div className="flex items-center justify-between">
          <span className="text-xs text-cyan-400/70">레버리지</span>
          <div className="flex gap-1.5">
            {LEVERAGE_OPTIONS.map((lev) => (
              <button
                key={lev}
                onClick={() => onLeverageChange(lev)}
                disabled={isEnabled || !!currentPosition}
                className={cn(
                  "px-3 py-1 text-xs font-mono rounded transition-all",
                  (isEnabled || currentPosition) && "opacity-50 cursor-not-allowed"
                )}
                style={{
                  background: leverage === lev 
                    ? 'linear-gradient(180deg, rgba(0, 255, 255, 0.3) 0%, rgba(0, 255, 255, 0.1) 100%)'
                    : 'rgba(40, 40, 60, 0.5)',
                  border: leverage === lev 
                    ? '1px solid rgba(0, 255, 255, 0.5)'
                    : '1px solid rgba(100, 100, 120, 0.3)',
                  color: leverage === lev ? '#00ffff' : '#888',
                  boxShadow: leverage === lev ? '0 0 10px rgba(0, 255, 255, 0.3)' : 'none',
                }}
              >
                {lev}x
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Today Stats */}
      <div className="relative z-10 px-4 py-3" style={{
        background: 'rgba(15, 15, 25, 0.5)',
        borderBottom: '1px solid rgba(0, 255, 255, 0.1)',
      }}>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-gray-500">거래</p>
            <p className="text-base font-bold font-mono text-cyan-300">{todayStats.trades}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">승/패</p>
            <p className="text-base font-bold font-mono">
              <span style={{ color: '#00ff88', textShadow: '0 0 8px rgba(0, 255, 136, 0.5)' }}>{todayStats.wins}</span>
              <span className="text-gray-600">/</span>
              <span style={{ color: '#ff0088', textShadow: '0 0 8px rgba(255, 0, 136, 0.5)' }}>{todayStats.losses}</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">승률</p>
            <p className="text-base font-bold font-mono" style={{
              color: parseFloat(winRate) >= 50 ? '#00ff88' : '#ff0088',
              textShadow: parseFloat(winRate) >= 50 ? '0 0 8px rgba(0, 255, 136, 0.5)' : '0 0 8px rgba(255, 0, 136, 0.5)',
            }}>
              {winRate}%
            </p>
          </div>
        </div>
      </div>
      
      {/* Pending Signal */}
      {pendingSignal && !currentPosition && (
        <div className="relative z-10 px-4 py-3" style={{
          background: 'linear-gradient(90deg, rgba(255, 255, 0, 0.1) 0%, rgba(255, 200, 0, 0.05) 100%)',
          borderBottom: '1px solid rgba(255, 255, 0, 0.2)',
        }}>
          <div className="flex items-center justify-between">
            <div 
              className="flex items-center gap-2 cursor-pointer hover:opacity-80"
              onClick={() => onSelectSymbol?.(pendingSignal.symbol)}
            >
              <Clock className="w-4 h-4 text-yellow-400 animate-pulse" style={{
                filter: 'drop-shadow(0 0 6px rgba(255, 255, 0, 0.8))',
              }} />
              <span className="font-semibold text-sm" style={{
                color: '#ffff00',
                textShadow: '0 0 8px rgba(255, 255, 0, 0.6)',
              }}>
                {pendingSignal.symbol} {pendingSignal.direction === 'short' ? '숏' : '롱'} 대기
              </span>
              {/* 시그널 강도 배지 */}
              <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold" style={{
                background: pendingSignal.strength === 'strong' ? 'rgba(0, 255, 136, 0.2)' :
                  pendingSignal.strength === 'medium' ? 'rgba(255, 255, 0, 0.2)' : 'rgba(100, 100, 100, 0.2)',
                color: pendingSignal.strength === 'strong' ? '#00ff88' :
                  pendingSignal.strength === 'medium' ? '#ffff00' : '#888',
                border: `1px solid ${pendingSignal.strength === 'strong' ? 'rgba(0, 255, 136, 0.4)' :
                  pendingSignal.strength === 'medium' ? 'rgba(255, 255, 0, 0.4)' : 'rgba(100, 100, 100, 0.4)'}`,
              }}>
                {pendingSignal.strength === 'strong' ? '강함' : pendingSignal.strength === 'medium' ? '보통' : '약함'}
              </span>
            </div>
            <div className="flex gap-1">
              {onSwapSignal && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onSwapSignal}
                  className="h-6 px-2 text-[10px]"
                  style={{
                    background: 'rgba(0, 255, 255, 0.1)',
                    border: '1px solid rgba(0, 255, 255, 0.3)',
                    color: '#00ffff',
                  }}
                >
                  🔄
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={onSkipSignal}
                className="h-6 px-2 text-[10px]"
                style={{
                  background: 'rgba(255, 0, 136, 0.1)',
                  border: '1px solid rgba(255, 0, 136, 0.3)',
                  color: '#ff0088',
                }}
              >
                패스
              </Button>
            </div>
          </div>
          <div className="mt-1 text-[10px] text-gray-400">
            시그널 @ ${pendingSignal.signalPrice.toFixed(4)} | 봉 완성 대기 중
          </div>
          {/* 시그널 근거 표시 */}
          {pendingSignal.reasons && pendingSignal.reasons.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {pendingSignal.reasons.slice(0, 3).map((reason, idx) => (
                <span key={idx} className="text-[9px] px-1.5 py-0.5 rounded" style={{
                  background: 'rgba(0, 255, 255, 0.1)',
                  border: '1px solid rgba(0, 255, 255, 0.2)',
                  color: '#00cccc',
                }}>
                  {reason}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* Current Position */}
      {currentPosition && (
        <div className="relative z-10 px-4 py-3" style={{
          background: currentPosition.side === 'long' 
            ? 'linear-gradient(90deg, rgba(0, 255, 136, 0.1) 0%, transparent 100%)'
            : 'linear-gradient(90deg, rgba(255, 0, 136, 0.1) 0%, transparent 100%)',
          borderBottom: `1px solid ${currentPosition.side === 'long' ? 'rgba(0, 255, 136, 0.2)' : 'rgba(255, 0, 136, 0.2)'}`,
        }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {currentPosition.side === 'long' ? (
                <TrendingUp className="w-4 h-4" style={{ color: '#00ff88', filter: 'drop-shadow(0 0 6px rgba(0, 255, 136, 0.8))' }} />
              ) : (
                <TrendingDown className="w-4 h-4" style={{ color: '#ff0088', filter: 'drop-shadow(0 0 6px rgba(255, 0, 136, 0.8))' }} />
              )}
              <span className="font-semibold text-sm" style={{
                color: currentPosition.side === 'long' ? '#00ff88' : '#ff0088',
                textShadow: currentPosition.side === 'long' ? '0 0 8px rgba(0, 255, 136, 0.5)' : '0 0 8px rgba(255, 0, 136, 0.5)',
              }}>
                {currentPosition.symbol.replace('USDT', '')} {currentPosition.side === 'long' ? '롱' : '숏'}
              </span>
            </div>
            <span className="text-sm font-bold font-mono" style={{
              color: currentPnL >= 0 ? '#00ff88' : '#ff0088',
              textShadow: currentPnL >= 0 ? '0 0 10px rgba(0, 255, 136, 0.6)' : '0 0 10px rgba(255, 0, 136, 0.6)',
            }}>
              {currentPnL >= 0 ? '+' : ''}₩{formatKRW(currentPnL)}
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-gray-400">
            <span>평단가: ${formatPrice(currentPosition.avgPrice)}</span>
            <span>수량: {currentPosition.totalQuantity.toFixed(4)}</span>
          </div>
          {/* 스윙 매매 진행 상황 */}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-gray-500">진행:</span>
            <span className="text-[11px] px-2 py-1 rounded font-mono" style={{
              background: 'rgba(0, 255, 255, 0.15)',
              border: '1px solid rgba(0, 255, 255, 0.3)',
              color: '#00ffff',
            }}>
              {currentPosition.currentStage}/5단계
            </span>
            <span className="text-[11px] px-2 py-1 rounded font-mono" style={{
              background: 'rgba(0, 255, 136, 0.15)',
              border: '1px solid rgba(0, 255, 136, 0.3)',
              color: '#00ff88',
            }}>
              노출 {currentPosition.currentStage * 200}%
            </span>
          </div>
          <div className="flex gap-2 mt-2">
            {onManualClose && (
              <Button
                variant="destructive"
                size="sm"
                onClick={onManualClose}
                className="w-full h-8 text-sm font-semibold"
                style={{
                  background: 'linear-gradient(90deg, rgba(255, 0, 136, 0.8) 0%, rgba(255, 50, 100, 0.8) 100%)',
                  border: '1px solid rgba(255, 0, 136, 0.5)',
                  boxShadow: '0 0 15px rgba(255, 0, 136, 0.4)',
                }}
                disabled={isProcessing}
              >
                {isProcessing ? '처리중...' : '즉시 청산'}
              </Button>
            )}
          </div>
        </div>
      )}
      
      {/* Trade Logs - 최근 3개만 표시 */}
      <div className="relative z-10 px-3 py-2">
        <div className="flex items-center gap-1.5 px-2 mb-1.5">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-xs text-cyan-400/70 font-medium">매매 로그</span>
          <span className="text-[10px] text-gray-500">({tradeLogs.length})</span>
        </div>
        <div className="max-h-16 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-cyan-500/30 scrollbar-track-transparent">
          {tradeLogs.length === 0 ? (
            <div className="text-center py-2 text-xs text-gray-500">
              {isEnabled ? '🔍 시그널 대기 중...' : '자동매매를 시작하세요'}
            </div>
          ) : (
            tradeLogs.map((log) => (
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
      
      {/* 🔧 스크리닝 로그 제거 - 차트 배경으로 이동됨 */}
      
      {/* 🤖 AI 시장 분석 패널 */}
      {isEnabled && aiEnabled && (
        <MarketAnalysisPanel 
          analysis={aiAnalysis} 
          isAnalyzing={isAiAnalyzing}
          enabled={aiEnabled}
        />
      )}
      
      {/* Scalping Suitability Indicator */}
      <ScalpingIndicator />
      
      {/* Status Message */}
      <div className="relative z-10 mx-3 mb-3 px-3 py-2 rounded-md text-xs font-medium text-center" style={{
        background: state.currentPosition ? 'rgba(0, 255, 136, 0.1)' :
          state.pendingSignal ? 'rgba(255, 255, 0, 0.1)' :
          isEnabled ? 'rgba(0, 255, 255, 0.1)' : 'rgba(50, 50, 70, 0.5)',
        border: `1px solid ${state.currentPosition ? 'rgba(0, 255, 136, 0.3)' :
          state.pendingSignal ? 'rgba(255, 255, 0, 0.3)' :
          isEnabled ? 'rgba(0, 255, 255, 0.3)' : 'rgba(100, 100, 120, 0.3)'}`,
        color: state.currentPosition ? '#00ff88' :
          state.pendingSignal ? '#ffff00' :
          isEnabled ? '#00ffff' : '#888',
        textShadow: state.currentPosition ? '0 0 8px rgba(0, 255, 136, 0.5)' :
          state.pendingSignal ? '0 0 8px rgba(255, 255, 0, 0.5)' :
          isEnabled ? '0 0 8px rgba(0, 255, 255, 0.5)' : 'none',
      }}>
        {state.statusMessage || (isEnabled ? '🔍 기술적 분석 스캔 중...' : '자동매매를 시작하세요')}
      </div>
      
      {/* Warning */}
      {!isEnabled && (
        <div className="relative z-10 px-4 py-2" style={{
          background: 'rgba(255, 200, 0, 0.1)',
          borderTop: '1px solid rgba(255, 200, 0, 0.2)',
        }}>
          <div className="flex items-center gap-2 text-[10px]" style={{ color: '#ffcc00' }}>
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
  
  const getStarColor = (stars: number) => {
    if (stars >= 4) return '#00ff88';
    if (stars >= 2) return '#ffff00';
    return '#ff0088';
  };
  
  return (
    <div className="relative z-10 mx-3 px-3 py-2 rounded-md" style={{
      background: 'rgba(0, 255, 255, 0.05)',
      border: '1px solid rgba(0, 255, 255, 0.15)',
    }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500">스캘핑 적합도</span>
          <span className="text-[10px] font-semibold" style={{
            color: getStarColor(rating.stars),
            textShadow: `0 0 6px ${getStarColor(rating.stars)}80`,
          }}>
            {rating.label}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Star
              key={i}
              className="w-3 h-3"
              style={{
                color: i <= rating.stars ? getStarColor(rating.stars) : '#333',
                fill: i <= rating.stars ? getStarColor(rating.stars) : 'transparent',
                filter: i <= rating.stars ? `drop-shadow(0 0 4px ${getStarColor(rating.stars)}80)` : 'none',
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-1 text-[9px] text-gray-500">
        <span>거래량: <span style={{ color: getStarColor(rating.stars) }}>{rating.volume}</span></span>
        <span>변동성: <span style={{ color: getStarColor(rating.stars) }}>{rating.volatility}</span></span>
      </div>
    </div>
  );
};

// Trade Log Item
const TradeLogItem = ({ log, krwRate, onSelectSymbol }: { 
  log: PyramidTradeLog; 
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
      case 'add':
        return '📈';
      case 'partial_tp':
        return '💰';
      case 'tp':
        return '✅';
      case 'sl':
        return '🛑';
      case 'emergency':
        return '🚨';
      case 'time_exit':
        return '⏰';
      case 'error':
        return '⚠️';
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
      case 'add':
        return '추가 매수';
      case 'partial_tp':
        return '분할 익절';
      case 'tp':
        return '익절';
      case 'sl':
        return '손절';
      case 'emergency':
        return '긴급 탈출';
      case 'time_exit':
        return '시간 청산';
      case 'error':
        return '오류';
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
  
  // 사유 표시 (error, pending, emergency만)
  const showReason = ['error', 'pending', 'emergency'].includes(log.action);
  
  return (
    <div 
      onClick={() => onSelectSymbol?.(log.symbol)}
      className="px-3 py-2 rounded text-xs cursor-pointer transition-all"
      style={{
        background: log.action === 'error' ? 'rgba(255, 0, 136, 0.1)' : 
          log.action === 'emergency' ? 'rgba(255, 100, 0, 0.1)' :
          log.action === 'pending' ? 'rgba(0, 255, 255, 0.1)' :
          'rgba(30, 30, 45, 0.5)',
        border: `1px solid ${log.action === 'error' ? 'rgba(255, 0, 136, 0.2)' : 
          log.action === 'emergency' ? 'rgba(255, 100, 0, 0.2)' :
          log.action === 'pending' ? 'rgba(0, 255, 255, 0.2)' :
          'rgba(0, 255, 255, 0.1)'}`,
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm">{getActionIcon()}</span>
        <span className="text-gray-500">{formatTime(log.timestamp)}</span>
        <span className="font-semibold" style={{ color: '#00ffff' }}>{log.symbol.replace('USDT', '')}</span>
        <span className="text-gray-400">{getActionText()}</span>
        {log.pnl !== undefined && (
          <span className="font-mono ml-auto font-semibold" style={{
            color: log.pnl >= 0 ? '#00ff88' : '#ff0088',
            textShadow: log.pnl >= 0 ? '0 0 6px rgba(0, 255, 136, 0.5)' : '0 0 6px rgba(255, 0, 136, 0.5)',
          }}>
            {log.pnl >= 0 ? '+' : ''}₩{formatKRW(log.pnl)}
          </span>
        )}
      </div>
      {showReason && log.reason && (
        <div className="mt-1 ml-6 text-[10px] text-gray-500 truncate">
          → {log.reason}
        </div>
      )}
    </div>
  );
};

export default AutoTradingPanel;
