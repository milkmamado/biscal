/**
 * 📚 매매 문서화 모달
 * 지정가 빠른 회전 전략 가이드 v1.0
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Target, DollarSign, Shield, TrendingUp, Bot, BarChart3, Clock, Zap, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LIMIT_ORDER_CONFIG } from '@/lib/limitOrderConfig';
import { MAJOR_COINS_WHITELIST } from '@/lib/tradingConfig';

interface TradingDocsModalProps {
  majorCoinMode?: boolean;
}

// 문서 버전
const DOCS_VERSION = '5.0.0';
const DOCS_UPDATED = '2024-12-21';

// 매매 규칙 정의
const TRADING_RULES = {
  STRATEGY: {
    title: '⚡ 지정가 빠른 회전 전략',
    rules: [
      '레버리지 10배 고정',
      '10분할 지정가 진입 (수수료 0.02%)',
      '10초 타임아웃 필터 (변동성 없는 종목 배제)',
      '일부 체결 시 5초 대기 후 미체결 취소',
      '수수료 반영 1만원 이상 시 익절',
      '익절 후 3초 내 잔량 미청산 시 시장가 청산',
    ],
  },
  ENTRY: {
    title: '📝 진입 방식 (10분할 지정가)',
    rules: [
      '시그널 발생 시 현재가 기준 ±0.03% 범위',
      '롱: 현재가 아래로 10단계 지정가',
      '숏: 현재가 위로 10단계 지정가',
      '10초 내 미체결 → 전량 취소, 다음 종목',
      '일부 체결 → 5초 대기 후 미체결 취소',
      '체결 후 손절라인 설정 및 모니터링',
    ],
  },
  TAKE_PROFIT: {
    title: '💰 익절 전략',
    rules: [
      '수수료 반영 순익 1만원 이상 시 익절',
      '지정가 5분할로 분산 익절 주문',
      '첫 익절 체결 후 3초 내 잔량 미체결',
      '→ 즉시 시장가로 전량 청산',
      '빠른 회전으로 수익 누적',
    ],
  },
  STOP_LOSS: {
    title: '🛡️ 손절 전략',
    rules: [
      `-${LIMIT_ORDER_CONFIG.STOP_LOSS.PERCENT}% 고정 손절`,
      `${LIMIT_ORDER_CONFIG.STOP_LOSS.TIME_STOP_MINUTES}분 타임스탑`,
      '손절 시 즉시 시장가 청산',
      '미체결 주문 전량 취소 후 청산',
    ],
  },
  FEE: {
    title: '💵 수수료 구조',
    rules: [
      '지정가 진입: 0.02% (Maker)',
      '지정가 익절: 0.02% (Maker)',
      '시장가 청산: 0.05% (Taker)',
      '지정가 왕복: 0.04% (시장가 0.10% 대비 60% 절감)',
      '1만원 익절 시 실질 수익: ~9,600원',
    ],
  },
  RISK: {
    title: '📊 리스크 관리',
    rules: [
      `일일 최대 거래: ${LIMIT_ORDER_CONFIG.RISK.DAILY_MAX_TRADES}회`,
      `일일 최대 손실: -${LIMIT_ORDER_CONFIG.RISK.DAILY_MAX_LOSS_PERCENT}%`,
      `연속 손실 한도: ${LIMIT_ORDER_CONFIG.RISK.MAX_CONSECUTIVE_LOSSES}회`,
      `휴식 시간: ${LIMIT_ORDER_CONFIG.RISK.LOSS_COOLDOWN_MINUTES}분`,
      '빠른 회전으로 리스크 분산',
    ],
  },
};

const TradingDocsModal = ({ majorCoinMode = false }: TradingDocsModalProps) => {
  const [open, setOpen] = useState(false);
  const modeLabel = majorCoinMode ? '메이저 코인' : '잡코인';

  const sections = [
    { key: 'STRATEGY', icon: Zap, color: 'text-primary' },
    { key: 'ENTRY', icon: Target, color: 'text-cyan-400' },
    { key: 'TAKE_PROFIT', icon: DollarSign, color: 'text-green-400' },
    { key: 'STOP_LOSS', icon: Shield, color: 'text-red-400' },
    { key: 'FEE', icon: BarChart3, color: 'text-orange-400' },
    { key: 'RISK', icon: Timer, color: 'text-purple-400' },
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
            <Zap className="w-5 h-5 text-primary" />
            ⚡ 지정가 빠른 회전 매매 가이드
          </DialogTitle>
          <DialogDescription className="flex items-center justify-between">
            <span>{modeLabel} 모드</span>
            <span className="text-[10px] text-muted-foreground">
              v{DOCS_VERSION} ({DOCS_UPDATED})
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

                {/* 전략 흐름도 */}
                <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-lg p-4">
                  <h3 className="font-bold text-blue-400 mb-3">📊 전략 흐름</h3>
                  <div className="text-sm text-muted-foreground space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-xs font-bold">1</span>
                      <span>시그널 감지 → 10분할 지정가 주문</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center text-xs font-bold">2</span>
                      <span>10초 대기 → 미체결시 취소, 다음 종목</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-xs font-bold">3</span>
                      <span>체결 → 손절라인 설정 & 모니터링</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold">4</span>
                      <span>1만원↑ 수익 → 5분할 지정가 익절</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs font-bold">5</span>
                      <span>3초 내 미체결 잔량 → 시장가 청산</span>
                    </div>
                  </div>
                </div>
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
                    레버리지 {LIMIT_ORDER_CONFIG.LEVERAGE}배 | 10분할 진입 | 5분할 익절
                  </p>
                </div>

                {/* 진입 설정 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Target className="w-4 h-4 text-cyan-400" />
                    진입 설정
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="1차 진입" value={`${LIMIT_ORDER_CONFIG.ENTRY.FIRST_ENTRY_PERCENT}% 지정가`} />
                    <ConfigItem label="2차 진입" value={`${LIMIT_ORDER_CONFIG.ENTRY.SECOND_ENTRY_PERCENT}% 시장가`} />
                    <ConfigItem label="가격 오프셋" value={`±${LIMIT_ORDER_CONFIG.ENTRY.PRICE_OFFSET_PERCENT}%`} />
                    <ConfigItem label="타임아웃" value={`${LIMIT_ORDER_CONFIG.ENTRY.TIMEOUT_SEC}초`} color="text-orange-400" />
                  </div>
                </div>

                {/* 익절 설정 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <DollarSign className="w-4 h-4 text-green-400" />
                    익절 설정
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="최소 익절금액" value={`₩${LIMIT_ORDER_CONFIG.TAKE_PROFIT.MIN_PROFIT_KRW.toLocaleString()}`} color="text-green-400" />
                    <ConfigItem label="분할 수" value={`${LIMIT_ORDER_CONFIG.TAKE_PROFIT.SPLIT_COUNT}분할`} />
                    <ConfigItem label="청산 타임아웃" value={`${LIMIT_ORDER_CONFIG.TAKE_PROFIT.CLOSE_TIMEOUT_SEC}초`} />
                    <ConfigItem label="간격" value={`₩${LIMIT_ORDER_CONFIG.TAKE_PROFIT.PROFIT_STEP_KRW.toLocaleString()}`} />
                  </div>
                </div>

                {/* 손절 설정 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Shield className="w-4 h-4 text-red-400" />
                    손절 설정
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="손절선" value={`-${LIMIT_ORDER_CONFIG.STOP_LOSS.PERCENT}%`} color="text-red-400" />
                    <ConfigItem label="타임스탑" value={`${LIMIT_ORDER_CONFIG.STOP_LOSS.TIME_STOP_MINUTES}분`} />
                  </div>
                </div>

                {/* 수수료 비교 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <BarChart3 className="w-4 h-4 text-orange-400" />
                    수수료 비교
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm bg-green-500/10 rounded px-3 py-2">
                      <span className="text-muted-foreground">지정가 왕복</span>
                      <span className="font-mono text-green-400">0.04% (진입+익절)</span>
                    </div>
                    <div className="flex items-center justify-between text-sm bg-red-500/10 rounded px-3 py-2">
                      <span className="text-muted-foreground">시장가 왕복</span>
                      <span className="font-mono text-red-400">0.10% (진입+청산)</span>
                    </div>
                    <div className="flex items-center justify-between text-sm bg-primary/10 rounded px-3 py-2">
                      <span className="text-muted-foreground">절감 효과</span>
                      <span className="font-mono text-primary font-bold">60% 절감!</span>
                    </div>
                  </div>
                </div>

                {/* 리스크 관리 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Timer className="w-4 h-4 text-purple-400" />
                    리스크 관리
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="일일 최대 거래" value={`${LIMIT_ORDER_CONFIG.RISK.DAILY_MAX_TRADES}회`} />
                    <ConfigItem label="일일 최대 손실" value={`-${LIMIT_ORDER_CONFIG.RISK.DAILY_MAX_LOSS_PERCENT}%`} color="text-red-400" />
                    <ConfigItem label="연속 손실 한도" value={`${LIMIT_ORDER_CONFIG.RISK.MAX_CONSECUTIVE_LOSSES}회`} color="text-orange-400" />
                    <ConfigItem label="휴식 시간" value={`${LIMIT_ORDER_CONFIG.RISK.LOSS_COOLDOWN_MINUTES}분`} />
                  </div>
                </div>

                {/* 메이저 코인 목록 */}
                {majorCoinMode && (
                  <div className="bg-card border border-border rounded-lg p-4">
                    <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                      <TrendingUp className="w-4 h-4 text-orange-400" />
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
