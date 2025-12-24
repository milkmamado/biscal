/**
 * 📚 매매 가이드 모달
 * 분할 매매 전략 v3.0 (실거래 전용)
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Target, DollarSign, Shield, TrendingUp, BarChart3, Timer, Zap, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LIMIT_ORDER_CONFIG } from '@/lib/limitOrderConfig';
import { MAJOR_COINS_WHITELIST } from '@/lib/tradingConfig';

interface TradingDocsModalProps {
  majorCoinMode?: boolean;
}

// 문서 버전
const DOCS_VERSION = '7.0.0';
const DOCS_UPDATED = '2025-01-23';

// 매매 규칙 정의 (현재 실제 사용 방식에 맞게)
const TRADING_RULES = {
  STRATEGY: {
    title: '⚡ 분할 매매 전략',
    rules: [
      '레버리지 1x / 5x / 10x 선택 가능',
      '분할 1 / 5 / 10 선택 가능',
      `잔고 ${LIMIT_ORDER_CONFIG.POSITION_SIZE_PERCENT}% 사용`,
      '자동매매: 시그널 스캔 전용 (종목 탐지)',
      '수동 진입: 분할 시장가 / 분할 지정가',
      '바이낸스 SL/TP 주문 연동',
    ],
  },
  ENTRY: {
    title: '📝 분할 진입 방식',
    rules: [
      '1분할: 시드 100% 한번에 진입',
      '5분할: 시드를 5등분하여 분산 진입',
      '10분할: 시드를 10등분하여 분산 진입',
      '롱: 현재가에서 아래로 가격 분산 배치',
      '숏: 현재가에서 위로 가격 분산 배치',
      '미체결 물량은 수동으로 취소',
    ],
  },
  TAKE_PROFIT: {
    title: '💰 익절 전략',
    rules: [
      'USDT 기반 목표 익절금액 설정',
      '바이낸스 TAKE_PROFIT_MARKET 주문 연동',
      '익절 조건 충족 시 자동 청산',
      'SL/TP 금액은 설정에서 조절 가능',
    ],
  },
  STOP_LOSS: {
    title: '🛡️ 손절 전략',
    rules: [
      'USDT 기반 손절금액 설정',
      `타임스탑: ${LIMIT_ORDER_CONFIG.STOP_LOSS.TIME_STOP_MINUTES}분`,
      '바이낸스 STOP_MARKET 주문 연동',
      '손절 시 즉시 시장가 청산',
    ],
  },
  FEE: {
    title: '💵 수수료 구조',
    rules: [
      `지정가 (Maker): ${LIMIT_ORDER_CONFIG.MAKER_FEE}%`,
      `시장가 (Taker): ${LIMIT_ORDER_CONFIG.TAKER_FEE}%`,
      '분할 지정가 진입 시 수수료 절감',
      '왕복 수수료 고려하여 익절금액 설정',
    ],
  },
  SIGNAL: {
    title: '📊 시그널 필터',
    rules: [
      `ADX ${LIMIT_ORDER_CONFIG.SIGNAL.MIN_ADX} 이상 (횡보장 제외)`,
      `거래량 평균 ${LIMIT_ORDER_CONFIG.SIGNAL.MIN_VOLUME_RATIO}% 이상`,
      '5봉 연속 양봉/음봉 과열 필터',
      'RSI / MACD / 볼린저밴드 필터',
      '필터 ON/OFF 개별 설정 가능',
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
    { key: 'SIGNAL', icon: Timer, color: 'text-purple-400' },
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
            ⚡ 분할 매매 가이드
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
                      <span>미체결 주문 조회 및 취소</span>
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
                    레버리지/분할 선택 가능 | 수동 진입 | 바이낸스 SL/TP 연동
                  </p>
                </div>

                {/* 진입 설정 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Target className="w-4 h-4 text-cyan-400" />
                    진입 설정
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="레버리지 옵션" value="1x / 5x / 10x" />
                    <ConfigItem label="분할 옵션" value="1 / 5 / 10" />
                    <ConfigItem label="잔고 사용" value={`${LIMIT_ORDER_CONFIG.POSITION_SIZE_PERCENT}%`} />
                    <ConfigItem label="진입 방식" value="수동 선택" />
                  </div>
                </div>

                {/* 손절/익절 설정 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Shield className="w-4 h-4 text-red-400" />
                    손절/익절 설정
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="손절" value="USDT 기반 설정" color="text-red-400" />
                    <ConfigItem label="익절" value="USDT 기반 설정" color="text-green-400" />
                    <ConfigItem label="타임스탑" value={`${LIMIT_ORDER_CONFIG.STOP_LOSS.TIME_STOP_MINUTES}분`} />
                    <ConfigItem label="바이낸스 연동" value="STOP_MARKET" />
                  </div>
                </div>

                {/* 수수료 구조 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <BarChart3 className="w-4 h-4 text-orange-400" />
                    수수료 구조
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm bg-green-500/10 rounded px-3 py-2">
                      <span className="text-muted-foreground">지정가 (Maker)</span>
                      <span className="font-mono text-green-400">{LIMIT_ORDER_CONFIG.MAKER_FEE}%</span>
                    </div>
                    <div className="flex items-center justify-between text-sm bg-orange-500/10 rounded px-3 py-2">
                      <span className="text-muted-foreground">시장가 (Taker)</span>
                      <span className="font-mono text-orange-400">{LIMIT_ORDER_CONFIG.TAKER_FEE}%</span>
                    </div>
                  </div>
                </div>

                {/* 시그널 필터 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Timer className="w-4 h-4 text-purple-400" />
                    시그널 필터
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="ADX 최소" value={`${LIMIT_ORDER_CONFIG.SIGNAL.MIN_ADX}`} />
                    <ConfigItem label="거래량 최소" value={`${LIMIT_ORDER_CONFIG.SIGNAL.MIN_VOLUME_RATIO}%`} />
                    <ConfigItem label="5봉 필터" value="과열 방지" />
                    <ConfigItem label="개별 ON/OFF" value="설정 가능" />
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
