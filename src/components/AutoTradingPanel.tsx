import { useState, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Bot, TrendingUp, TrendingDown, Activity, Clock, AlertTriangle, Star, RefreshCw, Wallet, LogOut, Shield, ShieldOff, Crown, Brain, Zap, SkipForward, Pause, Play } from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { LimitOrderTradingState, LimitOrderTradeLog } from '@/hooks/useLimitOrderTrading';
import { formatPrice } from '@/lib/binance';
import { useBinanceApi } from '@/hooks/useBinanceApi';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import TradingRecordModal from './TradingRecordModal';
import OrderBook from './OrderBook';
import { LIMIT_ORDER_CONFIG } from '@/lib/limitOrderConfig';

// 스캘핑 시간대 적합도 데이터
const getScalpingRating = () => {
  const now = new Date();
  const koreaOffset = 9 * 60;
  const utcOffset = now.getTimezoneOffset();
  const koreaTime = new Date(now.getTime() + (koreaOffset + utcOffset) * 60 * 1000);
  const hour = koreaTime.getHours();
  
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
  state: LimitOrderTradingState;
  onToggle: () => void;
  onManualClose?: () => void;
  onCancelEntry?: () => void;
  onSkipSignal?: () => void;
  onSwapSignal?: () => void;
  onToggleLossProtection?: () => void;
  onClearCooldown?: () => void;
  onMarketEntry?: (symbol: string, side: 'long' | 'short', splitCount?: number) => void;
  onLimitEntry?: (symbol: string, side: 'long' | 'short', price: number, splitCount?: number) => void;
  currentPrice?: number;
  krwRate: number;
  leverage: number;
  onLeverageChange: (leverage: number) => void;
  onSelectSymbol?: (symbol: string) => void;
  onBalanceChange?: (balance: number) => void;
  refreshTrigger?: number;
  scanStatus?: {
    isScanning: boolean;
    isPaused?: boolean;
    tickersCount: number;
    screenedCount: number;
    signalsCount: number;
    lastScanTime: number;
  };
  onPassSignal?: () => void;
  onTogglePause?: () => void;
  majorCoinMode?: boolean;
  onToggleMajorCoinMode?: () => void;
  onToggleAiAnalysis?: () => void;
  onAnalyzeAI?: () => void; // AI 분석 버튼 클릭 콜백
  viewingSymbol?: string; // 호가창에 표시할 종목
  onOpenOrdersChange?: (orders: { orderId: number; price: number; side: 'BUY' | 'SELL'; origQty: number; executedQty: number; }[]) => void; // 미체결 주문 변경 콜백
}

const AutoTradingPanel = ({ 
  state, 
  onToggle, 
  onManualClose,
  onCancelEntry,
  onSkipSignal,
  onSwapSignal,
  onToggleLossProtection,
  onClearCooldown,
  onMarketEntry,
  onLimitEntry,
  currentPrice = 0,
  krwRate,
  leverage,
  onLeverageChange,
  onSelectSymbol,
  onBalanceChange,
  refreshTrigger = 0,
  scanStatus,
  majorCoinMode = false,
  onToggleMajorCoinMode,
  onToggleAiAnalysis,
  onAnalyzeAI,
  viewingSymbol,
  onPassSignal,
  onTogglePause,
  onOpenOrdersChange,
}: AutoTradingPanelProps) => {
  const { isEnabled, isProcessing, currentPosition, pendingSignal, todayStats, tradeLogs, aiAnalysis, isAiAnalyzing, aiEnabled } = state;
  const { user, signOut } = useAuth();
  const { getBalances, getIncomeHistory, getOpenOrders, cancelOrder, cancelAllOrders } = useBinanceApi();
  
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
  
  // 미체결 주문 상태
  interface OpenOrder {
    orderId: number;
    symbol: string;
    side: 'BUY' | 'SELL';
    price: number;
    origQty: number;
    executedQty: number;
    status: string;
  }
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [splitCount, setSplitCount] = useState<1 | 5 | 10>(5);
  const activeSymbol = useMemo(
    () => state.currentSymbol || viewingSymbol || 'BTCUSDT',
    [state.currentSymbol, viewingSymbol]
  );
  
  // 미체결 주문 조회
  const fetchOpenOrders = async (symbol: string) => {
    try {
      const orders = await getOpenOrders(symbol);
      if (orders) {
        setOpenOrders(orders.map((o: any) => ({
          orderId: o.orderId,
          symbol: o.symbol,
          side: o.side,
          price: parseFloat(o.price),
          origQty: parseFloat(o.origQty),
          executedQty: parseFloat(o.executedQty),
          status: o.status,
        })));
      }
    } catch (error) {
      console.error('미체결 주문 조회 실패:', error);
    }
  };
  
  // 주문 취소
  const handleCancelOrder = async (orderId: number) => {
    try {
      await cancelOrder(activeSymbol, orderId);
      console.log('주문이 취소되었습니다');
      fetchOpenOrders(activeSymbol);
    } catch (error: any) {
      console.error(`취소 실패: ${error.message}`);
    }
  };
  
  // 일괄 취소
  const handleCancelAllOrders = async () => {
    try {
      await cancelAllOrders(activeSymbol);
      console.log('모든 주문이 취소되었습니다');
      setOpenOrders([]);
    } catch (error: any) {
      console.error(`일괄 취소 실패: ${error.message}`);
    }
  };
  
  // 심볼 변경/초기 진입 시 미체결 주문 조회 (2초 간격으로 더 자주 갱신)
  useEffect(() => {
    fetchOpenOrders(activeSymbol);
    const interval = setInterval(() => fetchOpenOrders(activeSymbol), 2000);
    return () => clearInterval(interval);
  }, [activeSymbol]);
  
  // 미체결 주문 변경 시 부모 컴포넌트에 알림
  useEffect(() => {
    onOpenOrdersChange?.(openOrders.map(o => ({
      orderId: o.orderId,
      price: o.price,
      side: o.side,
      origQty: o.origQty,
      executedQty: o.executedQty,
    })));
  }, [openOrders, onOpenOrdersChange]);
  
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
          is_testnet: false,
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
        // 화면 표시와 포지션 사이징 모두 총 잔고 사용
        // (가용 잔고 사용 시 이미 포지션 있으면 95% 계산이 적게 됨)
        const totalBalance =
          parseFloat(usdtBalance.balance) ||
          parseFloat(usdtBalance.crossWalletBalance) ||
          0;

        setBalanceUSD(totalBalance);
        onBalanceChange?.(totalBalance);  // 총 잔고 기준으로 95% 계산

        // 바이낸스 income history 조회
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
  
  // 현재 포지션 PnL - 바이낸스 unrealizedPnl 기반 + 예상 청산 수수료 차감
  const [lastValidPnL, setLastValidPnL] = useState(0);
  
  const currentPnL = useMemo(() => {
    // 포지션이 없거나, 체결 수량이 없으면 0
    if (!currentPosition || currentPosition.filledQuantity === 0) {
      return 0;
    }
    
    // 바이낸스 unrealizedPnl 사용 (수수료 미포함 그로스 PnL)
    // 여기에 예상 청산 수수료를 빼서 순손익 표시
    let grossPnl = 0;
    
    if (currentPosition.unrealizedPnl !== undefined && currentPosition.unrealizedPnl !== 0) {
      // 바이낸스 API 값 사용
      grossPnl = currentPosition.unrealizedPnl;
    } else {
      // 폴백: 로컬 계산
      if (!currentPosition.avgPrice || currentPosition.avgPrice === 0 || !currentPrice || currentPrice === 0) {
        return lastValidPnL;
      }
      const direction = currentPosition.side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - currentPosition.avgPrice) * direction;
      grossPnl = priceDiff * currentPosition.filledQuantity;
    }
    
    // 예상 수수료 차감 (진입: 0.02% maker, 청산: 0.05% taker)
    const entryFeeRate = 0.0002;
    const exitFeeRate = 0.0005;
    const markPrice = currentPosition.markPrice || currentPrice || currentPosition.avgPrice;
    const entryNotional = currentPosition.avgPrice * currentPosition.filledQuantity;
    const exitNotional = markPrice * currentPosition.filledQuantity;
    const totalFee = (entryNotional * entryFeeRate) + (exitNotional * exitFeeRate);
    
    return grossPnl - totalFee;
  }, [currentPosition, currentPrice, lastValidPnL]);
  
  // 유효한 PnL 값 업데이트 (폴백용)
  useEffect(() => {
    if (currentPosition && currentPosition.filledQuantity > 0 && currentPosition.avgPrice > 0 && currentPrice && currentPrice > 0) {
      const direction = currentPosition.side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - currentPosition.avgPrice) * direction;
      const grossPnl = priceDiff * currentPosition.filledQuantity;
      
      // 수수료 포함
      const entryFeeRate = 0.0002;
      const exitFeeRate = 0.0005;
      const entryNotional = currentPosition.avgPrice * currentPosition.filledQuantity;
      const exitNotional = currentPrice * currentPosition.filledQuantity;
      const totalFee = (entryNotional * entryFeeRate) + (exitNotional * exitFeeRate);
      
      setLastValidPnL(grossPnl - totalFee);
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
  const realizedPnLUsd = todayRealizedPnL !== 0 ? todayRealizedPnL : todayStats.totalPnL;

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
      
      
      {/* Pending Signal */}
      {pendingSignal && !currentPosition && (
        <div className="relative z-10 px-3 py-2 lg:px-4 lg:py-3 shrink-0" style={{
          background: 'linear-gradient(90deg, rgba(255, 255, 0, 0.1) 0%, rgba(255, 200, 0, 0.05) 100%)',
          borderBottom: '1px solid rgba(255, 255, 0, 0.2)',
        }}>
          <div className="flex items-center justify-between">
            <div 
              className="flex items-center gap-2 cursor-pointer hover:opacity-80"
              onClick={() => onSelectSymbol?.(pendingSignal.symbol)}
            >
              <Clock className="w-3 h-3 lg:w-4 lg:h-4 text-yellow-400 animate-pulse" />
              <span className="font-semibold text-xs lg:text-sm text-yellow-400">
                {pendingSignal.symbol} {pendingSignal.direction === 'short' ? '숏' : '롱'} 대기
              </span>
            </div>
            {onSkipSignal && (
              <Button
                size="sm"
                variant="outline"
                onClick={onSkipSignal}
                className="h-5 lg:h-6 px-1.5 lg:px-2 text-[9px] lg:text-[10px]"
                style={{
                  background: 'rgba(255, 0, 136, 0.1)',
                  border: '1px solid rgba(255, 0, 136, 0.3)',
                  color: '#ff0088',
                }}
              >
                패스
              </Button>
            )}
          </div>
        </div>
      )}
      

      {/* Current Position Status - 항상 표시 */}
      <div className="relative z-10 px-3 py-2 lg:px-4 lg:py-3 shrink-0" style={{
        background: currentPosition && (currentPosition.entryPhase === 'active' || (currentPosition.filledQuantity > 0 && currentPosition.avgPrice > 0))
          ? currentPosition.side === 'long' 
            ? 'linear-gradient(90deg, rgba(0, 255, 136, 0.1) 0%, transparent 100%)'
            : 'linear-gradient(90deg, rgba(255, 0, 136, 0.1) 0%, transparent 100%)'
          : 'rgba(30, 30, 50, 0.5)',
        borderBottom: currentPosition && (currentPosition.entryPhase === 'active' || (currentPosition.filledQuantity > 0 && currentPosition.avgPrice > 0))
          ? `1px solid ${currentPosition.side === 'long' ? 'rgba(0, 255, 136, 0.2)' : 'rgba(255, 0, 136, 0.2)'}`
          : '1px solid rgba(100, 100, 120, 0.2)',
      }}>
        {currentPosition && (currentPosition.entryPhase === 'active' || (currentPosition.filledQuantity > 0 && currentPosition.avgPrice > 0)) ? (
          <>
            <div className="flex items-center justify-between mb-1 lg:mb-2">
              <div className="flex items-center gap-2">
                {currentPosition.side === 'long' ? (
                  <TrendingUp className="w-3 h-3 lg:w-4 lg:h-4" style={{ color: '#00ff88' }} />
                ) : (
                  <TrendingDown className="w-3 h-3 lg:w-4 lg:h-4" style={{ color: '#ff0088' }} />
                )}
                <span className="font-semibold text-xs lg:text-sm" style={{
                  color: currentPosition.side === 'long' ? '#00ff88' : '#ff0088',
                }}>
                  {currentPosition.symbol.replace('USDT', '')} {currentPosition.side === 'long' ? '롱' : '숏'}
                  {currentPosition.entryPhase === 'waiting' && (
                    <span className="ml-1 text-[9px] text-yellow-400">(체결중)</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm lg:text-base font-bold font-mono" style={{
                  color: currentPnL >= 0 ? '#00ff88' : '#ff0088',
                }}>
                  {currentPnL >= 0 ? '+' : ''}{currentPnL.toFixed(2)} USDT
                </span>
                <span className="text-sm lg:text-base font-bold font-mono" style={{
                  color: currentPnL >= 0 ? 'rgba(0, 255, 136, 0.8)' : 'rgba(255, 0, 136, 0.8)',
                }}>
                  ({currentPnL >= 0 ? '+' : ''}₩{formatKRW(currentPnL)})
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] lg:text-xs text-gray-400">
              <span>평단가: ${formatPrice(currentPosition.avgPrice)}</span>
              <span>수량: {currentPosition.filledQuantity.toFixed(4)}</span>
            </div>
            <div className="flex gap-2 mt-1.5 lg:mt-2">
              {onManualClose && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onManualClose}
                  className="w-full h-6 lg:h-8 text-xs lg:text-sm font-semibold"
                  style={{
                    background: 'linear-gradient(90deg, rgba(255, 0, 136, 0.8) 0%, rgba(255, 50, 100, 0.8) 100%)',
                    border: '1px solid rgba(255, 0, 136, 0.5)',
                  }}
                  disabled={isProcessing}
                >
                  {isProcessing ? '처리중...' : '즉시 청산'}
                </Button>
              )}
            </div>
          </>
        ) : currentPosition && currentPosition.entryPhase === 'waiting' ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {currentPosition.side === 'long' ? (
                <TrendingUp className="w-3 h-3 lg:w-4 lg:h-4 animate-pulse" style={{ color: '#00ff88' }} />
              ) : (
                <TrendingDown className="w-3 h-3 lg:w-4 lg:h-4 animate-pulse" style={{ color: '#ff0088' }} />
              )}
              <span className="text-xs lg:text-sm" style={{
                color: currentPosition.side === 'long' ? '#00ff88' : '#ff0088',
              }}>
                {currentPosition.symbol.replace('USDT', '')} 체결 대기중...
              </span>
            </div>
            <div className="text-right">
              <span className="text-[9px] lg:text-[10px] text-gray-500">목표수량</span>
              <div className="text-xs lg:text-sm font-mono font-semibold text-yellow-400">
                {currentPosition.totalQuantity.toFixed(4)}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-3 h-3 lg:w-4 lg:h-4 text-gray-500" />
              <span className="text-xs lg:text-sm text-gray-400">포지션 없음</span>
            </div>
            <div className="text-right">
              <span className="text-[9px] lg:text-[10px] text-gray-500">평가손익</span>
              <div className="text-xs lg:text-sm font-mono font-semibold text-gray-500">₩0</div>
            </div>
          </div>
        )}
      </div>

      {/* 잔고 & 실현손익 (컴팩트) */}
      <div className="relative z-10 px-2 py-1.5 lg:px-3 lg:py-2 shrink-0" style={{
        background: 'rgba(20, 20, 35, 0.8)',
        borderBottom: '1px solid rgba(100, 100, 120, 0.2)',
      }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-3 h-3 text-cyan-400" />
            <span className="text-[9px] lg:text-[10px] text-gray-400">잔고</span>
            <span className="text-[10px] lg:text-xs font-mono font-semibold text-cyan-300">
              {balanceLoading ? '...' : `₩${formatKRW(balanceUSD)}`}
            </span>
            <button onClick={fetchRealBalance} className="p-0.5 hover:bg-cyan-500/20 rounded">
              <RefreshCw className={cn("w-2 h-2 text-cyan-400/60", balanceLoading && "animate-spin")} />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-gray-500">수익률</span>
              <span className="text-[10px] lg:text-xs font-mono font-bold" style={{
                color: dailyPnLPercent >= 0 ? '#00ff88' : '#ff0088',
              }}>
                {dailyPnL >= 0 ? '+' : ''}{dailyPnLPercentStr}%
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-gray-500">손익</span>
              <span className="text-[10px] lg:text-xs font-mono font-semibold" style={{
                color: realizedPnLUsd >= 0 ? '#00ff88' : '#ff0088',
              }}>
                {realizedPnLUsd >= 0 ? '+' : ''}₩{formatKRW(realizedPnLUsd)}
              </span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Trade Logs - 제거됨: TradingLogsPanel로 분리 */}

      {/* Order Book - 호가창 (스캔 상태와 관계없이 항상 표시) */}
      <OrderBook 
        symbol={activeSymbol} 
        
        hasPosition={!!currentPosition}
        openOrders={openOrders}
        splitCount={splitCount}
        aiAnalysis={aiAnalysis}
        aiEnabled={aiEnabled}
        isAiAnalyzing={isAiAnalyzing}
        onAnalyzeAI={onAnalyzeAI}
        onMarketEntry={(side) => {
          console.log('📌 [AutoTradingPanel] onMarketEntry 호출:', side, splitCount);
          onMarketEntry?.(activeSymbol, side, splitCount);
        }}
        onPlaceOrder={(side, price) => {
          console.log('📌 [AutoTradingPanel] onPlaceOrder 호출:', side, price, splitCount);
          onLimitEntry?.(activeSymbol, side, price, splitCount);
          // 주문 직후 즉시 미체결 갱신
          setTimeout(() => fetchOpenOrders(activeSymbol), 500);
        }}
        onCancelOrder={handleCancelOrder}
        onCancelAllOrders={handleCancelAllOrders}
        onMarketClose={onManualClose}
      />
      
      {/* 🆕 시그널 발견 & 일시정지 상태 - 사이버펑크 스타일 */}
      {scanStatus?.isPaused && scanStatus.signalsCount > 0 && !currentPosition && (
        <div 
          className="relative z-10 shrink-0 overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(10, 10, 20, 0.95) 0%, rgba(20, 10, 30, 0.95) 50%, rgba(10, 15, 25, 0.95) 100%)',
            borderTop: '2px solid',
            borderImage: 'linear-gradient(90deg, transparent, #00ffff, #ff0088, transparent) 1',
          }}
        >
          {/* 배경 그리드 */}
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: `
                linear-gradient(rgba(0, 255, 255, 0.5) 1px, transparent 1px),
                linear-gradient(90deg, rgba(0, 255, 255, 0.5) 1px, transparent 1px)
              `,
              backgroundSize: '12px 12px',
            }}
          />
          
          {/* 글로우 효과 */}
          <div
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(ellipse at left, rgba(0, 255, 255, 0.1) 0%, transparent 50%)',
            }}
          />

          <div className="relative z-10 px-3 py-2 lg:px-4 lg:py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="relative"
                  style={{
                    filter: 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.8))',
                  }}
                >
                  <Zap className="w-4 h-4 lg:w-5 lg:h-5 text-cyan-400 animate-pulse" />
                </div>
                <div className="flex flex-col">
                  <span 
                    className="font-bold text-xs lg:text-sm tracking-wider uppercase"
                    style={{
                      color: '#00ffff',
                      textShadow: '0 0 10px rgba(0, 255, 255, 0.6), 0 0 20px rgba(0, 255, 255, 0.3)',
                    }}
                  >
                    시그널 대기중
                  </span>
                  <span className="text-[9px] lg:text-[10px] text-cyan-400/70 font-mono">
                    {scanStatus.signalsCount}개 발견됨
                  </span>
                </div>
              </div>
              <Button
                size="sm"
                onClick={onPassSignal}
                className="h-6 lg:h-7 px-3 lg:px-4 text-[10px] lg:text-xs font-bold tracking-wider uppercase border-0"
                style={{
                  background: 'linear-gradient(135deg, rgba(255, 0, 136, 0.8) 0%, rgba(200, 0, 100, 0.9) 100%)',
                  color: '#fff',
                  boxShadow: '0 0 15px rgba(255, 0, 136, 0.5), inset 0 0 10px rgba(255, 255, 255, 0.1)',
                  textShadow: '0 0 5px rgba(255, 255, 255, 0.5)',
                }}
              >
                <SkipForward className="w-3.5 h-3.5 mr-1" style={{ filter: 'drop-shadow(0 0 3px #fff)' }} />
                패스
              </Button>
            </div>
          </div>
          
          {/* 하단 네온 라인 */}
          <div
            className="h-[1px] w-full"
            style={{
              background: 'linear-gradient(90deg, transparent 0%, #00ffff 30%, #ff0088 70%, transparent 100%)',
              boxShadow: '0 0 8px rgba(0, 255, 255, 0.4)',
            }}
          />
        </div>
      )}
      
    </div>
  );
};

interface ScalpingIndicatorProps {
  statusMessage?: string;
  hasPosition?: boolean;
  hasPendingSignal?: boolean;
  isEnabled?: boolean;
}

// Scalping Indicator - exported for use in other components
export const ScalpingIndicator = ({ 
  statusMessage, 
  hasPosition = false, 
  hasPendingSignal = false, 
  isEnabled = false 
}: ScalpingIndicatorProps) => {
  const [rating, setRating] = useState(getScalpingRating());
  
  useEffect(() => {
    const interval = setInterval(() => {
      setRating(getScalpingRating());
    }, 60000);
    return () => clearInterval(interval);
  }, []);
  
  const getStarColor = (stars: number) => {
    if (stars >= 4) return '#00ff88';
    if (stars >= 2) return '#ffff00';
    return '#ff0088';
  };

  const getStatusColor = () => {
    if (hasPosition) return '#00ff88';
    if (hasPendingSignal) return '#ffff00';
    if (isEnabled) return '#00ffff';
    return '#888';
  };

  const getStatusBg = () => {
    if (hasPosition) return 'rgba(0, 255, 136, 0.1)';
    if (hasPendingSignal) return 'rgba(255, 255, 0, 0.1)';
    if (isEnabled) return 'rgba(0, 255, 255, 0.1)';
    return 'rgba(50, 50, 70, 0.5)';
  };

  const getStatusBorder = () => {
    if (hasPosition) return 'rgba(0, 255, 136, 0.3)';
    if (hasPendingSignal) return 'rgba(255, 255, 0, 0.3)';
    if (isEnabled) return 'rgba(0, 255, 255, 0.3)';
    return 'rgba(100, 100, 120, 0.3)';
  };
  
  return (
    <div className="space-y-1">
      {/* 스캘핑 적합도 */}
      <div className="relative z-10 px-3 py-2 rounded-md" style={{
        background: 'rgba(0, 255, 255, 0.05)',
        border: '1px solid rgba(0, 255, 255, 0.15)',
      }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-500">스캘핑 적합도</span>
            <span className="text-[10px] font-semibold" style={{
              color: getStarColor(rating.stars),
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
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 스캔 현황 메시지 */}
      {statusMessage !== undefined && (
        <div className="relative z-10 px-3 py-2 rounded-md text-xs font-medium text-center" style={{
          background: getStatusBg(),
          border: `1px solid ${getStatusBorder()}`,
          color: getStatusColor(),
        }}>
          {statusMessage || (isEnabled ? '🔍 시그널 스캔 중...' : '자동매매를 시작하세요')}
        </div>
      )}
    </div>
  );
};

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

export default AutoTradingPanel;
