/**
 * 📚 매매 문서화 모달
 * 5분 스윙 전략 가이드
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Target, DollarSign, Shield, TrendingUp, Bot, BarChart3, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  TRADING_RULES, 
  TRADING_DOCS_VERSION, 
  TRADING_DOCS_UPDATED,
  MAJOR_SWING_CONFIG,
  ALTCOIN_SWING_CONFIG,
  MAJOR_COINS_WHITELIST,
} from '@/lib/tradingConfig';

interface TradingDocsModalProps {
  majorCoinMode?: boolean;
}

const TradingDocsModal = ({ majorCoinMode = false }: TradingDocsModalProps) => {
  const [open, setOpen] = useState(false);
  const config = majorCoinMode ? MAJOR_SWING_CONFIG : ALTCOIN_SWING_CONFIG;
  const modeLabel = majorCoinMode ? '🏆 메이저 코인' : '🎯 잡코인';

  const sections = [
    { key: 'STRATEGY', icon: TrendingUp, color: 'text-primary' },
    { key: 'ENTRY', icon: Target, color: 'text-cyan-400' },
    { key: 'POSITION_BUILD', icon: TrendingUp, color: 'text-blue-400' },
    { key: 'TAKE_PROFIT', icon: DollarSign, color: 'text-green-400' },
    { key: 'STOP_LOSS', icon: Shield, color: 'text-red-400' },
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
            5분 스윙 매매 가이드
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
                      ? 'BTC, ETH 등 유동성 높은 메이저 코인 대상 5분 스윙'
                      : '저가 알트코인 대상 변동성 기반 5분 스윙'}
                  </p>
                </div>

                {/* 분할 매수 설정 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <TrendingUp className="w-4 h-4 text-blue-400" />
                    분할 매수 설정
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="1봉당 진입" value={`${config.ENTRY_PERCENT * 100}%`} color="text-blue-400" />
                    <ConfigItem label="최대 봉 수" value={`${config.MAX_CANDLES}봉`} />
                    <ConfigItem label="최대 투입" value={`${config.ENTRY_PERCENT * config.MAX_CANDLES * 100}%`} color="text-primary" />
                    <ConfigItem label="쿨다운" value={`${config.ENTRY_COOLDOWN_MS / 1000}초`} />
                  </div>
                </div>

                {/* 손익 설정 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Settings className="w-4 h-4 text-primary" />
                    손익 설정 (평단가 기준)
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="조기 익절" value={`+${config.TP_PERCENT}%`} color="text-green-400" />
                    <ConfigItem label="손절" value={`-${config.SL_PERCENT}%`} color="text-red-400" />
                    <ConfigItem label="수수료" value={`${config.FEE_RATE}% / side`} />
                    <ConfigItem label="손익비" value={`1:${(config.TP_PERCENT / config.SL_PERCENT).toFixed(2)}`} color="text-cyan-400" />
                  </div>
                </div>

                {/* 조기 익절 조건 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <DollarSign className="w-4 h-4 text-green-400" />
                    조기 익절 조건
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="최소 진입 수" value={`${config.MIN_ENTRIES_FOR_TP}봉 이상`} />
                    <ConfigItem label="익절 목표" value={`+${config.TP_PERCENT}%`} color="text-green-400" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    * 2봉 이상 투입 후 평단가 +{config.TP_PERCENT}% 도달 시 즉시 전량 청산
                  </p>
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
                  </div>
                </div>

                {/* 청산 조건 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Shield className="w-4 h-4 text-red-400" />
                    청산 조건
                  </h3>
                  <ul className="space-y-1.5">
                    <li className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-green-400 mt-0.5">✓</span>
                      <span>조기 익절: 평단가 +{config.TP_PERCENT}% 도달</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-red-400 mt-0.5">✗</span>
                      <span>손절: 평단가 -{config.SL_PERCENT}% 도달</span>
                    </li>
                    <li className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-blue-400 mt-0.5">⏱</span>
                      <span>5봉 완성: 손익 무관 전량 청산</span>
                    </li>
                  </ul>
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

                {/* 전략 요약 */}
                <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-lg p-4">
                  <h3 className="font-bold text-blue-400 mb-2">📊 전략 요약</h3>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>1. 시그널 감지 → 봉 완성 대기 → AI 분석</p>
                    <p>2. 첫 봉 20% 진입 → 매 봉 20%씩 추가</p>
                    <p>3. 평단가 기준 TP/SL 실시간 갱신</p>
                    <p>4. 조기 익절 or 5봉 완성 시 청산</p>
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
