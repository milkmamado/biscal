/**
 * 🔄 5분 스윙 트레이딩 통합 설정 모듈
 * 모든 매매 관련 설정을 한 곳에서 관리
 * 
 * v3.0 - 스캘핑 → 5분 스윙 전략으로 전환
 */

// ===== 타입 정의 =====

export type TradingMode = 'MAJOR';
export type MarketCondition = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'VOLATILE' | 'QUIET';
export type TrendStrength = 'WEAK' | 'MEDIUM' | 'STRONG';
export type AIRecommendation = 'AGGRESSIVE' | 'NORMAL' | 'CONSERVATIVE' | 'STOP';

export interface SwingTradingConfig {
  // 기본 설정
  FEE_RATE: number;
  
  // 분할 매수
  ENTRY_PERCENT: number;  // 1봉당 진입 비율 (20%)
  MAX_CANDLES: number;    // 최대 봉 수 (5)
  
  // 익절/손절 (평단가 기준)
  TP_PERCENT: number;     // 조기 익절
  SL_PERCENT: number;     // 손절
  
  // 조기 익절 조건
  MIN_ENTRIES_FOR_TP: number; // 조기 익절 최소 진입 수
  
  // 필터
  MIN_ADX_FOR_TREND: number;
  MIN_CONFIDENCE: number;
  
  // 쿨다운
  ENTRY_COOLDOWN_MS: number;
}

export interface AIAdjustments {
  tpMultiplier: number;
  slMultiplier: number;
  minConfidence: number;
  entryDelay: number;
}

// ===== 5분 스윙 설정 =====

/**
 * 메이저 코인 스윙 설정
 * - 유동성 높음, 슬리피지 적음
 * - 더 타이트한 손익비
 */
export const MAJOR_SWING_CONFIG: SwingTradingConfig = {
  FEE_RATE: 0.05,              // 0.05% per side
  
  ENTRY_PERCENT: 0.20,         // 1봉당 20%
  MAX_CANDLES: 5,              // 5봉 완성
  
  TP_PERCENT: 0.50,            // +0.5% 조기 익절
  SL_PERCENT: 0.35,            // -0.35% 손절 (손익비 1:1.43)
  
  MIN_ENTRIES_FOR_TP: 2,       // 2봉 이상 진입 후 조기 익절 가능
  
  MIN_ADX_FOR_TREND: 20,       // ADX 20 이상
  MIN_CONFIDENCE: 55,          // 신뢰도 55% 이상
  
  ENTRY_COOLDOWN_MS: 30000,    // 30초 쿨다운
};


// ===== 레거시 호환 설정 (기존 코드 호환용) =====

export interface TradingConfig {
  FEE_RATE: number;
  TP_PERCENT: number;
  SL_PERCENT: number;
  DYNAMIC_TP: Record<TrendStrength, {
    TP_PERCENT: number;
    USE_TRAILING: boolean;
    TRAILING_ACTIVATION: number;
    TRAILING_DISTANCE: number;
  }>;
  EARLY_SL: {
    GRACE_PERIOD_SEC: number;
    STAGE1_SEC: number;
    STAGE1_PERCENT: number;
    STAGE1_REDUCE: number;
    STAGE2_SEC: number;
    STAGE2_PERCENT: number;
    STAGE2_REDUCE: number;
  };
  BREAKEVEN_TRIGGER: number;
  BREAKEVEN_SL: number;
  BREAKEVEN_TRAILING_GAP: number;
  BREAKEVEN_TIMEOUT_SEC: number;
  MIN_ADX_FOR_TREND: number;
  MIN_CONFIDENCE: number;
  MIN_VOLUME_RATIO: number;
  TIME_STOP_MINUTES: number;
  MAX_CONSECUTIVE_LOSSES: number;
  LOSS_COOLDOWN_MINUTES: number;
  COIN_MAX_CONSECUTIVE_LOSSES: number;
  COIN_COOLDOWN_MINUTES: number;
  MAX_LOSS_PER_TRADE_USD: number;
  BASE_RISK_PERCENT: number;
}

// 레거시 설정 (스윙 설정 기반으로 매핑)
export const MAJOR_CONFIG: TradingConfig = {
  FEE_RATE: 0.05,
  TP_PERCENT: MAJOR_SWING_CONFIG.TP_PERCENT,
  SL_PERCENT: MAJOR_SWING_CONFIG.SL_PERCENT,
  DYNAMIC_TP: {
    WEAK: { TP_PERCENT: 0.40, USE_TRAILING: false, TRAILING_ACTIVATION: 0.30, TRAILING_DISTANCE: 0.10 },
    MEDIUM: { TP_PERCENT: 0.50, USE_TRAILING: true, TRAILING_ACTIVATION: 0.35, TRAILING_DISTANCE: 0.10 },
    STRONG: { TP_PERCENT: 0.70, USE_TRAILING: true, TRAILING_ACTIVATION: 0.40, TRAILING_DISTANCE: 0.08 },
  },
  EARLY_SL: { GRACE_PERIOD_SEC: 8, STAGE1_SEC: 30, STAGE1_PERCENT: 0.12, STAGE1_REDUCE: 0.5, STAGE2_SEC: 60, STAGE2_PERCENT: 0.18, STAGE2_REDUCE: 0.75 },
  BREAKEVEN_TRIGGER: 0.08, BREAKEVEN_SL: 0.04, BREAKEVEN_TRAILING_GAP: 0.03, BREAKEVEN_TIMEOUT_SEC: 120,
  MIN_ADX_FOR_TREND: 20, MIN_CONFIDENCE: 55, MIN_VOLUME_RATIO: 1.2,
  TIME_STOP_MINUTES: 12, MAX_CONSECUTIVE_LOSSES: 5, LOSS_COOLDOWN_MINUTES: 60,
  COIN_MAX_CONSECUTIVE_LOSSES: 2, COIN_COOLDOWN_MINUTES: 30, MAX_LOSS_PER_TRADE_USD: 0.5, BASE_RISK_PERCENT: 1.0,
};


// ===== 설정 함수 =====

export function getSwingConfig(): SwingTradingConfig {
  return { ...MAJOR_SWING_CONFIG };
}

export function getBaseConfig(): TradingConfig {
  return { ...MAJOR_CONFIG };
}

export function applyAIAdjustments(
  baseConfig: TradingConfig,
  aiAdjustments: AIAdjustments,
  aiRecommendation: AIRecommendation
): TradingConfig {
  const config = { ...baseConfig };
  
  switch (aiRecommendation) {
    case 'AGGRESSIVE':
      config.TP_PERCENT *= 1.3;
      config.MIN_CONFIDENCE = Math.max(50, config.MIN_CONFIDENCE - 10);
      break;
    case 'CONSERVATIVE':
      config.TP_PERCENT *= 0.8;
      config.SL_PERCENT *= 0.9;
      config.MIN_CONFIDENCE = Math.min(80, config.MIN_CONFIDENCE + 10);
      break;
    case 'STOP':
      config.MIN_CONFIDENCE = 100;
      break;
  }
  
  config.TP_PERCENT *= aiAdjustments.tpMultiplier;
  config.SL_PERCENT *= aiAdjustments.slMultiplier;
  config.MIN_CONFIDENCE = Math.max(50, Math.min(90, aiAdjustments.minConfidence));
  
  return config;
}

export function getDynamicTPConfig(
  config: TradingConfig,
  trendStrength: TrendStrength
) {
  return config.DYNAMIC_TP[trendStrength];
}

// ===== 메이저 코인 =====

export const MAJOR_COIN_TIERS = {
  TIER_1: ['BTCUSDT', 'ETHUSDT'],
  TIER_2: ['BNBUSDT', 'SOLUSDT', 'XRPUSDT'],
  TIER_3: ['DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'MATICUSDT'],
} as const;

export const MAJOR_COINS_WHITELIST = [
  ...MAJOR_COIN_TIERS.TIER_1,
  ...MAJOR_COIN_TIERS.TIER_2,
  ...MAJOR_COIN_TIERS.TIER_3,
];

export function isMajorCoin(symbol: string): boolean {
  return (MAJOR_COINS_WHITELIST as readonly string[]).includes(symbol);
}

export function getCoinTier(symbol: string): 1 | 2 | 3 | null {
  if ((MAJOR_COIN_TIERS.TIER_1 as readonly string[]).includes(symbol)) return 1;
  if ((MAJOR_COIN_TIERS.TIER_2 as readonly string[]).includes(symbol)) return 2;
  if ((MAJOR_COIN_TIERS.TIER_3 as readonly string[]).includes(symbol)) return 3;
  return null;
}

// ===== 스크리닝 기준 =====

export const SCREENING_CRITERIA = {
  minVolume: 100_000_000,
  minVolatility: 0.5,
  maxVolatility: 10,
  minPrice: 0,
  maxPrice: Infinity,
  spreadThreshold: 0.05,
};

// ===== 문서화용 상수 =====

export const TRADING_RULES = {
  // 전략 개요
  STRATEGY: {
    title: '🔄 5분 스윙 전략',
    rules: [
      '1분봉 5개 = 5분 추세 매매',
      '첫 봉: AI 분석 후 20% 진입',
      '2~4봉: 방향 무관 20%씩 추가 매수 (물타기)',
      '5봉 완성: 전량 청산',
      '역방향 봉 = 더 좋은 평단가 기회',
    ],
  },
  
  // 진입 조건
  ENTRY: {
    title: '🎯 진입 조건',
    rules: [
      'ADX 20+ (메이저) / 22+ (Altcoin) 필수',
      'AI 분석 신뢰도 55%+ (메이저) / 60%+ (Altcoin)',
      '중간(medium) 이상 시그널 강도 필수',
      '시그널 후 봉 완성 대기 → 분석 후 진입',
    ],
  },
  
  // 분할 매수
  POSITION_BUILD: {
    title: '📈 분할 매수 전략',
    rules: [
      '1봉: 20% 진입 (추세 판단 후)',
      '2봉: 20% 추가 (방향 무관, 물타기)',
      '3봉: 20% 추가 (평단가 갱신)',
      '4봉: 20% 추가 (평단가 갱신)',
      '5봉: 20% 추가 + 전량 청산',
      '매 봉마다 평단가/TP/SL 재계산',
    ],
  },
  
  // 익절 전략
  TAKE_PROFIT: {
    title: '💰 익절 전략',
    rules: [
      '조기 익절: 평단가 +0.5% (메이저) / +0.6% (Altcoin)',
      '조기 익절 조건: 최소 2봉 이상 투입 후',
      '5봉 완성 시 손익 무관 전량 청산',
      '조기 익절 시 즉시 다음 시그널 대기',
    ],
  },
  
  // 손절 전략
  STOP_LOSS: {
    title: '🛡️ 손절 전략',
    rules: [
      '손절: 평단가 -0.35% (메이저) / -0.4% (Altcoin)',
      '손절 시 전량 청산',
      '진입 직후 5초간 손절 체크 면제',
      '수수료 포함 실손익 기준 판단',
    ],
  },
  
  // AI 시장 분석
  AI_ANALYSIS: {
    title: '🤖 AI 봉 분석',
    rules: [
      '봉 완성 후 방향 분석',
      '완성된 봉의 몸통/꼬리 비율 분석',
      '연속 캔들 방향 체크',
      '진행 중인 봉 방향 참고',
      '신뢰도 55% 미만 시 진입 스킵',
    ],
  },
  
  // 종목 선정
  SCREENING: {
    title: '📊 종목 선정 기준',
    rules: [
      '메이저 코인: BTC, ETH, BNB, SOL, XRP, DOGE 등 10종',
      'ATR 0.1~2.0% 범위 (적정 변동성)',
      '횡보장 필터: ADX < 20 시 종목 제외',
    ],
  },
};

export const TRADING_DOCS_VERSION = '3.0.0';
export const TRADING_DOCS_UPDATED = '2024-12-20';
