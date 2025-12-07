import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, History } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DailyRecord {
  date: string;
  totalPnL: number;
  tradeCount: number;
  winCount: number;
}

interface MonthlyStats {
  totalPnL: number;
  totalTrades: number;
  totalWins: number;
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
  const [cumulativeStats, setCumulativeStats] = useState({ totalPnL: 0, totalTrades: 0, totalWins: 0 });
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

      const { data, error } = await supabase
        .from('daily_trading_logs')
        .select('*')
        .eq('user_id', user.id)
        .gte('trade_date', startDate)
        .lt('trade_date', endDate)
        .order('trade_date', { ascending: false });

      if (error) {
        console.error('Failed to fetch records:', error);
        return;
      }

      if (data) {
        // Group by date
        const grouped: Record<string, { pnl: number; count: number; wins: number }> = {};
        
        data.forEach(log => {
          const date = log.trade_date;
          if (!grouped[date]) {
            grouped[date] = { pnl: 0, count: 0, wins: 0 };
          }
          grouped[date].pnl += Number(log.pnl_usd);
          grouped[date].count += 1;
          if (Number(log.pnl_usd) > 0) {
            grouped[date].wins += 1;
          }
        });

        const dailyRecords: DailyRecord[] = Object.entries(grouped).map(([date, stats]) => ({
          date,
          totalPnL: stats.pnl,
          tradeCount: stats.count,
          winCount: stats.wins,
        }));

        const totalPnL = dailyRecords.reduce((sum, r) => sum + r.totalPnL, 0);
        const totalTrades = dailyRecords.reduce((sum, r) => sum + r.tradeCount, 0);
        const totalWins = dailyRecords.reduce((sum, r) => sum + r.winCount, 0);

        setMonthlyStats({
          totalPnL,
          totalTrades,
          totalWins,
          dailyRecords,
        });
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
        .from('daily_trading_logs')
        .select('pnl_usd')
        .eq('user_id', user.id);

      if (error) {
        console.error('Failed to fetch cumulative stats:', error);
        return;
      }

      if (data) {
        const totalPnL = data.reduce((sum, log) => sum + Number(log.pnl_usd), 0);
        const totalTrades = data.length;
        const totalWins = data.filter(log => Number(log.pnl_usd) > 0).length;

        setCumulativeStats({ totalPnL, totalTrades, totalWins });
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

  const winRate = monthlyStats && monthlyStats.totalTrades > 0 
    ? ((monthlyStats.totalWins / monthlyStats.totalTrades) * 100).toFixed(1) 
    : '0.0';

  const cumulativeWinRate = cumulativeStats.totalTrades > 0 
    ? ((cumulativeStats.totalWins / cumulativeStats.totalTrades) * 100).toFixed(1) 
    : '0.0';

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
                  <div className="text-[10px] text-muted-foreground">손익</div>
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
                    (${monthlyStats.totalPnL.toFixed(2)})
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">거래</div>
                  <div className="text-sm font-bold font-mono text-foreground">
                    {monthlyStats.totalTrades}회
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    승{monthlyStats.totalWins}/패{monthlyStats.totalTrades - monthlyStats.totalWins}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">승률</div>
                  <div className={cn(
                    "text-sm font-bold font-mono",
                    parseFloat(winRate) >= 50 ? "text-red-400" : "text-blue-400"
                  )}>
                    {winRate}%
                  </div>
                </div>
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
                      <th className="text-left px-3 py-1.5 text-muted-foreground font-normal">날짜</th>
                      <th className="text-right px-3 py-1.5 text-muted-foreground font-normal">손익</th>
                      <th className="text-right px-3 py-1.5 text-muted-foreground font-normal">거래</th>
                      <th className="text-right px-3 py-1.5 text-muted-foreground font-normal">승률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyStats.dailyRecords.map((record) => {
                      const dayWinRate = record.tradeCount > 0 
                        ? ((record.winCount / record.tradeCount) * 100).toFixed(0) 
                        : '0';
                      return (
                        <tr key={record.date} className="border-t border-border/50 hover:bg-secondary/20">
                          <td className="px-3 py-1.5 font-mono">{formatDate(record.date)}</td>
                          <td className={cn(
                            "px-3 py-1.5 text-right font-mono font-bold",
                            record.totalPnL >= 0 ? "text-red-400" : "text-blue-400"
                          )}>
                            {record.totalPnL >= 0 ? '+' : ''}₩{formatKRW(record.totalPnL)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono">{record.tradeCount}회</td>
                          <td className={cn(
                            "px-3 py-1.5 text-right font-mono",
                            parseFloat(dayWinRate) >= 50 ? "text-red-400" : "text-blue-400"
                          )}>
                            {dayWinRate}%
                          </td>
                        </tr>
                      );
                    })}
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
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">총 거래</div>
                <div className="text-sm font-bold font-mono text-foreground">
                  {cumulativeStats.totalTrades}회
                </div>
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground">총 승률</div>
                <div className={cn(
                  "text-sm font-bold font-mono",
                  parseFloat(cumulativeWinRate) >= 50 ? "text-red-400" : "text-blue-400"
                )}>
                  {cumulativeWinRate}%
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
