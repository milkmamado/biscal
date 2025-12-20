/**
 * 📚 매매 문서화 모달
 * 모든 매매 기준과 전략을 한눈에 볼 수 있는 가이드
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Target, DollarSign, Shield, Scale, Bot, BarChart3, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  TRADING_RULES, 
  TRADING_DOCS_VERSION, 
  TRADING_DOCS_UPDATED,
  MAJOR_CONFIG,
  ALTCOIN_CONFIG,
  MAJOR_COINS_WHITELIST,
} from '@/lib/tradingConfig';

interface TradingDocsModalProps {
  majorCoinMode?: boolean;
}

const TradingDocsModal = ({ majorCoinMode = false }: TradingDocsModalProps) => {
  const [open, setOpen] = useState(false);
  const config = majorCoinMode ? MAJOR_CONFIG : ALTCOIN_CONFIG;
  const modeLabel = majorCoinMode ? '🏆 메이저 코인' : '🎯 잡코인';

  const sections = [
    { key: 'ENTRY', icon: Target, color: 'text-cyan-400' },
    { key: 'TAKE_PROFIT', icon: DollarSign, color: 'text-green-400' },
    { key: 'STOP_LOSS', icon: Shield, color: 'text-red-400' },
    { key: 'BREAKEVEN', icon: Scale, color: 'text-yellow-400' },
    { key: 'AI_ANALYSIS', icon: Bot, color: 'text-purple-400' },
    { key: 'SCREENING', icon: BarChart3, color: 'text-orange-400' },
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 hover:bg-secondary"
          title="매매 가이드"
        >
          <FileText className="w-4 h-4 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FileText className="w-5 h-5 text-primary" />
            프로 스캘핑 매매 가이드
          </DialogTitle>
          <DialogDescription className="flex items-center justify-between">
            <span>{modeLabel} 모드 설정</span>
            <span className="text-[10px] text-muted-foreground">
              v{TRADING_DOCS_VERSION} ({TRADING_DOCS_UPDATED})
            </span>
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="rules" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="rules">📋 매매 규칙</TabsTrigger>
            <TabsTrigger value="config">⚙️ 현재 설정</TabsTrigger>
          </TabsList>

          <TabsContent value="rules" className="mt-4">
            <ScrollArea className="h-[55vh] pr-4">
              <div className="space-y-4">
                {sections.map(({ key, icon: Icon, color }) => {
                  const section = TRADING_RULES[key as keyof typeof TRADING_RULES];
                  return (
                    <div key={key} className="bg-card border border-border rounded-lg p-4">
                      <h3 className={cn("flex items-center gap-2 font-bold mb-3", color)}>
                        <Icon className="w-4 h-4" />
                        {section.title}
                      </h3>
                      <ul className="space-y-1.5">
                        {section.rules.map((rule, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                            <span className="text-primary mt-0.5">•</span>
                            <span>{rule}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="config" className="mt-4">
            <ScrollArea className="h-[55vh] pr-4">
              <div className="space-y-4">
                {/* 현재 모드 표시 */}
                <div className="bg-gradient-to-r from-primary/20 to-primary/5 border border-primary/30 rounded-lg p-4">
                  <h3 className="font-bold text-primary mb-2">📍 현재 모드: {modeLabel}</h3>
                  <p className="text-sm text-muted-foreground">
                    {majorCoinMode 
                      ? 'BTC, ETH 등 유동성 높은 메이저 코인 대상 정밀 스캘핑'
                      : '저가 알트코인 대상 변동성 기반 스캘핑'}
                  </p>
                </div>

                {/* 기본 손익 설정 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Settings className="w-4 h-4 text-primary" />
                    기본 손익 설정
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="기본 익절" value={`+${config.TP_PERCENT}%`} color="text-green-400" />
                    <ConfigItem label="기본 손절" value={`-${config.SL_PERCENT}%`} color="text-red-400" />
                    <ConfigItem label="수수료" value={`${config.FEE_RATE}% / side`} />
                    <ConfigItem label="손익비" value={`1:${(config.TP_PERCENT / config.SL_PERCENT).toFixed(2)}`} color="text-cyan-400" />
                  </div>
                </div>

                {/* 동적 익절 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <DollarSign className="w-4 h-4 text-green-400" />
                    동적 익절 (추세 강도별)
                  </h3>
                  <div className="space-y-2">
                    {(['WEAK', 'MEDIUM', 'STRONG'] as const).map((strength) => {
                      const tp = config.DYNAMIC_TP[strength];
                      const strengthLabels = { WEAK: '약함', MEDIUM: '보통', STRONG: '강함' };
                      return (
                        <div key={strength} className="flex items-center justify-between text-sm bg-secondary/30 rounded px-3 py-2">
                          <span className="text-muted-foreground">추세 {strengthLabels[strength]}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-green-400 font-mono">+{tp.TP_PERCENT}%</span>
                            {tp.USE_TRAILING && (
                              <span className="text-[10px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded">
                                트레일링
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 조기 손절 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Shield className="w-4 h-4 text-red-400" />
                    조기 손절 시스템
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="보호 기간" value={`${config.EARLY_SL.GRACE_PERIOD_SEC}초`} />
                    <ConfigItem label="1단계 시간" value={`${config.EARLY_SL.STAGE1_SEC}초`} />
                    <ConfigItem label="1단계 손절" value={`-${config.EARLY_SL.STAGE1_PERCENT}%`} color="text-red-400" />
                    <ConfigItem label="1단계 청산" value={`${config.EARLY_SL.STAGE1_REDUCE * 100}%`} />
                    <ConfigItem label="2단계 시간" value={`${config.EARLY_SL.STAGE2_SEC}초`} />
                    <ConfigItem label="2단계 손절" value={`-${config.EARLY_SL.STAGE2_PERCENT}%`} color="text-red-400" />
                  </div>
                </div>

                {/* 진입 필터 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Target className="w-4 h-4 text-cyan-400" />
                    진입 필터
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="최소 ADX" value={`${config.MIN_ADX_FOR_TREND}+`} />
                    <ConfigItem label="최소 신뢰도" value={`${config.MIN_CONFIDENCE}%`} />
                    <ConfigItem label="최소 거래량" value={`${config.MIN_VOLUME_RATIO * 100}%`} />
                    <ConfigItem label="타임 스탑" value={`${config.TIME_STOP_MINUTES}분`} />
                  </div>
                </div>

                {/* 브레이크이븐 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Scale className="w-4 h-4 text-yellow-400" />
                    브레이크이븐
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="발동 조건" value={`+${config.BREAKEVEN_TRIGGER}%`} color="text-green-400" />
                    <ConfigItem label="BE 손절선" value={`+${config.BREAKEVEN_SL}%`} />
                    <ConfigItem label="트레일링 갭" value={`${config.BREAKEVEN_TRAILING_GAP}%`} />
                    <ConfigItem label="타임아웃" value={`${config.BREAKEVEN_TIMEOUT_SEC}초`} />
                  </div>
                </div>

                {/* 메이저 코인 목록 */}
                {majorCoinMode && (
                  <div className="bg-card border border-border rounded-lg p-4">
                    <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                      <BarChart3 className="w-4 h-4 text-orange-400" />
                      대상 종목 ({MAJOR_COINS_WHITELIST.length}개)
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {MAJOR_COINS_WHITELIST.map((symbol) => (
                        <span
                          key={symbol}
                          className="text-xs bg-secondary/50 px-2 py-1 rounded font-mono"
                        >
                          {symbol.replace('USDT', '')}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 손실 관리 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Shield className="w-4 h-4 text-orange-400" />
                    손실 관리
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="최대 연속 손실" value={`${config.MAX_CONSECUTIVE_LOSSES}회`} />
                    <ConfigItem label="전체 쿨다운" value={`${config.LOSS_COOLDOWN_MINUTES}분`} />
                    <ConfigItem label="코인별 최대 손실" value={`${config.COIN_MAX_CONSECUTIVE_LOSSES}회`} />
                    <ConfigItem label="코인별 쿨다운" value={`${config.COIN_COOLDOWN_MINUTES}분`} />
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

// 설정 아이템 컴포넌트
const ConfigItem = ({ 
  label, 
  value, 
  color = 'text-foreground' 
}: { 
  label: string; 
  value: string; 
  color?: string;
}) => (
  <div className="flex items-center justify-between text-sm bg-secondary/30 rounded px-3 py-1.5">
    <span className="text-muted-foreground">{label}</span>
    <span className={cn("font-mono font-medium", color)}>{value}</span>
  </div>
);

export default TradingDocsModal;
