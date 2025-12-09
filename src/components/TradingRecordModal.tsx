import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DailyRecord {
  date: string;
  closingBalance: number;
  dailyPnL: number; // From daily_income_usd (actual trading income)
}

interface MonthlyStats {
  totalPnL: number;
  startBalance: number;
  endBalance: number;
  dailyRecords: DailyRecord[];
}

interface TradingRecordModalProps {
  krwRate: number;
}

const TradingRecordModal = ({ krwRate }: TradingRecordModalProps) => {
  const [open, setOpen] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStats | null>(null);
  const [cumulativeStats, setCumulativeStats] = useState({ totalPnL: 0, firstBalance: 0, latestBalance: 0 });
  const [loading, setLoading] = useState(false);

  const fetchMonthlyRecords = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Format dates for query
      const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
      const endDate = selectedMonth === 12 
        ? `${selectedYear + 1}-01-01`
        : `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-01`;

      // Fetch balance snapshots for the month
      const { data, error } = await supabase
        .from('daily_balance_snapshots')
        .select('*')
        .eq('user_id', user.id)
        .gte('snapshot_date', startDate)
        .lt('snapshot_date', endDate)
        .order('snapshot_date', { ascending: true });

      if (error) {
        console.error('Failed to fetch records:', error);
        return;
      }

      // Also get the last day of previous month to calculate first day's PnL
      const prevMonthEnd = new Date(selectedYear, selectedMonth - 1, 0);
      const prevMonthEndDate = prevMonthEnd.toISOString().split('T')[0];
      
      const { data: prevData } = await supabase
        .from('daily_balance_snapshots')
        .select('closing_balance_usd')
        .eq('user_id', user.id)
        .eq('snapshot_date', prevMonthEndDate)
        .maybeSingle();

      if (data && data.length > 0) {
        const dailyRecords: DailyRecord[] = [];

        // Use daily_income_usd for actual trading PnL (excludes deposits/withdrawals)
        data.forEach((snapshot: any) => {
          dailyRecords.push({
            date: snapshot.snapshot_date,
            closingBalance: snapshot.closing_balance_usd,
            dailyPnL: snapshot.daily_income_usd || 0, // Actual trading income
          });
        });

        // Total PnL is sum of all daily income (not balance difference)
        const totalPnL = dailyRecords.reduce((sum, r) => sum + r.dailyPnL, 0);
        const startBalance = prevData?.closing_balance_usd || data[0].closing_balance_usd;
        const endBalance = data[data.length - 1].closing_balance_usd;

        setMonthlyStats({
          totalPnL,
          startBalance,
          endBalance,
          dailyRecords: dailyRecords.reverse(), // Show newest first
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

      // Get all balance snapshots ordered by date
      const { data, error } = await supabase
        .from('daily_balance_snapshots')
        .select('snapshot_date, closing_balance_usd, daily_income_usd')
        .eq('user_id', user.id)
        .order('snapshot_date', { ascending: true });

      if (error) {
        console.error('Failed to fetch cumulative stats:', error);
        return;
      }

      if (data && data.length > 0) {
        const firstBalance = data[0].closing_balance_usd;
        const latestBalance = data[data.length - 1].closing_balance_usd;
        // Total PnL is sum of all daily income (excludes deposits/withdrawals)
        const totalPnL = data.reduce((sum: number, snapshot: any) => 
          sum + (snapshot.daily_income_usd || 0), 0);

        setCumulativeStats({ totalPnL, firstBalance, latestBalance });
      }
    } catch (error) {
      console.error('Error fetching cumulative stats:', error);
    }
  };

  useEffect(() => {
    if (open) {
      fetchMonthlyRecords();
      fetchCumulativeStats();
    }
  }, [open, selectedYear, selectedMonth]);

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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg">거래 기록</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Month Navigation */}
          <div className="flex items-center justify-between bg-secondary/50 rounded-lg px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePrevMonth}
              className="h-7 w-7 p-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="font-bold text-sm">
              {selectedYear}년 {selectedMonth}월
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNextMonth}
              className="h-7 w-7 p-0"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Monthly Summary */}
          {monthlyStats && (
            <div className="bg-card border border-border rounded-lg p-3">
              <div className="text-[10px] text-muted-foreground mb-1">월간 요약</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[10px] text-muted-foreground">월 손익</div>
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
                <div>
                  <div className="text-[10px] text-muted-foreground">시작 잔고</div>
                  <div className="text-sm font-bold font-mono text-foreground">
                    ${monthlyStats.startBalance.toFixed(0)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">현재 잔고</div>
                  <div className="text-sm font-bold font-mono text-foreground">
                    ${monthlyStats.endBalance.toFixed(0)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Daily Records */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-secondary/50 border-b border-border">
              <span className="text-[10px] text-muted-foreground">일별 기록 (잔고 기준)</span>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {loading ? (
                <div className="p-3 text-center text-muted-foreground text-sm">로딩중...</div>
              ) : monthlyStats && monthlyStats.dailyRecords.length > 0 ? (
                <table className="w-full text-[11px]">
                  <thead className="bg-secondary/30 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-1.5 text-muted-foreground font-normal">날짜</th>
                      <th className="text-right px-3 py-1.5 text-muted-foreground font-normal">손익</th>
                      <th className="text-right px-3 py-1.5 text-muted-foreground font-normal">잔고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyStats.dailyRecords.map((record) => (
                      <tr key={record.date} className="border-t border-border/50 hover:bg-secondary/20">
                        <td className="px-3 py-1.5 font-mono">{formatDate(record.date)}</td>
                        <td className={cn(
                          "px-3 py-1.5 text-right font-mono font-bold",
                          record.dailyPnL >= 0 ? "text-red-400" : "text-blue-400"
                        )}>
                          {record.dailyPnL >= 0 ? '+' : ''}₩{formatKRW(record.dailyPnL)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
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
          <div className="bg-primary/10 border border-primary/30 rounded-lg p-3">
            <div className="text-[10px] text-primary mb-1 font-bold">총 누적 기록</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[10px] text-muted-foreground">누적 손익</div>
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
                <div className="text-[10px] text-muted-foreground">최초 잔고</div>
                <div className="text-sm font-bold font-mono text-foreground">
                  ${cumulativeStats.firstBalance.toFixed(0)}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">현재 잔고</div>
                <div className="text-sm font-bold font-mono text-foreground">
                  ${cumulativeStats.latestBalance.toFixed(0)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TradingRecordModal;