import { useState, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings, SlidersHorizontal, Target, Layers } from 'lucide-react';
import { DTFXGuideModal } from './DTFXGuideModal';

interface TradingSettingsProps {
  // DTFX 차트 표시 토글
  dtfxEnabled: boolean;
  onToggleDtfx: (enabled: boolean) => void;
  
  // 익절 설정 (USDT)
  takeProfitUsdt: number;
  onTakeProfitChange: (value: number) => void;
  
  // 상태
  isAutoTradingEnabled: boolean;
}

export function TradingSettingsPanel({
  dtfxEnabled,
  onToggleDtfx,
  takeProfitUsdt,
  onTakeProfitChange,
  isAutoTradingEnabled,
}: TradingSettingsProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  // 로컬 입력 상태 (Enter나 blur 시에만 실제 적용)
  const [localTakeProfit, setLocalTakeProfit] = useState(String(takeProfitUsdt));
  
  // props 변경 시 로컬 상태 동기화 (버튼 클릭 등)
  useEffect(() => {
    setLocalTakeProfit(String(takeProfitUsdt));
  }, [takeProfitUsdt]);
  
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
        <div className="p-3 space-y-4 max-h-64 overflow-y-auto">
          {/* DTFX 설정 섹션 */}
          <div className="space-y-2">
            <div className="flex items-center gap-1 mb-2">
              <Layers className="w-3 h-3 text-purple-400" />
              <span className="text-[10px] font-semibold text-purple-400">DTFX 설정</span>
            </div>
            
            {/* DTFX 차트 표시 토글 */}
            <div className="flex items-center justify-between px-2 py-1.5 rounded bg-gradient-to-r from-purple-500/10 to-cyan-500/10 border border-purple-500/30">
              <div className="flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-purple-400" />
                <DTFXGuideModal />
              </div>
              <Switch
                checked={dtfxEnabled}
                onCheckedChange={onToggleDtfx}
                className="scale-75"
              />
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
              💡 익절 설정은 실시간 반영됩니다
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TradingSettingsPanel;
