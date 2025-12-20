/**
 * ⚡ 프로 피라미드 전략 v3.0 (10배 고정)
 * 
 * 🎯 설계 원칙:
 * 1. 손익비 1:2 이상 (손절 < 익절)
 * 2. 물타기 완전 제거 (하락 추세 손실 증폭 방지)
 * 3. 불타기는 확실한 수익 확인 후만
 * 4. 수수료 0.10% 반영한 실질 수익
 * 5. 간결하고 일관된 로직
 */

// ===== 기본 설정 =====
export const PYRAMID_CONFIG = {
  // 기본
  LEVERAGE: 10,                    // 10배 고정
  TOTAL_STAGES: 3,                 // 🔧 3단계로 축소 (불타기만)
  STAGE_SIZE_PERCENT: 25,          // 🔧 25%로 증가 (더 집중된 포지션)
  FEE_RATE: 0.05,                  // 0.05% per side (왕복 0.10%)

  // 진입 조건 (시그널 필터)
  MIN_SIGNALS: 2,                  // 최소 2개 조건 충족
  MIN_VOLUME_RATIO: 130,           // 거래량 평균 130% 이상
  MIN_ADX: 20,                     // ADX 20 이상

  // ===== 불타기 (수익시 추가 진입) Stage 2-3 =====
  PYRAMID_UP: {
    enabled: true,
    maxStages: 3,                  // Stage 1 + 불타기 2단계 = 3단계
    conditions: {
      2: { profitRequired: 0.12 }, // 🔧 +0.12% 수익시 Stage 2 (수수료 후 +0.02% 확보)
      3: { profitRequired: 0.22 }, // 🔧 +0.22% 수익시 Stage 3 (강한 추세 확인)
    } as Record<number, { profitRequired: number }>,
    sizeMultiplier: 1.0,           // 동일 사이즈 (25%)
  },

  // ===== 물타기 완전 비활성화 =====
  AVERAGING_DOWN: {
    enabled: false,                // ❌ 물타기 비활성화
    maxStages: 0,
    conditions: {} as Record<number, { lossRequired: number }>,
    sizeMultiplier: 0,
    safetyFilters: {
      requireRsiOversold: false,
      rsiThreshold: 0,
      blockOnAdxFalling: false,
      blockOnOppositeCandles: 0,
      maxDailyAverageDown: 0,
    },
  },

  // 단계별 연속 캔들 조건 (불타기 전용)
  STAGE_CANDLE_REQUIRED: {
    1: 0,                          // 1단계: 조건 없음
    2: 1,                          // 2단계: 1개 연속 (추세 확인)
    3: 2,                          // 3단계: 2개 연속 (강한 추세)
  } as Record<number, number>,

  // 단계별 시간 윈도우 (분)
  STAGE_TIME_WINDOW: {
    2: [0.5, 10],                  // 🔧 2단계: 30초-10분 (충분한 관찰 시간)
    3: [1.0, 15],                  // 🔧 3단계: 1분-15분
  } as Record<number, [number, number]>,
};

// ===== 익절 설정 =====
// 🎯 손익비 1:2 목표 (손절 -0.15% vs 익절 +0.30%)
export const TAKE_PROFIT_CONFIG = {
  // 1단계만 진입 시
  STAGE_1_ONLY: {
    targets: [
      { percent: 0.25, closeRatio: 0.50 },  // 🔧 +0.25%에서 50% 익절 (실질 +0.15%)
      { percent: 0.40, closeRatio: 1.00 },  // 🔧 +0.40%에서 전량 익절 (실질 +0.30%)
    ],
    maxHoldMinutes: 12,                      // 🔧 12분 (충분한 시간)
    breakEvenTrigger: 0.15,                  // 🔧 +0.15% 도달 시 BE 활성화
    breakEvenSL: 0.03,                       // BE 시 손절선 -0.03%
  },

  // 불타기 포지션 (2-3단계) - 더 큰 수익 추구
  PYRAMID_UP: {
    targets_stage2: [
      { percent: 0.30, closeRatio: 0.40 },  // 🔧 2단계: +0.30%에서 40%
      { percent: 0.50, closeRatio: 1.00 },  // 🔧 +0.50%에서 전량
    ],
    targets_stage3: [
      { percent: 0.35, closeRatio: 0.40 },  // 🔧 3단계: +0.35%에서 40%
      { percent: 0.60, closeRatio: 1.00 },  // 🔧 +0.60%에서 전량 (큰 수익)
    ],
    maxHoldMinutes: 15,                      // 🔧 15분
    trailingStopGap: 0.15,                   // 🔧 트레일링 갭 0.15%
  },

  // 물타기 비활성화로 사용 안함
  AVERAGING_DOWN: {
    targets_quick: [
      { percent: 0.10, closeRatio: 1.00 },
    ],
    targets_full_recovery: [
      { percent: 0.15, closeRatio: 1.00 },
    ],
    maxHoldMinutes: 10,
    useQuickExit: true,
  },

  // 시간 기반 강제 익절
  TIME_BASED: {
    within5min: [
      { profitPercent: 0.20, closeRatio: 0.30 },
      { profitPercent: 0.35, closeRatio: 0.50 },
    ],
    within10min: [
      { profitPercent: 0.40, closeRatio: 0.50 },
      { profitPercent: 0.60, closeRatio: 0.70 },
    ],
    over15min: {
      profitThreshold: 0.15,                  // 🔧 +0.15% 이상이면 전량 청산
      breakEvenCloseRatio: 1.00,              // 🔧 손익분기면 100% 청산
    },
  },
};

// ===== 손절 설정 =====
// 🎯 핵심: 익절(+0.25~0.40)보다 작은 손절(-0.15) = 유리한 손익비
export const STOP_LOSS_CONFIG = {
  // 기본 손절 (모든 포지션 동일)
  PYRAMID_UP_SL: 0.15,             // 🔧 -0.15% (손익비 1:2 기준)

  // 물타기 비활성화
  AVERAGING_DOWN_SL: 0.15,         // 사용 안함

  // 1단계 조기 손절
  STAGE_1_EARLY: {
    timeSeconds: 180,              // 🔧 3분 후
    lossThreshold: 0.08,           // 🔧 -0.08%면 조기 청산
    closeRatio: 0.50,              // 50% 조기 청산
  },

  // 분할 손절 (빠른 탈출)
  PYRAMID_UP_PARTIAL: [
    { lossPercent: 0.10, closeRatio: 0.50, description: '50% 조기 청산' },
    { lossPercent: 0.15, closeRatio: 1.00, description: '전량 손절' },
  ],

  // 동적 손절 (수익 확보 후 보호)
  DYNAMIC_SL: [
    { profitTrigger: 0.15, newSL: 0.05 },   // 🔧 +0.15% 도달 시 SL → -0.05%
    { profitTrigger: 0.25, newSL: 0.00 },   // 🔧 +0.25% 도달 시 SL → 0% (본전)
    { profitTrigger: 0.35, newSL: -0.10 },  // 🔧 +0.35% 도달 시 SL → +0.10% (수익 확보)
    { profitTrigger: 0.50, newSL: -0.20 },  // 🔧 +0.50% 도달 시 SL → +0.20% (수익 확보)
  ],
};

// ===== 긴급 탈출 설정 =====
export const EMERGENCY_CONFIG = {
  // 연속 반대 캔들
  OPPOSITE_CANDLES: {
    count: 3,                      // 🔧 3개 연속 반대 방향
    closeRatio: 0.50,              // 50% 즉시 청산
  },

  // 총 손실 한계 (간소화)
  MAX_LOSS_PYRAMID_UP: 0.20,       // 🔧 -0.2% 손실 시 전량 청산
  MAX_LOSS_AVERAGING_DOWN: 0.20,   // 물타기 없으므로 동일

  // 거래량 급감
  VOLUME_DROP: {
    threshold: 50,                 // 🔧 평균 대비 50% 미만
    closeRatio: 0.75,              // 75% 청산
  },

  // 상위 타임프레임 반전
  MTF_REVERSAL: {
    enabled: false,                // 비활성화
    closeRatio: 1.00,
  },
};

// ===== 리스크 관리 설정 =====
export const RISK_CONFIG = {
  // 일일 한도
  DAILY_MAX_TRADES: 20,            // 🔧 하루 최대 20회
  DAILY_MAX_LOSS_PERCENT: 3.0,     // 🔧 일일 최대 손실 -3% (보수적)
  DAILY_TARGET_PROFIT_PERCENT: 5.0, // 🔧 목표 +5%

  // 연속 손실
  MAX_CONSECUTIVE_LOSSES: 3,       // 🔧 연속 3패 시 중단
  LOSS_COOLDOWN_MINUTES: 15,       // 🔧 15분 휴식

  // 올인 제한 (물타기 없음으로 간소화)
  MAX_FULL_POSITION_DAILY: 10,     // 3단계 최대 10회

  // 포지션 노출 한도 (3단계 × 25% × 10배 = 750%)
  MAX_EXPOSURE_PERCENT: 750,       // 🔧 최대 노출
  SAFE_EXPOSURE_PERCENT: 500,      // 🔧 안전 권장 (2단계)
  COMFORT_EXPOSURE_PERCENT: 250,   // 🔧 편안한 구간 (1단계)
};

// ===== 포지션 유형 =====
export type PositionType = 'initial' | 'pyramid_up' | 'averaging_down';

export function getPositionType(currentStage: number): PositionType {
  if (currentStage === 1) return 'initial';
  return 'pyramid_up'; // 물타기 없으므로 항상 불타기
}

// ===== 유틸리티 함수 =====

export function getStageSL(currentStage: number, positionType?: PositionType): number {
  return STOP_LOSS_CONFIG.PYRAMID_UP_SL; // 🔧 모든 단계 동일
}

export function getStageTPConfig(currentStage: number, positionType?: PositionType) {
  if (currentStage === 1) return TAKE_PROFIT_CONFIG.STAGE_1_ONLY;
  
  return {
    targets: currentStage === 2 
      ? TAKE_PROFIT_CONFIG.PYRAMID_UP.targets_stage2
      : TAKE_PROFIT_CONFIG.PYRAMID_UP.targets_stage3,
    maxHoldMinutes: TAKE_PROFIT_CONFIG.PYRAMID_UP.maxHoldMinutes,
  };
}

export function getStageMaxHold(currentStage: number, positionType?: PositionType): number {
  if (currentStage === 1) return TAKE_PROFIT_CONFIG.STAGE_1_ONLY.maxHoldMinutes;
  return TAKE_PROFIT_CONFIG.PYRAMID_UP.maxHoldMinutes;
}

export function getMaxLossPercent(currentStage: number, positionType?: PositionType): number {
  return EMERGENCY_CONFIG.MAX_LOSS_PYRAMID_UP; // 🔧 모든 단계 동일
}

export function getExposurePercent(stageCount: number): number {
  return stageCount * PYRAMID_CONFIG.STAGE_SIZE_PERCENT * PYRAMID_CONFIG.LEVERAGE;
}

// 평균단가 계산 (물타기 없지만 불타기에서도 사용)
export function calculateNewAvgPrice(
  currentAvgPrice: number,
  currentQty: number,
  newPrice: number,
  newQty: number
): { newAvgPrice: number; improvementPercent: number } {
  const newAvgPrice = (currentAvgPrice * currentQty + newPrice * newQty) / (currentQty + newQty);
  const improvementPercent = ((currentAvgPrice - newAvgPrice) / currentAvgPrice) * 100;
  return { newAvgPrice, improvementPercent: Math.abs(improvementPercent) };
}

// 물타기 - 비활성화
export function shouldAverageDown(
  currentStage: number,
  pnlPercent: number,
  positionType: PositionType
): { should: boolean; reason: string } {
  return { should: false, reason: '물타기 비활성화됨' }; // 🔧 항상 false
}

// 불타기 체크
export function shouldPyramidUp(
  currentStage: number,
  pnlPercent: number,
  positionType: PositionType
): { should: boolean; reason: string } {
  // 물타기 포지션에서는 불타기 불가 (해당 없음)
  if (positionType === 'averaging_down') {
    return { should: false, reason: '물타기 포지션에서 불타기 불가' };
  }

  // 불타기 최대 단계 체크
  if (currentStage >= PYRAMID_CONFIG.PYRAMID_UP.maxStages) {
    return { should: false, reason: '불타기 최대 단계 도달' };
  }

  const nextStage = currentStage + 1;
  const condition = PYRAMID_CONFIG.PYRAMID_UP.conditions[nextStage];
  if (!condition) {
    return { should: false, reason: '불타기 조건 없음' };
  }

  if (pnlPercent >= condition.profitRequired) {
    return { should: true, reason: `${nextStage}단계 불타기 조건 충족 (+${pnlPercent.toFixed(2)}% >= +${condition.profitRequired}%)` };
  }

  return { should: false, reason: `수익 부족 (+${pnlPercent.toFixed(2)}% < +${condition.profitRequired}%)` };
}
