import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, History, ArrowDownCircle, ArrowUpCircle, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DailyRecord {
  date: string;
  closingBalance: number;
  dailyPnL: number;
  deposit: number;
  withdrawal: number;
}

interface TradeLog {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnlUsd: number;
  createdAt: string;
}

interface MonthlyStats {
  totalPnL: number;
  totalDeposit: number;
  totalWithdrawal: number;
  startBalance: number;
  endBalance: number;
  dailyRecords: DailyRecord[];
}

interface TradingRecordModalProps {
  krwRate: number;
  isTestnet?: boolean;
  refreshTrigger?: number;
}

const TradingRecordModal = ({ krwRate, isTestnet = false, refreshTrigger = 0 }: TradingRecordModalProps) => {
  const [open, setOpen] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStats | null>(null);
  const [cumulativeStats, setCumulativeStats] = useState({ 
    totalPnL: 0, 
    totalDeposit: 0, 
    totalWithdrawal: 0,
    firstBalance: 0, 
    latestBalance: 0 
  });
  const [todayTrades, setTodayTrades] = useState<TradeLog[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMonthlyRecords = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
      const endDate = selectedMonth === 12 
        ? `${selectedYear + 1}-01-01`
        : `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-01`;

      const { data, error } = await supabase
        .from('daily_balance_snapshots')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_testnet', isTestnet)
        .gte('snapshot_date', startDate)
        .lt('snapshot_date', endDate)
        .order('snapshot_date', { ascending: true });

      if (error) {
        console.error('Failed to fetch records:', error);
        return;
      }

      const prevMonthEnd = new Date(selectedYear, selectedMonth - 1, 0);
      const prevMonthEndDate = prevMonthEnd.toISOString().split('T')[0];
      
      const { data: prevData } = await supabase
        .from('daily_balance_snapshots')
        .select('closing_balance_usd')
        .eq('user_id', user.id)
        .eq('is_testnet', isTestnet)
        .eq('snapshot_date', prevMonthEndDate)
        .maybeSingle();

      if (data && data.length > 0) {
        const dailyRecords: DailyRecord[] = data.map((snapshot: any) => ({
          date: snapshot.snapshot_date,
          closingBalance: snapshot.closing_balance_usd,
          dailyPnL: snapshot.daily_income_usd || 0,
          deposit: snapshot.deposit_usd || 0,
          withdrawal: snapshot.withdrawal_usd || 0,
        }));

        const totalPnL = dailyRecords.reduce((sum, r) => sum + r.dailyPnL, 0);
        const totalDeposit = dailyRecords.reduce((sum, r) => sum + r.deposit, 0);
        const totalWithdrawal = dailyRecords.reduce((sum, r) => sum + r.withdrawal, 0);
        
        const firstDayIncome = data[0].daily_income_usd || 0;
        const firstDayDeposit = data[0].deposit_usd || 0;
        const startBalance = prevData?.closing_balance_usd || (data[0].closing_balance_usd - firstDayIncome - firstDayDeposit);
        const endBalance = data[data.length - 1].closing_balance_usd;

        setMonthlyStats({
          totalPnL,
          totalDeposit,
          totalWithdrawal,
          startBalance,
          endBalance,
          dailyRecords: dailyRecords.reverse(),
        });
      } else {
        setMonthlyStats(null);
      }
    } catch (error) {
      console.error('Error fetching monthly records:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCumulativeStats = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('daily_balance_snapshots')
        .select('snapshot_date, closing_balance_usd, daily_income_usd, deposit_usd, withdrawal_usd')
        .eq('user_id', user.id)
        .eq('is_testnet', isTestnet)
        .order('snapshot_date', { ascending: true });

      if (error) {
        console.error('Failed to fetch cumulative stats:', error);
        return;
      }

      if (data && data.length > 0) {
        const firstDayIncome = data[0].daily_income_usd || 0;
        const firstDayDeposit = data[0].deposit_usd || 0;
        const firstBalance = data[0].closing_balance_usd - firstDayIncome - firstDayDeposit;
        const latestBalance = data[data.length - 1].closing_balance_usd;
        const totalPnL = data.reduce((sum: number, s: any) => sum + (s.daily_income_usd || 0), 0);
        const totalDeposit = data.reduce((sum: number, s: any) => sum + (s.deposit_usd || 0), 0);
        const totalWithdrawal = data.reduce((sum: number, s: any) => sum + (s.withdrawal_usd || 0), 0);

        setCumulativeStats({ totalPnL, totalDeposit, totalWithdrawal, firstBalance, latestBalance });
      }
    } catch (error) {
      console.error('Error fetching cumulative stats:', error);
    }
  };

  // 🆕 오늘 개별 거래 내역 조회
  const fetchTodayTrades = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 한국시간 기준 오늘 날짜
      const now = new Date();
      const koreaOffset = 9 * 60;
      const utcOffset = now.getTimezoneOffset();
      const koreaTime = new Date(now.getTime() + (koreaOffset + utcOffset) * 60 * 1000);
      const today = `${koreaTime.getFullYear()}-${String(koreaTime.getMonth() + 1).padStart(2, '0')}-${String(koreaTime.getDate()).padStart(2, '0')}`;

      const { data, error } = await supabase
        .from('daily_trading_logs')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_testnet', isTestnet)
        .eq('trade_date', today)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Failed to fetch today trades:', error);
        return;
      }

      if (data) {
        const trades: TradeLog[] = data.map((t: any) => ({
          id: t.id,
          symbol: t.symbol,
          side: t.side,
          entryPrice: Number(t.entry_price),
          exitPrice: Number(t.exit_price),
          quantity: Number(t.quantity),
          pnlUsd: Number(t.pnl_usd),
          createdAt: t.created_at,
        }));
        setTodayTrades(trades);
      }
    } catch (error) {
      console.error('Error fetching today trades:', error);
    }
  };

  useEffect(() => {
    if (open) {
      fetchMonthlyRecords();
      fetchCumulativeStats();
      fetchTodayTrades();
    }
  }, [open, selectedYear, selectedMonth, refreshTrigger, isTestnet]);

  const handlePrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedYear(y => y - 1);
      setSelectedMonth(12);
    } else {
      setSelectedMonth(m => m - 1);
    }
  };

  const handleNextMonth = () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    if (selectedYear > currentYear || (selectedYear === currentYear && selectedMonth >= currentMonth)) {
      return;
    }

    if (selectedMonth === 12) {
      setSelectedYear(y => y + 1);
      setSelectedMonth(1);
    } else {
      setSelectedMonth(m => m + 1);
    }
  };

  const formatKRW = (usd: number) => {
    const krw = usd * krwRate;
    return krw.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const profitPercent = monthlyStats && monthlyStats.startBalance > 0
    ? ((monthlyStats.totalPnL / monthlyStats.startBalance) * 100).toFixed(2)
    : '0.00';

  const cumulativeProfitPercent = cumulativeStats.firstBalance > 0
    ? ((cumulativeStats.totalPnL / cumulativeStats.firstBalance) * 100).toFixed(2)
    : '0.00';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-[10px] h-6 px-2 border-border"
        >
          <History className="w-3 h-3 mr-1" />
          거래기록
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">거래 기록</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Month Navigation */}
          <div className="flex items-center justify-between bg-secondary/50 rounded-lg px-3 py-2">
            <Button variant="ghost" size="sm" onClick={handlePrevMonth} className="h-7 w-7 p-0">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="font-bold text-sm">{selectedYear}년 {selectedMonth}월</span>
            <Button variant="ghost" size="sm" onClick={handleNextMonth} className="h-7 w-7 p-0">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Monthly Summary */}
          {monthlyStats && (
            <div className="bg-card border border-border rounded-lg p-3 space-y-2">
              <div className="text-[10px] text-muted-foreground">월간 요약</div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-secondary/30 rounded p-2">
                  <div className="text-[10px] text-muted-foreground">순수 거래손익</div>
                  <div className={cn(
                    "text-sm font-bold font-mono",
                    monthlyStats.totalPnL >= 0 ? "text-red-400" : "text-blue-400"
                  )}>
                    {monthlyStats.totalPnL >= 0 ? '+' : ''}₩{formatKRW(monthlyStats.totalPnL)}
                  </div>
                  <div className={cn(
                    "text-[10px] font-mono",
                    monthlyStats.totalPnL >= 0 ? "text-red-400" : "text-blue-400"
                  )}>
                    ({monthlyStats.totalPnL >= 0 ? '+' : ''}{profitPercent}%)
                  </div>
                </div>
                <div className="bg-secondary/30 rounded p-2">
                  <div className="text-[10px] text-muted-foreground">현재 잔고</div>
                  <div className="text-sm font-bold font-mono text-foreground">
                    ${monthlyStats.endBalance.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    ₩{formatKRW(monthlyStats.endBalance)}
                  </div>
                </div>
              </div>
              
              {/* Deposit/Withdrawal Summary */}
              {(monthlyStats.totalDeposit > 0 || monthlyStats.totalWithdrawal > 0) && (
                <div className="flex gap-2 text-center">
                  {monthlyStats.totalDeposit > 0 && (
                    <div className="flex-1 bg-green-500/10 border border-green-500/30 rounded p-2">
                      <div className="flex items-center justify-center gap-1 text-[10px] text-green-400">
                        <ArrowDownCircle className="w-3 h-3" />
                        입금
                      </div>
                      <div className="text-xs font-bold font-mono text-green-400">
                        +${monthlyStats.totalDeposit.toFixed(2)}
                      </div>
                    </div>
                  )}
                  {monthlyStats.totalWithdrawal > 0 && (
                    <div className="flex-1 bg-orange-500/10 border border-orange-500/30 rounded p-2">
                      <div className="flex items-center justify-center gap-1 text-[10px] text-orange-400">
                        <ArrowUpCircle className="w-3 h-3" />
                        출금
                      </div>
                      <div className="text-xs font-bold font-mono text-orange-400">
                        -${monthlyStats.totalWithdrawal.toFixed(2)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 🆕 오늘 개별 거래 내역 */}
          {todayTrades.length > 0 && (
            <div className="bg-card border border-cyan-500/30 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-cyan-500/10 border-b border-cyan-500/20">
                <span className="text-[10px] text-cyan-400 font-bold">📊 오늘 거래 내역 ({todayTrades.length}건)</span>
              </div>
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-[10px]">
                  <thead className="bg-secondary/30 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1 text-muted-foreground font-normal">시간</th>
                      <th className="text-left px-2 py-1 text-muted-foreground font-normal">코인</th>
                      <th className="text-center px-2 py-1 text-muted-foreground font-normal">방향</th>
                      <th className="text-right px-2 py-1 text-muted-foreground font-normal">손익</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todayTrades.map((trade) => {
                      const time = new Date(trade.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                      // DB에 저장된 pnlUsd는 이미 수수료 포함 최종 손익
                      const netPnl = trade.pnlUsd;
                      const isWin = netPnl > 0;
                      
                      return (
                        <tr key={trade.id} className="border-t border-border/30 hover:bg-secondary/20">
                          <td className="px-2 py-1 font-mono text-gray-400">{time}</td>
                          <td className="px-2 py-1 font-semibold text-cyan-300">{trade.symbol.replace('USDT', '')}</td>
                          <td className="px-2 py-1 text-center">
                            {trade.side === 'long' ? (
                              <span className="text-red-400 flex items-center justify-center gap-0.5">
                                <TrendingUp className="w-3 h-3" /> L
                              </span>
                            ) : (
                              <span className="text-blue-400 flex items-center justify-center gap-0.5">
                                <TrendingDown className="w-3 h-3" /> S
                              </span>
                            )}
                          </td>
                          <td className={cn(
                            "px-2 py-1 text-right font-mono font-bold",
                            isWin ? "text-green-400" : "text-red-400"
                          )}>
                            {isWin ? '+' : ''}₩{formatKRW(netPnl)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-3 py-1.5 bg-secondary/30 border-t border-border/30 flex justify-between text-[10px]">
                <span className="text-muted-foreground">
                  승: <span className="text-green-400 font-bold">{todayTrades.filter(t => t.pnlUsd > 0).length}</span>
                  {' '}패: <span className="text-red-400 font-bold">{todayTrades.filter(t => t.pnlUsd <= 0).length}</span>
                </span>
                <span className={cn(
                  "font-mono font-bold",
                  todayTrades.reduce((sum, t) => sum + t.pnlUsd, 0) >= 0 ? "text-green-400" : "text-red-400"
                )}>
                  합계: {todayTrades.reduce((sum, t) => sum + t.pnlUsd, 0) >= 0 ? '+' : ''}₩{formatKRW(todayTrades.reduce((sum, t) => sum + t.pnlUsd, 0))}
                </span>
              </div>
            </div>
          )}

          {/* Daily Records */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-secondary/50 border-b border-border">
              <span className="text-[10px] text-muted-foreground">일별 기록</span>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {loading ? (
                <div className="p-3 text-center text-muted-foreground text-sm">로딩중...</div>
              ) : monthlyStats && monthlyStats.dailyRecords.length > 0 ? (
                <table className="w-full text-[11px]">
                  <thead className="bg-secondary/30 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 text-muted-foreground font-normal">날짜</th>
                      <th className="text-right px-2 py-1.5 text-muted-foreground font-normal">손익</th>
                      <th className="text-right px-2 py-1.5 text-muted-foreground font-normal">입출금</th>
                      <th className="text-right px-2 py-1.5 text-muted-foreground font-normal">잔고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyStats.dailyRecords.map((record) => (
                      <tr key={record.date} className="border-t border-border/50 hover:bg-secondary/20">
                        <td className="px-2 py-1.5 font-mono">{formatDate(record.date)}</td>
                        <td className={cn(
                          "px-2 py-1.5 text-right font-mono font-bold",
                          record.dailyPnL >= 0 ? "text-red-400" : "text-blue-400"
                        )}>
                          {record.dailyPnL >= 0 ? '+' : ''}₩{formatKRW(record.dailyPnL)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-[10px]">
                          {record.deposit > 0 && (
                            <span className="text-green-400">+${record.deposit.toFixed(0)}</span>
                          )}
                          {record.withdrawal > 0 && (
                            <span className="text-orange-400">-${record.withdrawal.toFixed(0)}</span>
                          )}
                          {record.deposit === 0 && record.withdrawal === 0 && (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                          ${record.closingBalance.toFixed(0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-3 text-center text-muted-foreground text-sm">
                  기록이 없습니다
                </div>
              )}
            </div>
          </div>

          {/* Cumulative Stats */}
          <div className="bg-primary/10 border border-primary/30 rounded-lg p-3 space-y-2">
            <div className="text-[10px] text-primary font-bold">총 누적 기록</div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div>
                <div className="text-[10px] text-muted-foreground">누적 거래손익</div>
                <div className={cn(
                  "text-sm font-bold font-mono",
                  cumulativeStats.totalPnL >= 0 ? "text-red-400" : "text-blue-400"
                )}>
                  {cumulativeStats.totalPnL >= 0 ? '+' : ''}₩{formatKRW(cumulativeStats.totalPnL)}
                </div>
                <div className={cn(
                  "text-[10px] font-mono",
                  cumulativeStats.totalPnL >= 0 ? "text-red-400" : "text-blue-400"
                )}>
                  ({cumulativeStats.totalPnL >= 0 ? '+' : ''}{cumulativeProfitPercent}%)
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">현재 잔고</div>
                <div className="text-sm font-bold font-mono text-foreground">
                  ${cumulativeStats.latestBalance.toFixed(2)}
                </div>
              </div>
            </div>
            {(cumulativeStats.totalDeposit > 0 || cumulativeStats.totalWithdrawal > 0) && (
              <div className="flex gap-2 text-center pt-1 border-t border-primary/20">
                <div className="flex-1">
                  <div className="text-[10px] text-muted-foreground">총 입금</div>
                  <div className="text-xs font-bold font-mono text-green-400">
                    +${cumulativeStats.totalDeposit.toFixed(2)}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="text-[10px] text-muted-foreground">총 출금</div>
                  <div className="text-xs font-bold font-mono text-orange-400">
                    -${cumulativeStats.totalWithdrawal.toFixed(2)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TradingRecordModal;
