/**
 * 📚 매매 문서화 모달
 * 1분봉 피라미드 전략 가이드 (10배 고정)
 */
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Target, DollarSign, Shield, TrendingUp, TrendingDown, Bot, BarChart3, Settings, AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PYRAMID_CONFIG, TAKE_PROFIT_CONFIG, STOP_LOSS_CONFIG, RISK_CONFIG, EMERGENCY_CONFIG } from '@/lib/pyramidConfig';
import { MAJOR_COINS_WHITELIST } from '@/lib/tradingConfig';

interface TradingDocsModalProps {
  majorCoinMode?: boolean;
}

// 문서 버전
const DOCS_VERSION = '4.0.0';
const DOCS_UPDATED = '2024-12-20';

// 매매 규칙 정의
const TRADING_RULES = {
  STRATEGY: {
    title: '⚡ 하이브리드 전략 (10배 고정)',
    rules: [
      '레버리지 10배 고정 - 리스크 관리 단순화',
      '5단계 분할 진입 (각 20%)',
      '🔥 불타기 (수익시): Stage 2-3 추가 진입',
      '💧 물타기 (손실시): Stage 4-5 평단 개선',
      'Stage 2: +0.08% 수익시',
      'Stage 3: +0.12% 수익시',
      'Stage 4: -0.12% 손실시 물타기',
      'Stage 5: -0.18% 손실시 물타기',
    ],
  },
  ENTRY: {
    title: '🎯 진입 조건',
    rules: [
      'ADX 20+ 필수 (횡보장 필터)',
      'medium 이상 시그널 강도',
      '2개 이상 기술적 조건 충족',
      '거래량 평균 130% 이상',
      '일일 최대 10회 거래 제한',
      '연속 3패 시 60분 휴식',
    ],
  },
  TAKE_PROFIT: {
    title: '💰 익절 전략 (단계별)',
    rules: [
      '1단계만: +0.12% (50%), +0.25% (나머지)',
      '2-3단계: +0.3%/+0.6%/+1.0% 분할 익절',
      '4-5단계: +0.8%/+1.5%/+2.5%/+4.0% 분할 익절',
      '트레일링 스탑: 최고점 대비 간격 유지',
      '시간 초과 시 강제 익절',
    ],
  },
  STOP_LOSS: {
    title: '🛡️ 손절 전략 (단계별)',
    rules: [
      '1단계: -0.15% 손절',
      '2-3단계: -0.18% 손절',
      '4-5단계: -0.25% 손절',
      '동적 손절: 수익 발생 시 손절선 상향',
      '+0.6% 도달 시 → 본전 손절',
      '+1.0% 도달 시 → +0.3% 익절 보장',
    ],
  },
  EMERGENCY: {
    title: '🚨 긴급 탈출',
    rules: [
      '3개 연속 반대 캔들 → 50% 청산',
      '총 손실 -0.8% → 전량 청산',
      '거래량 50% 미만 급감 → 75% 청산',
      '15분봉 추세 반전 → 전량 청산',
    ],
  },
  TIME_LIMIT: {
    title: '⏰ 시간 제한',
    rules: [
      '1단계만: 최대 5분 보유',
      '2-3단계: 최대 10분 보유',
      '4-5단계: 최대 15분 보유',
      '시간 초과 시 손익 무관 청산',
    ],
  },
  RISK: {
    title: '📊 리스크 관리',
    rules: [
      '일일 최대 손실: -3%',
      '일일 최대 거래: 8회',
      '5단계 올인: 하루 2회 제한',
      '연속 손실 3회 시 60분 휴식',
      '목표 달성 (+5%) 시 거래 중단 권장',
    ],
  },
};

const TradingDocsModal = ({ majorCoinMode = false }: TradingDocsModalProps) => {
  const [open, setOpen] = useState(false);
  const modeLabel = majorCoinMode ? '메이저 코인' : '잡코인';

  const sections = [
    { key: 'STRATEGY', icon: TrendingUp, color: 'text-primary' },
    { key: 'ENTRY', icon: Target, color: 'text-cyan-400' },
    { key: 'TAKE_PROFIT', icon: DollarSign, color: 'text-green-400' },
    { key: 'STOP_LOSS', icon: Shield, color: 'text-red-400' },
    { key: 'EMERGENCY', icon: AlertTriangle, color: 'text-orange-400' },
    { key: 'TIME_LIMIT', icon: Clock, color: 'text-blue-400' },
    { key: 'RISK', icon: BarChart3, color: 'text-purple-400' },
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
            ⚡ 피라미드 매매 가이드 (10배)
          </DialogTitle>
          <DialogDescription className="flex items-center justify-between">
            <span>{modeLabel} 모드 설정</span>
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
                    레버리지 {PYRAMID_CONFIG.LEVERAGE}배 고정 | {PYRAMID_CONFIG.TOTAL_STAGES}단계 분할 | 각 {PYRAMID_CONFIG.STAGE_SIZE_PERCENT}%
                  </p>
                </div>

                {/* 불타기 (수익시 추가 진입) */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <TrendingUp className="w-4 h-4 text-green-400" />
                    🔥 불타기 (수익시 Stage 2-3)
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm bg-secondary/30 rounded px-3 py-1.5">
                      <span className="text-muted-foreground">Stage 2</span>
                      <span className="font-mono text-green-400">+0.08% 수익 + 2개 연속 캔들</span>
                    </div>
                    <div className="flex items-center justify-between text-sm bg-secondary/30 rounded px-3 py-1.5">
                      <span className="text-muted-foreground">Stage 3</span>
                      <span className="font-mono text-green-400">+0.12% 수익 + 3개 연속 캔들</span>
                    </div>
                  </div>
                </div>

                {/* 물타기 (손실시 추가 진입) */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <TrendingDown className="w-4 h-4 text-blue-400" />
                    💧 물타기 (손실시 Stage 4-5)
                  </h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm bg-secondary/30 rounded px-3 py-1.5">
                      <span className="text-muted-foreground">Stage 4</span>
                      <span className="font-mono text-blue-400">-0.12% 손실시 동일 사이즈 추가</span>
                    </div>
                    <div className="flex items-center justify-between text-sm bg-secondary/30 rounded px-3 py-1.5">
                      <span className="text-muted-foreground">Stage 5</span>
                      <span className="font-mono text-blue-400">-0.18% 손실시 동일 사이즈 추가</span>
                    </div>
                  </div>
                  
                  {/* 물타기 안전 필터 */}
                  <div className="mt-3 p-2 bg-orange-500/10 border border-orange-500/30 rounded">
                    <h4 className="text-xs font-bold text-orange-400 mb-2">🛡️ 안전 필터 (모두 충족시에만 물타기)</h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">RSI 과매도</span>
                        <span className="text-orange-400">≤ 30</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">ADX 유지</span>
                        <span className="text-orange-400">≥ 25</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">반대 캔들</span>
                        <span className="text-orange-400">&lt; 3개 연속</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">일일 제한</span>
                        <span className="text-orange-400">최대 3회</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    ※ 추세 역행시 물타기 차단 → 손실 누적 방지
                  </p>
                </div>

                {/* 익절 설정 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <DollarSign className="w-4 h-4 text-green-400" />
                    익절 목표 (포지션 유형별)
                  </h3>
                  <div className="grid grid-cols-1 gap-3">
                    <ConfigItem label="1단계만" value={`+0.12% (50%), +0.25% (나머지)`} color="text-green-400" />
                    <ConfigItem label="불타기 2단계" value={`+0.35% 전량`} color="text-green-400" />
                    <ConfigItem label="불타기 3단계" value={`+0.25% 전량`} color="text-green-400" />
                    <ConfigItem label="물타기 (빠른탈출)" value={`+0.15% 전량`} color="text-cyan-400" />
                  </div>
                </div>

                {/* 손절 설정 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Shield className="w-4 h-4 text-red-400" />
                    손절 (포지션 유형별)
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="불타기 (1-3)" value={`-${STOP_LOSS_CONFIG.PYRAMID_UP_SL}%`} color="text-red-400" />
                    <ConfigItem label="물타기 (4-5)" value={`-${STOP_LOSS_CONFIG.AVERAGING_DOWN_SL}%`} color="text-orange-400" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    ※ 물타기 포지션은 평단 개선 후 반등을 위해 더 넉넉한 손절폭
                  </p>
                </div>

                {/* 시간 제한 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <Clock className="w-4 h-4 text-blue-400" />
                    최대 보유 시간
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    <ConfigItem label="1단계" value={`${TAKE_PROFIT_CONFIG.STAGE_1_ONLY.maxHoldMinutes}분`} />
                    <ConfigItem label="불타기" value={`${TAKE_PROFIT_CONFIG.PYRAMID_UP.maxHoldMinutes}분`} />
                    <ConfigItem label="물타기" value={`${TAKE_PROFIT_CONFIG.AVERAGING_DOWN.maxHoldMinutes}분`} />
                  </div>
                </div>

                {/* 리스크 관리 */}
                <div className="bg-card border border-border rounded-lg p-4">
                  <h3 className="flex items-center gap-2 font-bold text-foreground mb-3">
                    <AlertTriangle className="w-4 h-4 text-orange-400" />
                    리스크 관리
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigItem label="일일 최대 손실" value={`-${RISK_CONFIG.DAILY_MAX_LOSS_PERCENT}%`} color="text-red-400" />
                    <ConfigItem label="일일 최대 거래" value={`${RISK_CONFIG.DAILY_MAX_TRADES}회`} />
                    <ConfigItem label="연속 손실 한도" value={`${RISK_CONFIG.MAX_CONSECUTIVE_LOSSES}회`} color="text-orange-400" />
                    <ConfigItem label="휴식 시간" value={`${RISK_CONFIG.LOSS_COOLDOWN_MINUTES}분`} />
                    <ConfigItem label="5단계 올인 제한" value={`하루 ${RISK_CONFIG.MAX_FULL_POSITION_DAILY}회`} color="text-purple-400" />
                    <ConfigItem label="긴급 탈출 (불타기)" value={`-${EMERGENCY_CONFIG.MAX_LOSS_PYRAMID_UP}%`} color="text-red-400" />
                    <ConfigItem label="긴급 탈출 (물타기)" value={`-${EMERGENCY_CONFIG.MAX_LOSS_AVERAGING_DOWN}%`} color="text-orange-400" />
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

                {/* 전략 요약 */}
                <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-lg p-4">
                  <h3 className="font-bold text-blue-400 mb-2">📊 전략 요약</h3>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>1. 시그널 감지 → 1단계 20% 즉시 진입</p>
                    <p>2. 수익 발생 시에만 단계별 추가 매수</p>
                    <p>3. 단계별 분할 익절 + 동적 손절</p>
                    <p>4. 시간 초과 또는 긴급 상황 시 청산</p>
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
