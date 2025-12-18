import { useState } from 'react';
import { cn } from '@/lib/utils';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useBacktest } from '@/hooks/useBacktest';
import { 
  FlaskConical, 
  TrendingUp, 
  TrendingDown, 
  Activity,
  Target,
  AlertTriangle
} from 'lucide-react';

interface BacktestModalProps {
  symbol: string;
}

const PERIOD_OPTIONS = [
  { value: '1d', label: '1일' },
  { value: '3d', label: '3일' },
  { value: '7d', label: '7일' },
] as const;

export default function BacktestModal({ symbol }: BacktestModalProps) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<'1d' | '3d' | '7d'>('1d');
  const { isRunning, progress, result, runBacktest, clearResult } = useBacktest();
  
  const handleRun = async () => {
    await runBacktest(symbol, period);
  };
  
  const handleClose = () => {
    setOpen(false);
    clearResult();
  };
  
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) clearResult(); }}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-6 px-2 text-[10px] gap-1 border-purple-500/50 text-purple-400 hover:bg-purple-500/20"
        >
          <FlaskConical className="w-3 h-3" />
          백테스트
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-purple-400" />
            {symbol} 백테스트
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Period Selection */}
          <div className="flex gap-2">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                disabled={isRunning}
                className={cn(
                  "flex-1 py-2 text-sm font-medium rounded-lg transition-colors",
                  period === opt.value 
                    ? "bg-purple-500 text-white" 
                    : "bg-secondary hover:bg-secondary/80"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          
          {/* Run Button */}
          <Button 
            onClick={handleRun} 
            disabled={isRunning}
            className="w-full bg-purple-500 hover:bg-purple-600"
          >
            {isRunning ? `분석 중... ${progress}%` : '백테스트 실행'}
          </Button>
          
          {/* Progress */}
          {isRunning && (
            <Progress value={progress} className="h-2" />
          )}
          
          {/* Results */}
          {result && (
            <div className="space-y-3 pt-2">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-secondary/50 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground">총 거래</p>
                  <p className="text-lg font-bold">{result.totalTrades}</p>
                </div>
                <div className="bg-secondary/50 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground">승률</p>
                  <p className={cn(
                    "text-lg font-bold",
                    result.winRate >= 50 ? "text-green-500" : "text-red-500"
                  )}>
                    {result.winRate.toFixed(1)}%
                  </p>
                </div>
                <div className="bg-secondary/50 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground">총 수익</p>
                  <p className={cn(
                    "text-lg font-bold",
                    result.totalPnLPercent >= 0 ? "text-green-500" : "text-red-500"
                  )}>
                    {result.totalPnLPercent >= 0 ? '+' : ''}{result.totalPnLPercent.toFixed(2)}%
                  </p>
                </div>
              </div>
              
              {/* Detail Stats */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center justify-between bg-secondary/30 rounded px-3 py-2">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <TrendingUp className="w-3 h-3 text-green-500" /> 승
                  </span>
                  <span className="font-mono text-green-500">{result.wins}</span>
                </div>
                <div className="flex items-center justify-between bg-secondary/30 rounded px-3 py-2">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <TrendingDown className="w-3 h-3 text-red-500" /> 패
                  </span>
                  <span className="font-mono text-red-500">{result.losses}</span>
                </div>
                <div className="flex items-center justify-between bg-secondary/30 rounded px-3 py-2">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Target className="w-3 h-3" /> 평균 수익
                  </span>
                  <span className={cn(
                    "font-mono",
                    result.avgPnLPercent >= 0 ? "text-green-500" : "text-red-500"
                  )}>
                    {result.avgPnLPercent >= 0 ? '+' : ''}{result.avgPnLPercent.toFixed(3)}%
                  </span>
                </div>
                <div className="flex items-center justify-between bg-secondary/30 rounded px-3 py-2">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-yellow-500" /> 최대 낙폭
                  </span>
                  <span className="font-mono text-yellow-500">
                    -{result.maxDrawdown.toFixed(2)}%
                  </span>
                </div>
              </div>
              
              {/* Profit Factor */}
              <div className="flex items-center justify-between bg-secondary/50 rounded-lg px-4 py-3">
                <span className="text-sm text-muted-foreground flex items-center gap-2">
                  <Activity className="w-4 h-4" /> Profit Factor
                </span>
                <span className={cn(
                  "text-xl font-bold",
                  result.profitFactor >= 1.5 ? "text-green-500" : 
                  result.profitFactor >= 1 ? "text-yellow-500" : "text-red-500"
                )}>
                  {result.profitFactor === Infinity ? '∞' : result.profitFactor.toFixed(2)}
                </span>
              </div>
              
              {/* Indicator Averages */}
              <div className="text-[10px] text-muted-foreground bg-secondary/20 rounded p-2">
                <p>평균 지표: RSI {result.indicatorStats.avgRSI.toFixed(1)} | ADX {result.indicatorStats.avgADX.toFixed(1)}</p>
              </div>
              
              {/* Interpretation */}
              <div className={cn(
                "text-xs p-3 rounded-lg",
                result.profitFactor >= 1.5 ? "bg-green-500/10 text-green-400" :
                result.profitFactor >= 1 ? "bg-yellow-500/10 text-yellow-400" :
                "bg-red-500/10 text-red-400"
              )}>
                {result.profitFactor >= 1.5 
                  ? '✅ 전략이 이 종목에서 우수한 성과를 보입니다.'
                  : result.profitFactor >= 1
                  ? '⚠️ 전략이 약간의 수익을 내지만 개선이 필요합니다.'
                  : '❌ 이 종목에서 전략 성과가 좋지 않습니다. 다른 종목을 고려하세요.'}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
