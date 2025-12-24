/**
 * 📚 매매 가이드 모달
 * 2단계 진입 전략 v2.1 (실거래 전용)
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Target, DollarSign, Shield, TrendingUp, BarChart3, Timer, Zap, ArrowRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LIMIT_ORDER_CONFIG } from '@/lib/limitOrderConfig';
import { MAJOR_COINS_WHITELIST } from '@/lib/tradingConfig';

interface TradingDocsModalProps {
  majorCoinMode?: boolean;
}

// 문서 버전
const DOCS_VERSION = '6.0.0';
const DOCS_UPDATED = '2025-01-23';

// 매매 규칙 정의 (현재 전략에 맞게 업데이트)
const TRADING_RULES = {
  STRATEGY: {
    title: '⚡ 2단계 진입 전략',
    rules: [
      `레버리지 ${LIMIT_ORDER_CONFIG.LEVERAGE}배 고정`,
      '1차: 50% 지정가 진입 (수수료 0.02%)',
      '2차: 1차 체결 시 50% 시장가 즉시 진입',
      `${LIMIT_ORDER_CONFIG.ENTRY.TIMEOUT_SEC}초 내 미체결 시 전량 취소`,
      '빠른 진입 + 빠른 회전',
      '실거래 전용 (Binance Futures API)',
    ],
  },
  ENTRY: {
    title: '📝 2단계 진입 방식',
    rules: [
      `1차 진입: ${LIMIT_ORDER_CONFIG.ENTRY.FIRST_ENTRY_PERCENT}% 지정가 (±${LIMIT_ORDER_CONFIG.ENTRY.PRICE_OFFSET_PERCENT}%)`,
      '롱: 현재가 아래로 지정가 / 숏: 현재가 위로 지정가',
      `${LIMIT_ORDER_CONFIG.ENTRY.TIMEOUT_SEC}초 타임아웃 (미체결 시 취소)`,
      `1차 ${LIMIT_ORDER_CONFIG.ENTRY.MIN_FILL_RATIO * 100}% 이상 체결 시 2차 진입`,
      `2차 진입: ${LIMIT_ORDER_CONFIG.ENTRY.SECOND_ENTRY_PERCENT}% 시장가 즉시 진입`,
      '체결 즉시 SL/TP 바이낸스 연동',
    ],
  },
  TAKE_PROFIT: {
    title: '💰 익절 전략',
    rules: [
      `${LIMIT_ORDER_CONFIG.TAKE_PROFIT.SPLIT_COUNT}분할 지정가 익절`,
      `최소 익절금액: ₩${LIMIT_ORDER_CONFIG.TAKE_PROFIT.MIN_PROFIT_KRW.toLocaleString()}`,
      `분할 간격: ₩${LIMIT_ORDER_CONFIG.TAKE_PROFIT.PROFIT_STEP_KRW.toLocaleString()}`,
      '바이낸스 TAKE_PROFIT_MARKET 주문 연동',
      `익절 체결 후 ${LIMIT_ORDER_CONFIG.TAKE_PROFIT.CLOSE_TIMEOUT_SEC}초 내 잔량 → 시장가 청산`,
      '수수료 반영 순익 기준 익절',
    ],
  },
  STOP_LOSS: {
    title: '🛡️ 손절 전략',
    rules: [
      `손절선: -${LIMIT_ORDER_CONFIG.STOP_LOSS.PERCENT}% (수수료 포함 실질 약 -0.22%)`,
      `타임스탑: ${LIMIT_ORDER_CONFIG.STOP_LOSS.TIME_STOP_MINUTES}분`,
      '바이낸스 STOP_MARKET 주문 연동',
      '손절 시 즉시 시장가 청산',
      '미체결 주문 전량 취소 후 청산',
    ],
  },
  FEE: {
    title: '💵 수수료 구조',
    rules: [
      `지정가 진입: ${LIMIT_ORDER_CONFIG.MAKER_FEE}% (Maker)`,
      `시장가 진입/청산: ${LIMIT_ORDER_CONFIG.TAKER_FEE}% (Taker)`,
      '2단계 진입 평균 수수료: ~0.035%',
      '지정가 익절 시 왕복 0.04%',
      '시장가 청산 시 왕복 0.07%',
    ],
  },
  RISK: {
    title: '📊 리스크 관리',
    rules: [
      `일일 최대 거래: ${LIMIT_ORDER_CONFIG.RISK.DAILY_MAX_TRADES}회`,
      `일일 최대 손실: -${LIMIT_ORDER_CONFIG.RISK.DAILY_MAX_LOSS_PERCENT}%`,
      `연속 손실 한도: ${LIMIT_ORDER_CONFIG.RISK.MAX_CONSECUTIVE_LOSSES}회`,
      `휴식 시간: ${LIMIT_ORDER_CONFIG.RISK.LOSS_COOLDOWN_MINUTES}분`,
      `잔고 사용률: ${LIMIT_ORDER_CONFIG.POSITION_SIZE_PERCENT}%`,
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
            ⚡ 2단계 진입 전략 매매 가이드
          </DialogTitle>
          <DialogDescription className="flex items-center justify-between">
            <span>{modeLabel} 모드 | 실거래 전용</span>
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
                  <h3 className="font-bold text-blue-400 mb-3">📊 2단계 진입 흐름</h3>
                  <div className="text-sm text-muted-foreground space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-xs font-bold">1</span>
                      <span>시그널 감지</span>
                      <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      <span className="text-cyan-400 font-medium">50% 지정가 주문</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center text-xs font-bold">2</span>
                      <span>{LIMIT_ORDER_CONFIG.ENTRY.TIMEOUT_SEC}초 대기</span>
                      <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      <span className="text-yellow-400 font-medium">미체결 시 취소 → 다음 종목</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-xs font-bold">3</span>
                      <span>1차 체결 ({LIMIT_ORDER_CONFIG.ENTRY.MIN_FILL_RATIO * 100}%↑)</span>
                      <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      <span className="text-green-400 font-medium">50% 시장가 즉시 진입</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs font-bold">4</span>
                      <span>포지션 확정</span>
                      <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      <span className="text-purple-400 font-medium">바이낸스 SL/TP 연동</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 flex items-center justify-center text-xs font-bold">5</span>
                      <span>익절/손절 조건 충족</span>
                      <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      <span className="text-orange-400 font-medium">청산 → 다음 시그널</span>
                    </div>
                  </div>
                </div>

                {/* 바이낸스 API 연동 정보 */}
                <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-lg p-4">
                  <h3 className="font-bold text-green-400 mb-3 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    바이낸스 API 연동
                  </h3>
                  <div className="text-sm text-muted-foreground space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      <span>실시간 포지션 조회 (fapi/v2/positionRisk)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      <span>지정가/시장가 주문 (fapi/v1/order)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      <span>STOP_MARKET / TAKE_PROFIT_MARKET 주문</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      <span>주문 취소 및 미체결 조회</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-green-400">✓</span>
                      <span>잔고 및 레버리지 설정</span>
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
                    레버리지 {LIMIT_ORDER_CONFIG.LEVERAGE}배 | 2단계 진입 | {LIMIT_ORDER_CONFIG.TAKE_PROFIT.SPLIT_COUNT}분할 익절 | 실거래
                  </p>
                </div>

                {/* 진입 설정 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Target className="w-4 h-4 text-cyan-400" />
                    2단계 진입 설정
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="1차 진입" value={`${LIMIT_ORDER_CONFIG.ENTRY.FIRST_ENTRY_PERCENT}% 지정가`} />
                    <ConfigItem label="2차 진입" value={`${LIMIT_ORDER_CONFIG.ENTRY.SECOND_ENTRY_PERCENT}% 시장가`} />
                    <ConfigItem label="가격 오프셋" value={`±${LIMIT_ORDER_CONFIG.ENTRY.PRICE_OFFSET_PERCENT}%`} />
                    <ConfigItem label="타임아웃" value={`${LIMIT_ORDER_CONFIG.ENTRY.TIMEOUT_SEC}초`} color="text-orange-400" />
                    <ConfigItem label="최소 체결률" value={`${LIMIT_ORDER_CONFIG.ENTRY.MIN_FILL_RATIO * 100}%`} />
                    <ConfigItem label="잔고 사용" value={`${LIMIT_ORDER_CONFIG.POSITION_SIZE_PERCENT}%`} />
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
                    <ConfigItem label="분할 간격" value={`₩${LIMIT_ORDER_CONFIG.TAKE_PROFIT.PROFIT_STEP_KRW.toLocaleString()}`} />
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
                    <ConfigItem label="실질 손절" value="~-0.22% (수수료포함)" color="text-red-400" />
                    <ConfigItem label="청산 방식" value="STOP_MARKET" />
                  </div>
                </div>

                {/* 수수료 비교 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <BarChart3 className="w-4 h-4 text-orange-400" />
                    수수료 구조
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm bg-secondary/30 rounded px-3 py-2">
                      <span className="text-muted-foreground">지정가 (Maker)</span>
                      <span className="font-mono text-green-400">{LIMIT_ORDER_CONFIG.MAKER_FEE}%</span>
                    </div>
                    <div className="flex items-center justify-between text-sm bg-secondary/30 rounded px-3 py-2">
                      <span className="text-muted-foreground">시장가 (Taker)</span>
                      <span className="font-mono text-orange-400">{LIMIT_ORDER_CONFIG.TAKER_FEE}%</span>
                    </div>
                    <div className="flex items-center justify-between text-sm bg-green-500/10 rounded px-3 py-2">
                      <span className="text-muted-foreground">2단계 진입 평균</span>
                      <span className="font-mono text-green-400">~0.035%</span>
                    </div>
                    <div className="flex items-center justify-between text-sm bg-primary/10 rounded px-3 py-2">
                      <span className="text-muted-foreground">vs 시장가 진입</span>
                      <span className="font-mono text-primary font-bold">30% 절감!</span>
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
