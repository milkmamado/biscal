import { cn } from '@/lib/utils';
import { Zap, Crown, Brain, LogOut, ChevronDown } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/useAuth';
import { useSymbolMaxLeverage, generateLeverageOptions, BALANCE_PERCENT_OPTIONS, BalancePercent } from '@/hooks/useSymbolMaxLeverage';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface SignalScannerPanelProps {
  isEnabled: boolean;
  isProcessing: boolean;
  onToggle: () => void;
  leverage: number;
  onLeverageChange: (leverage: number) => void;
  balancePercent: BalancePercent;
  onBalancePercentChange: (percent: BalancePercent) => void;
  aiEnabled: boolean;
  isAiAnalyzing: boolean;
  onToggleAiAnalysis?: () => void;
  krwRate: number;
  refreshTrigger: number;
  currentSymbol?: string;
  majorCoinMode: boolean;
  onToggleMajorCoinMode: () => void;
}

export function SignalScannerPanel({
  isEnabled,
  isProcessing,
  onToggle,
  leverage,
  onLeverageChange,
  balancePercent,
  onBalancePercentChange,
  aiEnabled,
  isAiAnalyzing,
  onToggleAiAnalysis,
  krwRate,
  refreshTrigger,
  currentSymbol = 'BTCUSDT',
  majorCoinMode,
  onToggleMajorCoinMode,
}: SignalScannerPanelProps) {
  const { signOut } = useAuth();
  const { maxLeverage } = useSymbolMaxLeverage(currentSymbol);
  const leverageOptions = generateLeverageOptions(maxLeverage);

  const handleSignOut = async () => {
    await signOut();
    window.location.href = '/auth';
  };

  // 현재 레버리지가 최대 레버리지보다 크면 조정
  const effectiveLeverage = leverage > maxLeverage ? maxLeverage : leverage;

  return (
    <div
      className="rounded-lg border border-border/50 overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)',
      }}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between px-3 py-2",
          isEnabled
            ? "border-b border-cyan-500/30"
            : "border-b border-border/30"
        )}
        style={{
          background: isEnabled
            ? 'linear-gradient(90deg, rgba(0, 255, 136, 0.15) 0%, rgba(0, 255, 255, 0.1) 100%)'
            : 'linear-gradient(90deg, rgba(100, 150, 255, 0.1) 0%, rgba(100, 100, 200, 0.05) 100%)',
        }}
      >
        <div className="flex items-center gap-2">
          <Zap
            className={cn("w-4 h-4", isEnabled ? "text-cyan-400" : "text-gray-500")}
            style={{
              filter: isEnabled ? 'drop-shadow(0 0 8px rgba(0, 255, 255, 0.8))' : 'none',
            }}
          />
          <span
            className="font-bold text-xs tracking-wider uppercase"
            style={{
              color: isEnabled ? '#00ffff' : '#888',
              textShadow: isEnabled ? '0 0 10px rgba(0, 255, 255, 0.8)' : 'none',
            }}
          >
            Signal Scanner
          </span>
          {isProcessing && (
            <div
              className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"
              style={{ boxShadow: '0 0 10px rgba(255, 255, 0, 0.8)' }}
            />
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* 메이저/잡코인 모드 토글 */}
          <button
            onClick={onToggleMajorCoinMode}
            className={cn(
              "p-1 rounded transition-all",
              majorCoinMode ? "text-yellow-400" : "text-purple-400"
            )}
            style={{
              background: majorCoinMode ? 'rgba(255, 215, 0, 0.2)' : 'rgba(168, 85, 247, 0.2)',
              boxShadow: majorCoinMode ? '0 0 10px rgba(255, 215, 0, 0.4)' : '0 0 10px rgba(168, 85, 247, 0.4)',
            }}
            title={majorCoinMode ? "메이저 코인 모드" : "잡코인 모드"}
          >
            <Crown className="w-3.5 h-3.5" />
          </button>
          {/* AI 분석 토글 */}
          <button
            onClick={onToggleAiAnalysis}
            className={cn(
              "p-1 rounded transition-all",
              aiEnabled ? "text-cyan-400" : "text-gray-500 hover:text-gray-300"
            )}
            style={{
              background: aiEnabled ? 'rgba(0, 255, 255, 0.2)' : 'transparent',
              boxShadow: aiEnabled ? '0 0 10px rgba(0, 255, 255, 0.4)' : 'none',
            }}
            title={aiEnabled ? "AI 분석 ON" : "AI 분석 OFF"}
          >
            <Brain className={cn("w-3.5 h-3.5", isAiAnalyzing && "animate-pulse")} />
          </button>
          <Switch
            checked={isEnabled}
            onCheckedChange={onToggle}
            className="data-[state=checked]:bg-cyan-500 scale-90"
            style={{
              boxShadow: isEnabled ? '0 0 10px rgba(0, 255, 255, 0.5)' : 'none',
            }}
          />
          <button
            onClick={handleSignOut}
            className="p-1 rounded text-gray-500 hover:text-pink-400 transition-colors"
            style={{ background: 'rgba(255, 0, 136, 0.1)' }}
            title="로그아웃"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 레버리지 & 분할매수 선택 - Select 스타일 */}
      <div
        className="px-2 py-1.5"
        style={{
          background: 'linear-gradient(180deg, rgba(0, 255, 255, 0.03) 0%, transparent 100%)',
        }}
      >
        <div className="flex items-center justify-between gap-2">
          {/* 레버리지 Select */}
          <Select
            value={effectiveLeverage.toString()}
            onValueChange={(val) => onLeverageChange(parseInt(val))}
            disabled={isEnabled}
          >
            <SelectTrigger 
              className={cn(
                "h-6 w-[70px] text-[10px] font-bold border-0 px-2",
                isEnabled && "opacity-50 cursor-not-allowed"
              )}
              style={{
                background: 'rgba(0, 255, 255, 0.15)',
                color: '#00ffff',
                boxShadow: '0 0 8px rgba(0, 255, 255, 0.2)',
              }}
            >
              <SelectValue placeholder="선택" />
            </SelectTrigger>
            <SelectContent 
              className="max-h-[200px] overflow-y-auto"
              style={{
                background: 'hsl(var(--background))',
                border: '1px solid rgba(0, 255, 255, 0.3)',
              }}
            >
              {leverageOptions.map((lev) => (
                <SelectItem 
                  key={lev} 
                  value={lev.toString()}
                  className="text-[10px] font-bold cursor-pointer hover:bg-cyan-500/20"
                >
                  {lev}x
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* 잔고 퍼센트 Select */}
          <Select
            value={balancePercent.toString()}
            onValueChange={(val) => onBalancePercentChange(parseInt(val) as BalancePercent)}
          >
            <SelectTrigger 
              className="h-6 w-[55px] text-[10px] font-bold border-0 px-2"
              style={{
                background: 'rgba(0, 255, 255, 0.15)',
                color: '#00ffff',
                boxShadow: '0 0 8px rgba(0, 255, 255, 0.2)',
              }}
            >
              <SelectValue placeholder="선택" />
            </SelectTrigger>
            <SelectContent 
              style={{
                background: 'hsl(var(--background))',
                border: '1px solid rgba(0, 255, 255, 0.3)',
              }}
            >
              {BALANCE_PERCENT_OPTIONS.map((opt) => (
                <SelectItem 
                  key={opt} 
                  value={opt.toString()}
                  className="text-[10px] font-bold cursor-pointer hover:bg-cyan-500/20"
                >
                  {opt}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

export default SignalScannerPanel;
