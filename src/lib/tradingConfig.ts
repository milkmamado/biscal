/**
 * 🏆 프로 스캘핑 통합 설정 모듈
 * 모든 매매 관련 설정을 한 곳에서 관리
 * 
 * v2.0 - AI 시장 분석 연동 + 동적 전략 조절
 */

// ===== 타입 정의 =====

export type TradingMode = 'MAJOR' | 'ALTCOIN';
export type MarketCondition = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'VOLATILE' | 'QUIET';
export type TrendStrength = 'WEAK' | 'MEDIUM' | 'STRONG';
export type AIRecommendation = 'AGGRESSIVE' | 'NORMAL' | 'CONSERVATIVE' | 'STOP';

export interface DynamicTPConfig {
  TP_PERCENT: number;
  USE_TRAILING: boolean;
  TRAILING_ACTIVATION: number;
  TRAILING_DISTANCE: number;
}

export interface EarlySLConfig {
  GRACE_PERIOD_SEC: number;
  STAGE1_SEC: number;
  STAGE1_PERCENT: number;
  STAGE1_REDUCE: number;
  STAGE2_SEC: number;
  STAGE2_PERCENT: number;
  STAGE2_REDUCE: number;
}

export interface TradingConfig {
  // 기본 설정
  FEE_RATE: number;
  TP_PERCENT: number;
  SL_PERCENT: number;
  
  // 동적 익절 (추세 강도별)
  DYNAMIC_TP: Record<TrendStrength, DynamicTPConfig>;
  
  // 조기 손절
  EARLY_SL: EarlySLConfig;
  
  // 브레이크이븐
  BREAKEVEN_TRIGGER: number;
  BREAKEVEN_SL: number;
  BREAKEVEN_TRAILING_GAP: number;
  BREAKEVEN_TIMEOUT_SEC: number;
  
  // 필터
  MIN_ADX_FOR_TREND: number;
  MIN_CONFIDENCE: number;
  MIN_VOLUME_RATIO: number;
  
  // 타임 스탑
  TIME_STOP_MINUTES: number;
  
  // 손실 관리
  MAX_CONSECUTIVE_LOSSES: number;
  LOSS_COOLDOWN_MINUTES: number;
  COIN_MAX_CONSECUTIVE_LOSSES: number;
  COIN_COOLDOWN_MINUTES: number;
  
  // 포지션
  MAX_LOSS_PER_TRADE_USD: number;
  BASE_RISK_PERCENT: number;
}

export interface AIAdjustments {
  tpMultiplier: number;
  slMultiplier: number;
  minConfidence: number;
  entryDelay: number;
}

// ===== 기본 설정 =====

/**
 * 메이저 코인 기본 설정
 * - 유동성 높음, 슬리피지 적음
 * - 더 타이트한 손익비
 */
export const MAJOR_CONFIG: TradingConfig = {
  FEE_RATE: 0.05,              // 0.05% per side
  TP_PERCENT: 0.25,            // 기본 +0.25%
  SL_PERCENT: 0.15,            // 기본 -0.15% (손익비 1:1.67)
  
  DYNAMIC_TP: {
    WEAK: {
      TP_PERCENT: 0.25,
      USE_TRAILING: false,
      TRAILING_ACTIVATION: 0.18,
      TRAILING_DISTANCE: 0.10,
    },
    MEDIUM: {
      TP_PERCENT: 0.40,
      USE_TRAILING: true,
      TRAILING_ACTIVATION: 0.28,
      TRAILING_DISTANCE: 0.10,
    },
    STRONG: {
      TP_PERCENT: 0.60,
      USE_TRAILING: true,
      TRAILING_ACTIVATION: 0.30,
      TRAILING_DISTANCE: 0.08,
    },
  },
  
  EARLY_SL: {
    GRACE_PERIOD_SEC: 8,       // 8초 보호
    STAGE1_SEC: 30,            // 30초 내
    STAGE1_PERCENT: 0.12,      // -0.12%
    STAGE1_REDUCE: 0.5,        // 50% 청산
    STAGE2_SEC: 60,            // 60초 내
    STAGE2_PERCENT: 0.18,      // -0.18%
    STAGE2_REDUCE: 0.75,       // 75% 청산
  },
  
  BREAKEVEN_TRIGGER: 0.08,     // +0.08%에서 BE 발동
  BREAKEVEN_SL: 0.04,          // BE 손절선 +0.04%
  BREAKEVEN_TRAILING_GAP: 0.03,
  BREAKEVEN_TIMEOUT_SEC: 120,
  
  MIN_ADX_FOR_TREND: 22,       // ADX 22 이상
  MIN_CONFIDENCE: 70,          // 신뢰도 70% 이상
  MIN_VOLUME_RATIO: 1.2,       // 거래량 120% 이상
  
  TIME_STOP_MINUTES: 12,
  
  MAX_CONSECUTIVE_LOSSES: 5,
  LOSS_COOLDOWN_MINUTES: 60,
  COIN_MAX_CONSECUTIVE_LOSSES: 2,
  COIN_COOLDOWN_MINUTES: 30,
  
  MAX_LOSS_PER_TRADE_USD: 0.5,
  BASE_RISK_PERCENT: 1.0,
};

/**
 * 잡코인 기본 설정
 * - 변동성 높음, 슬리피지 있음
 * - 더 넓은 손익비
 */
export const ALTCOIN_CONFIG: TradingConfig = {
  FEE_RATE: 0.05,
  TP_PERCENT: 0.35,            // 기본 +0.35%
  SL_PERCENT: 0.18,            // 기본 -0.18% (손익비 1:1.94)
  
  DYNAMIC_TP: {
    WEAK: {
      TP_PERCENT: 0.35,
      USE_TRAILING: false,
      TRAILING_ACTIVATION: 0.25,
      TRAILING_DISTANCE: 0.12,
    },
    MEDIUM: {
      TP_PERCENT: 0.55,
      USE_TRAILING: true,
      TRAILING_ACTIVATION: 0.38,
      TRAILING_DISTANCE: 0.14,
    },
    STRONG: {
      TP_PERCENT: 0.80,
      USE_TRAILING: true,
      TRAILING_ACTIVATION: 0.40,
      TRAILING_DISTANCE: 0.12,
    },
  },
  
  EARLY_SL: {
    GRACE_PERIOD_SEC: 10,      // 10초 보호 (슬리피지 대비)
    STAGE1_SEC: 45,            // 45초 내
    STAGE1_PERCENT: 0.15,      // -0.15%
    STAGE1_REDUCE: 0.5,
    STAGE2_SEC: 90,            // 90초 내
    STAGE2_PERCENT: 0.22,      // -0.22%
    STAGE2_REDUCE: 0.75,
  },
  
  BREAKEVEN_TRIGGER: 0.10,
  BREAKEVEN_SL: 0.06,
  BREAKEVEN_TRAILING_GAP: 0.04,
  BREAKEVEN_TIMEOUT_SEC: 150,
  
  MIN_ADX_FOR_TREND: 25,       // ADX 25 이상 (횡보장 더 강하게 필터)
  MIN_CONFIDENCE: 75,          // 신뢰도 75% 이상
  MIN_VOLUME_RATIO: 1.3,       // 거래량 130% 이상
  
  TIME_STOP_MINUTES: 15,
  
  MAX_CONSECUTIVE_LOSSES: 5,
  LOSS_COOLDOWN_MINUTES: 60,
  COIN_MAX_CONSECUTIVE_LOSSES: 2,
  COIN_COOLDOWN_MINUTES: 30,
  
  MAX_LOSS_PER_TRADE_USD: 0.5,
  BASE_RISK_PERCENT: 1.0,
};

// ===== 설정 함수 =====

/**
 * 현재 모드에 맞는 기본 설정 반환
 */
export function getBaseConfig(mode: TradingMode): TradingConfig {
  return mode === 'MAJOR' ? { ...MAJOR_CONFIG } : { ...ALTCOIN_CONFIG };
}

/**
 * AI 분석 결과를 반영한 동적 설정 생성
 */
export function applyAIAdjustments(
  baseConfig: TradingConfig,
  aiAdjustments: AIAdjustments,
  aiRecommendation: AIRecommendation
): TradingConfig {
  const config = { ...baseConfig };
  
  // AI 추천에 따른 기본 조정
  switch (aiRecommendation) {
    case 'AGGRESSIVE':
      // 공격적: TP 확대, 신뢰도 완화
      config.TP_PERCENT *= 1.3;
      config.MIN_CONFIDENCE = Math.max(60, config.MIN_CONFIDENCE - 10);
      break;
    case 'CONSERVATIVE':
      // 보수적: TP 축소, 신뢰도 강화
      config.TP_PERCENT *= 0.8;
      config.SL_PERCENT *= 0.9;
      config.MIN_CONFIDENCE = Math.min(85, config.MIN_CONFIDENCE + 10);
      break;
    case 'STOP':
      // 거래 중지: 신뢰도 최대로 올려서 사실상 진입 불가
      config.MIN_CONFIDENCE = 100;
      break;
    // NORMAL: 변경 없음
  }
  
  // AI 세부 조정 적용
  config.TP_PERCENT *= aiAdjustments.tpMultiplier;
  config.SL_PERCENT *= aiAdjustments.slMultiplier;
  config.MIN_CONFIDENCE = Math.max(50, Math.min(90, aiAdjustments.minConfidence));
  
  // 동적 TP도 조정
  for (const strength of ['WEAK', 'MEDIUM', 'STRONG'] as TrendStrength[]) {
    config.DYNAMIC_TP[strength].TP_PERCENT *= aiAdjustments.tpMultiplier;
  }
  
  return config;
}

/**
 * 추세 강도에 맞는 TP 설정 반환
 */
export function getDynamicTPConfig(
  config: TradingConfig,
  trendStrength: TrendStrength
): DynamicTPConfig {
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
  MAJOR: {
    minVolume: 100_000_000,    // $100M
    minVolatility: 0.5,
    maxVolatility: 10,
    minPrice: 0,
    maxPrice: Infinity,
    spreadThreshold: 0.05,
  },
  ALTCOIN: {
    minVolume: 10_000_000,     // $10M
    minVolatility: 1,
    maxVolatility: 20,
    minPrice: 0.01,
    maxPrice: 1,
    spreadThreshold: 0.1,
  },
};

// ===== 문서화용 상수 =====

export const TRADING_RULES = {
  // 진입 조건
  ENTRY: {
    title: '🎯 진입 조건',
    rules: [
      'MTF(15m+5m) 추세 합의 필수',
      'ADX 22+ (메이저) / 25+ (잡코인) 필수',
      '거래량 120%+ (메이저) / 130%+ (잡코인)',
      'AI 분석 신뢰도 70%+ (메이저) / 75%+ (잡코인)',
      '코인별 2연속 손절 시 30분 쿨다운',
      '연속 5손실 시 60분 전체 쿨다운',
    ],
  },
  
  // 익절 전략
  TAKE_PROFIT: {
    title: '💰 익절 전략',
    rules: [
      '추세 강도별 동적 익절 타겟',
      '약한 추세: 고정 익절 (0.25~0.35%)',
      '중간 추세: 트레일링 활성화 (0.40~0.55%)',
      '강한 추세: 확장 익절 (0.60~0.80%)',
      '트레일링: 고점 대비 0.08~0.14% 하락 시 청산',
    ],
  },
  
  // 손절 전략
  STOP_LOSS: {
    title: '🛡️ 손절 전략',
    rules: [
      '기본 손절: -0.15% (메이저) / -0.18% (잡코인)',
      '조기 손절 1단계: 30~45초 내 -0.12~0.15% 시 50% 청산',
      '조기 손절 2단계: 60~90초 내 -0.18~0.22% 시 75% 청산',
      '타임 스탑: 12~15분 초과 시 전량 청산',
      '진입 직후 보호: 8~10초간 조기손절 면제',
    ],
  },
  
  // 브레이크이븐
  BREAKEVEN: {
    title: '⚖️ 브레이크이븐',
    rules: [
      '+0.08% (메이저) / +0.10% (잡코인) 도달 시 발동',
      'BE 발동 후 손절선 +0.04~0.06%로 상향',
      'BE 후 타임아웃: 120~150초 내 TP 미도달 시 청산',
      '트레일링 BE: 최고수익 -0.03~0.04%로 추적',
    ],
  },
  
  // AI 시장 분석
  AI_ANALYSIS: {
    title: '🤖 AI 시장 분석',
    rules: [
      'TRENDING_UP/DOWN: 추세장 - 정상 거래',
      'RANGING: 횡보장 - 보수적 거래 또는 중지',
      'VOLATILE: 고변동성 - 손절 확대, 포지션 축소',
      'QUIET: 저변동성 - 익절 축소, 거래 빈도 감소',
      '권장: AGGRESSIVE/NORMAL/CONSERVATIVE/STOP',
    ],
  },
  
  // 종목 선정
  SCREENING: {
    title: '📊 종목 선정 기준',
    rules: [
      '메이저 모드: BTC, ETH, BNB, SOL, XRP, DOGE 등 10종',
      '잡코인 모드: $0.01~$1, 거래량 $10M+',
      'ATR 0.1~2.0% 범위 (적정 변동성)',
      '횡보장 필터: ADX < 15 시 종목 제외',
      '과열 필터: ADX > 50 시 종목 제외',
      '유동성 필터: 거래량 30% 미만 시 제외',
    ],
  },
};

export const TRADING_DOCS_VERSION = '2.0.0';
export const TRADING_DOCS_UPDATED = '2024-12-20';
