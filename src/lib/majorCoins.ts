/**
 * 메이저 코인 프로 스캘핑 설정
 * - 유동성이 풍부하고 슬리피지가 적은 코인만 선별
 * - 프로 스캘퍼들이 주로 거래하는 종목
 */

// 메이저 코인 티어 분류
export const MAJOR_COIN_TIERS = {
  // Tier 1: 최상위 유동성 (슬리피지 거의 0)
  TIER_1: ['BTCUSDT', 'ETHUSDT'],
  
  // Tier 2: 높은 유동성 (안정적인 스프레드)
  TIER_2: ['BNBUSDT', 'SOLUSDT', 'XRPUSDT'],
  
  // Tier 3: 적당한 유동성 + 변동성 (스캘핑 최적)
  TIER_3: ['DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'MATICUSDT'],
} as const;

// 전체 메이저 코인 화이트리스트
export const MAJOR_COINS_WHITELIST = [
  ...MAJOR_COIN_TIERS.TIER_1,
  ...MAJOR_COIN_TIERS.TIER_2,
  ...MAJOR_COIN_TIERS.TIER_3,
];

// 메이저 코인 여부 확인
export function isMajorCoin(symbol: string): boolean {
  return (MAJOR_COINS_WHITELIST as readonly string[]).includes(symbol);
}

// 코인의 티어 확인
export function getCoinTier(symbol: string): 1 | 2 | 3 | null {
  if ((MAJOR_COIN_TIERS.TIER_1 as readonly string[]).includes(symbol)) return 1;
  if ((MAJOR_COIN_TIERS.TIER_2 as readonly string[]).includes(symbol)) return 2;
  if ((MAJOR_COIN_TIERS.TIER_3 as readonly string[]).includes(symbol)) return 3;
  return null;
}

// 메이저 코인 스크리닝 기준
export const MAJOR_COIN_CRITERIA = {
  // 가격 제한 없음 (BTC $100k+ 가능)
  minPrice: 0,
  maxPrice: Infinity,
  
  // 거래량 기준 ($30M 이상 - 메이저 코인은 항상 통과)
  minVolume: 30_000_000,
  
  // 변동성 범위 (메이저는 보통 0.5~15%)
  minVolatility: 0.3,
  maxVolatility: 15,
  
  // ATR 범위 (더 정밀하게)
  minATRPercent: 0.05,
  maxATRPercent: 1.5,
};

// 메이저 코인용 최적화된 거래 설정
export const MAJOR_COIN_TRADING_CONFIG = {
  // 수수료 (동일)
  FEE_RATE: 0.05,
  
  // 익절/손절 (더 정밀하게 - 슬리피지 없음)
  TP_PERCENT: 0.20,          // 기본 TP +0.20%
  SL_PERCENT: 0.10,          // 기본 SL -0.10% (더 타이트)
  
  // 동적 익절 (메이저 코인용 최적화)
  DYNAMIC_TP: {
    WEAK: {
      TP_PERCENT: 0.20,      // 약한 추세: +0.20% 고정
      USE_TRAILING: false,
      TRAILING_ACTIVATION: 0.15,
      TRAILING_DISTANCE: 0.08,
    },
    MEDIUM: {
      TP_PERCENT: 0.35,      // 중간 추세: +0.35%
      USE_TRAILING: true,
      TRAILING_ACTIVATION: 0.25,  // +0.25% 도달 시 트레일링
      TRAILING_DISTANCE: 0.10,    // 고점 대비 -0.10%
    },
    STRONG: {
      TP_PERCENT: 0.50,      // 강한 추세: +0.50% 
      USE_TRAILING: true,
      TRAILING_ACTIVATION: 0.25,  // +0.25% 도달 시 트레일링
      TRAILING_DISTANCE: 0.08,    // 고점 대비 -0.08% (더 타이트)
    },
  },
  
  // 조기 손절 (메이저는 더 완화 - 안정적)
  EARLY_SL: {
    GRACE_PERIOD_SEC: 8,     // 8초 보호 (슬리피지 적음)
    STAGE1_SEC: 25,          // 1단계: 25초
    STAGE1_PERCENT: 0.08,    // -0.08% (더 타이트 가능)
    STAGE1_REDUCE: 0.5,
    STAGE2_SEC: 50,          // 2단계: 50초
    STAGE2_PERCENT: 0.12,    // -0.12%
    STAGE2_REDUCE: 0.75,
  },
  
  // 브레이크이븐 (더 빠르게)
  BREAKEVEN_TRIGGER: 0.05,   // +0.05% 도달 시 BE
  BREAKEVEN_SL: 0.03,        // BE 손절선 +0.03%
  BREAKEVEN_TRAILING_GAP: 0.02, // 트레일링 BE gap 0.02%
  
  // 시장 환경 필터 (메이저는 더 완화)
  MIN_ADX_FOR_TREND: 18,     // 최소 ADX 18 (조금 완화)
  
  // 타임 스탑
  TIME_STOP_MINUTES: 12,     // 12분 (더 짧게)
};

// Altcoin 스크리닝 기준
export const ALTCOIN_CRITERIA = {
  // 저가 코인 필터 ($0.01 ~ $1.00)
  minPrice: 0.01,
  maxPrice: 1.00,
  
  // 거래량 기준 ($20M 이상)
  minVolume: 20_000_000,
  
  // 변동성 범위 (Altcoin은 변동성 높음 1~20%)
  minVolatility: 1.0,
  maxVolatility: 20,
  
  // ATR 범위
  minATRPercent: 0.1,
  maxATRPercent: 3.0,
};

// Altcoin용 거래 설정
export const ALTCOIN_TRADING_CONFIG = {
  // 수수료
  FEE_RATE: 0.05,
  
  // 익절/손절 (Altcoin은 더 넓게)
  TP_PERCENT: 0.30,          // 기본 TP +0.30%
  SL_PERCENT: 0.15,          // 기본 SL -0.15%
  
  // 동적 익절 (Altcoin용)
  DYNAMIC_TP: {
    WEAK: {
      TP_PERCENT: 0.25,
      USE_TRAILING: false,
      TRAILING_ACTIVATION: 0.20,
      TRAILING_DISTANCE: 0.10,
    },
    MEDIUM: {
      TP_PERCENT: 0.45,
      USE_TRAILING: true,
      TRAILING_ACTIVATION: 0.30,
      TRAILING_DISTANCE: 0.12,
    },
    STRONG: {
      TP_PERCENT: 0.60,
      USE_TRAILING: true,
      TRAILING_ACTIVATION: 0.35,
      TRAILING_DISTANCE: 0.10,
    },
  },
  
  // 조기 손절 (Altcoin은 더 완화)
  EARLY_SL: {
    GRACE_PERIOD_SEC: 10,
    STAGE1_SEC: 30,
    STAGE1_PERCENT: 0.12,
    STAGE1_REDUCE: 0.5,
    STAGE2_SEC: 60,
    STAGE2_PERCENT: 0.18,
    STAGE2_REDUCE: 0.75,
  },
  
  // 브레이크이븐
  BREAKEVEN_TRIGGER: 0.08,
  BREAKEVEN_SL: 0.04,
  BREAKEVEN_TRAILING_GAP: 0.03,
  
  // 시장 환경 필터
  MIN_ADX_FOR_TREND: 20,
  
  // 타임 스탑
  TIME_STOP_MINUTES: 15,
};

// 모드별 설정 반환
export function getTradingConfig(majorCoinMode: boolean = true) {
  return majorCoinMode ? MAJOR_COIN_TRADING_CONFIG : ALTCOIN_TRADING_CONFIG;
}

// 모드별 스크리닝 기준 반환
export function getScreeningCriteria(majorCoinMode: boolean = true) {
  return majorCoinMode ? MAJOR_COIN_CRITERIA : ALTCOIN_CRITERIA;
}

// 티어별 특성 설명
export const TIER_DESCRIPTIONS = {
  1: { label: 'Tier 1', description: '최고 유동성', color: 'text-yellow-400' },
  2: { label: 'Tier 2', description: '높은 유동성', color: 'text-cyan-400' },
  3: { label: 'Tier 3', description: '적정 유동성', color: 'text-green-400' },
} as const;
