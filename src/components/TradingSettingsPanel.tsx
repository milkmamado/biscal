import { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings, SlidersHorizontal, Target, Filter, TrendingUp, BarChart3, Activity, Shield } from 'lucide-react';

interface TradingSettingsProps {
  // 필터 토글
  adxFilterEnabled: boolean;
  onToggleAdxFilter: (enabled: boolean) => void;
  volumeFilterEnabled: boolean;
  onToggleVolumeFilter: (enabled: boolean) => void;
  rsiFilterEnabled: boolean;
  onToggleRsiFilter: (enabled: boolean) => void;
  macdFilterEnabled: boolean;
  onToggleMacdFilter: (enabled: boolean) => void;
  bollingerFilterEnabled: boolean;
  onToggleBollingerFilter: (enabled: boolean) => void;
  
  // 퍼센티지 조정
  adxThreshold: number;
  onAdxThresholdChange: (value: number) => void;
  
  // 손절 설정 (USDT)
  stopLossUsdt: number;
  onStopLossChange: (value: number) => void;
  
  // 익절 설정 (USDT)
  takeProfitUsdt: number;
  onTakeProfitChange: (value: number) => void;
  
  // 상태
  isAutoTradingEnabled: boolean;
}

export function TradingSettingsPanel({
  adxFilterEnabled,
  onToggleAdxFilter,
  volumeFilterEnabled,
  onToggleVolumeFilter,
  rsiFilterEnabled,
  onToggleRsiFilter,
  macdFilterEnabled,
  onToggleMacdFilter,
  bollingerFilterEnabled,
  onToggleBollingerFilter,
  adxThreshold,
  onAdxThresholdChange,
  stopLossUsdt,
  onStopLossChange,
  takeProfitUsdt,
  onTakeProfitChange,
  isAutoTradingEnabled,
}: TradingSettingsProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  // 로컬 입력 상태 (Enter나 blur 시에만 실제 적용)
  const [localStopLoss, setLocalStopLoss] = useState(String(stopLossUsdt));
  const [localTakeProfit, setLocalTakeProfit] = useState(String(takeProfitUsdt));
  
  // props 변경 시 로컬 상태 동기화 (버튼 클릭 등)
  useEffect(() => {
    setLocalStopLoss(String(stopLossUsdt));
  }, [stopLossUsdt]);
  
  useEffect(() => {
    setLocalTakeProfit(String(takeProfitUsdt));
  }, [takeProfitUsdt]);
  
  // 손절 적용 함수
  const applyStopLoss = () => {
    const value = Number(localStopLoss);
    if (!isNaN(value) && value >= 0.1) {
      onStopLossChange(value);
    } else {
      // 유효하지 않으면 이전 값으로 복원
      setLocalStopLoss(String(stopLossUsdt));
    }
  };
  
  // 익절 적용 함수
  const applyTakeProfit = () => {
    const value = Number(localTakeProfit);
    if (!isNaN(value) && value >= 0.1) {
      onTakeProfitChange(value);
    } else {
      // 유효하지 않으면 이전 값으로 복원
      setLocalTakeProfit(String(takeProfitUsdt));
    }
  };

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
          background: 'linear-gradient(90deg, rgba(100, 150, 255, 0.1) 0%, rgba(100, 100, 200, 0.05) 100%)',
        }}
      >
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-semibold text-foreground">검색 조건 설정</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {isCollapsed ? '▼' : '▲'}
        </span>
      </div>

      {!isCollapsed && (
        <div className="p-3 space-y-4">
          {/* 필터 토글 섹션 */}
          <div className="space-y-2">
            <div className="flex items-center gap-1 mb-2">
              <Filter className="w-3 h-3 text-purple-400" />
              <span className="text-[10px] font-semibold text-purple-400">시그널 필터</span>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              {/* ADX 필터 */}
              <div className="flex items-center justify-between px-2 py-1.5 rounded bg-background/50 border border-border/30">
                <div className="flex items-center gap-1">
                  <Activity className="w-3 h-3 text-amber-400" />
                  <span className="text-[10px] text-foreground">ADX</span>
                </div>
                <Switch
                  checked={adxFilterEnabled}
                  onCheckedChange={onToggleAdxFilter}
                  disabled={isAutoTradingEnabled}
                  className="scale-75"
                />
              </div>

              {/* 거래량 필터 */}
              <div className="flex items-center justify-between px-2 py-1.5 rounded bg-background/50 border border-border/30">
                <div className="flex items-center gap-1">
                  <BarChart3 className="w-3 h-3 text-green-400" />
                  <span className="text-[10px] text-foreground">거래량</span>
                </div>
                <Switch
                  checked={volumeFilterEnabled}
                  onCheckedChange={onToggleVolumeFilter}
                  disabled={isAutoTradingEnabled}
                  className="scale-75"
                />
              </div>

              {/* RSI 필터 */}
              <div className="flex items-center justify-between px-2 py-1.5 rounded bg-background/50 border border-border/30">
                <div className="flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-cyan-400" />
                  <span className="text-[10px] text-foreground">RSI</span>
                </div>
                <Switch
                  checked={rsiFilterEnabled}
                  onCheckedChange={onToggleRsiFilter}
                  disabled={isAutoTradingEnabled}
                  className="scale-75"
                />
              </div>

              {/* MACD 필터 */}
              <div className="flex items-center justify-between px-2 py-1.5 rounded bg-background/50 border border-border/30">
                <div className="flex items-center gap-1">
                  <SlidersHorizontal className="w-3 h-3 text-pink-400" />
                  <span className="text-[10px] text-foreground">MACD</span>
                </div>
                <Switch
                  checked={macdFilterEnabled}
                  onCheckedChange={onToggleMacdFilter}
                  disabled={isAutoTradingEnabled}
                  className="scale-75"
                />
              </div>

              {/* 볼린저 필터 */}
              <div className="flex items-center justify-between px-2 py-1.5 rounded bg-background/50 border border-border/30 col-span-2">
                <div className="flex items-center gap-1">
                  <Target className="w-3 h-3 text-orange-400" />
                  <span className="text-[10px] text-foreground">볼린저밴드</span>
                </div>
                <Switch
                  checked={bollingerFilterEnabled}
                  onCheckedChange={onToggleBollingerFilter}
                  disabled={isAutoTradingEnabled}
                  className="scale-75"
                />
              </div>
            </div>
          </div>

          {/* 퍼센티지 조정 섹션 */}
          <div className="space-y-3 pt-2 border-t border-border/30">
            <div className="flex items-center gap-1">
              <SlidersHorizontal className="w-3 h-3 text-blue-400" />
              <span className="text-[10px] font-semibold text-blue-400">세부 조정</span>
            </div>

            {/* ADX 임계값 */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] text-muted-foreground">ADX 임계값</Label>
                <span className="text-[10px] font-mono text-amber-400">{adxThreshold}</span>
              </div>
              <Slider
                value={[adxThreshold]}
                onValueChange={([v]) => onAdxThresholdChange(v)}
                min={10}
                max={40}
                step={1}
                disabled={isAutoTradingEnabled}
                className="h-4"
              />
              <div className="flex justify-between text-[8px] text-muted-foreground">
                <span>10 (약)</span>
                <span>40 (강)</span>
              </div>
            </div>

            {/* 손절 설정 (USDT) */}
            <div className="space-y-2 pt-2 border-t border-border/30">
              <div className="flex items-center gap-1">
                <Shield className="w-3 h-3 text-red-400" />
                <span className="text-[10px] font-semibold text-red-400">손절 설정</span>
              </div>

              <div className="flex items-center gap-2">
                <Label className="text-[10px] text-muted-foreground whitespace-nowrap">손절 금액</Label>
                <div className="flex-1 flex items-center gap-1">
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={localStopLoss}
                    onChange={(e) => setLocalStopLoss(e.target.value)}
                    onBlur={applyStopLoss}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        applyStopLoss();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="h-7 text-[10px] text-right font-mono bg-background/50"
                  />
                  <span className="text-[10px] text-muted-foreground">USDT</span>
                </div>
              </div>

              {/* 손절 빠른 선택 버튼 */}
              <div className="flex gap-1">
                {[5, 10, 15, 20, 30].map((val) => (
                  <button
                    key={val}
                    onClick={() => onStopLossChange(val)}
                    className={`flex-1 py-1 text-[9px] rounded border transition-colors ${
                      stopLossUsdt === val
                        ? 'bg-red-500/20 border-red-500/50 text-red-400'
                        : 'bg-background/30 border-border/30 text-muted-foreground hover:border-red-500/30'
                    }`}
                  >
                    ${val}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 익절 설정 섹션 */}
          <div className="space-y-2 pt-2 border-t border-border/30">
            <div className="flex items-center gap-1">
              <Target className="w-3 h-3 text-green-400" />
              <span className="text-[10px] font-semibold text-green-400">익절 설정</span>
            </div>

            <div className="flex items-center gap-2">
              <Label className="text-[10px] text-muted-foreground whitespace-nowrap">목표 수익</Label>
              <div className="flex-1 flex items-center gap-1">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={localTakeProfit}
                  onChange={(e) => setLocalTakeProfit(e.target.value)}
                  onBlur={applyTakeProfit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      applyTakeProfit();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="h-7 text-[10px] text-right font-mono bg-background/50"
                />
                <span className="text-[10px] text-muted-foreground">USDT</span>
              </div>
            </div>

            {/* 익절 빠른 선택 버튼 */}
            <div className="flex gap-1">
              {[5, 10, 15, 20, 30].map((val) => (
                <button
                  key={val}
                  onClick={() => onTakeProfitChange(val)}
                  className={`flex-1 py-1 text-[9px] rounded border transition-colors ${
                    takeProfitUsdt === val
                      ? 'bg-green-500/20 border-green-500/50 text-green-400'
                      : 'bg-background/30 border-border/30 text-muted-foreground hover:border-green-500/30'
                  }`}
                >
                  ${val}
                </button>
              ))}
            </div>
          </div>

          {/* 자동매매 중 안내 */}
          {isAutoTradingEnabled && (
            <div className="text-[9px] text-center text-cyan-400/80 bg-cyan-500/10 rounded px-2 py-1">
              💡 손절/익절 설정은 실시간 반영됩니다
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TradingSettingsPanel;
