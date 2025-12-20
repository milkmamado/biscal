/**
 * ⚡ 하이브리드 피라미드 전략 설정 (10배 고정)
 * 불타기 (수익시) + 물타기 (손실시) 하이브리드 시스템
 */

// ===== 기본 설정 =====
export const PYRAMID_CONFIG = {
  // 기본
  LEVERAGE: 10,                    // 10배 고정
  TOTAL_STAGES: 5,                 // 5단계 분할 (불타기 3 + 물타기 2)
  STAGE_SIZE_PERCENT: 20,          // 각 단계 20%
  FEE_RATE: 0.05,                  // 0.05% per side

  // 진입 조건 (시그널 필터)
  MIN_SIGNALS: 2,                  // 최소 2개 조건 충족
  MIN_VOLUME_RATIO: 130,           // 거래량 평균 130% 이상
  MIN_ADX: 20,                     // ADX 20 이상

  // ===== 불타기 (수익시 추가 진입) Stage 2-3 =====
  PYRAMID_UP: {
    enabled: true,
    maxStages: 3,                  // Stage 1 + 불타기 2단계 = 3단계
    conditions: {
      2: { profitRequired: 0.08 }, // +0.08% 수익시 Stage 2 진입
      3: { profitRequired: 0.12 }, // +0.12% 수익시 Stage 3 진입
    } as Record<number, { profitRequired: number }>,
    sizeMultiplier: 1.0,           // 동일 사이즈 (20%)
  },

  // ===== 물타기 (손실시 추가 진입) Stage 4-5 =====
  AVERAGING_DOWN: {
    enabled: true,
    maxStages: 2,                  // 물타기 최대 2단계
    conditions: {
      4: { lossRequired: 0.12 },   // -0.12% 손실시 Stage 4 물타기
      5: { lossRequired: 0.18 },   // -0.18% 손실시 Stage 5 물타기
    } as Record<number, { lossRequired: number }>,
    sizeMultiplier: 1.0,           // 동일 사이즈 (1.0x) - 보수적 접근
  },

  // 단계별 연속 캔들 조건 (불타기 전용)
  STAGE_CANDLE_REQUIRED: {
    1: 0,                          // 1단계: 조건 없음
    2: 2,                          // 2단계: 2개 연속 같은 방향
    3: 3,                          // 3단계: 3개 연속
  } as Record<number, number>,

  // 단계별 시간 윈도우 (분)
  STAGE_TIME_WINDOW: {
    2: [1, 5],                     // 불타기 2단계: 1-5분 후
    3: [3, 10],                    // 불타기 3단계: 3-10분 후
    4: [0.5, 8],                   // 물타기 4단계: 30초-8분 후
    5: [2, 12],                    // 물타기 5단계: 2-12분 후
  } as Record<number, [number, number]>,
};

// ===== 익절 설정 =====
export const TAKE_PROFIT_CONFIG = {
  // 1단계만 진입 시
  STAGE_1_ONLY: {
    targets: [
      { percent: 0.12, closeRatio: 0.50 },  // +0.12%에서 50% 청산
      { percent: 0.25, closeRatio: 1.00 },  // +0.25%에서 나머지 청산
    ],
    maxHoldMinutes: 5,
    breakEvenTrigger: 0.06,                  // +0.06% 도달 시 SL → +0.02%
    breakEvenSL: 0.02,
  },

  // 불타기 포지션 (2-3단계)
  PYRAMID_UP: {
    targets_stage2: [
      { percent: 0.35, closeRatio: 1.00 },  // 2단계시 +0.35%에서 전량 청산
    ],
    targets_stage3: [
      { percent: 0.25, closeRatio: 1.00 },  // 3단계시 +0.25%에서 전량 청산
    ],
    maxHoldMinutes: 10,
    trailingStopGap: 0.12,
  },

  // 물타기 포지션 (4-5단계)
  AVERAGING_DOWN: {
    targets_quick: [
      { percent: 0.15, closeRatio: 1.00 },  // 빠른 탈출: +0.15%
    ],
    targets_full_recovery: [
      { percent: 0.25, closeRatio: 1.00 },  // 완전 회복: +0.25%
    ],
    maxHoldMinutes: 12,
    useQuickExit: true,                      // 빠른 탈출 모드 우선
  },

  // 시간 기반 강제 익절
  TIME_BASED: {
    within5min: [
      { profitPercent: 0.4, closeRatio: 0.30 },
      { profitPercent: 0.6, closeRatio: 0.50 },
    ],
    within10min: [
      { profitPercent: 0.8, closeRatio: 0.50 },
      { profitPercent: 1.2, closeRatio: 0.70 },
    ],
    over15min: {
      profitThreshold: 0.3,                  // +0.3% 이상이면 전량 청산
      breakEvenCloseRatio: 0.80,             // 손익분기면 80% 청산
    },
  },
};

// ===== 손절 설정 =====
export const STOP_LOSS_CONFIG = {
  // 불타기 포지션 손절 (Stage 1-3)
  PYRAMID_UP_SL: 0.20,             // -0.20%

  // 물타기 포지션 손절 (Stage 4-5) - 더 넉넉한 공간
  AVERAGING_DOWN_SL: 0.35,         // -0.35%

  // 1단계 조기 손절
  STAGE_1_EARLY: {
    timeSeconds: 180,              // 3분 후
    lossThreshold: 0.08,           // -0.08%면 청산
    closeRatio: 0.50,              // 50% 조기 청산
  },

  // 불타기 분할 손절
  PYRAMID_UP_PARTIAL: [
    { lossPercent: 0.12, closeRatio: 0.50, description: '50% 조기 청산' },
    { lossPercent: 0.20, closeRatio: 1.00, description: '전량 손절' },
  ],

  // 동적 손절 (높은 수익 도달 시)
  DYNAMIC_SL: [
    { profitTrigger: 0.20, newSL: 0.08 },   // +0.2% 도달 시 SL → -0.08%
    { profitTrigger: 0.40, newSL: 0.00 },   // +0.4% 도달 시 SL → 0% (본전)
    { profitTrigger: 0.60, newSL: -0.15 },  // +0.6% 도달 시 SL → +0.15%
  ],
};

// ===== 긴급 탈출 설정 =====
export const EMERGENCY_CONFIG = {
  // 연속 반대 캔들
  OPPOSITE_CANDLES: {
    count: 3,                      // 3개 연속 반대 방향
    closeRatio: 0.50,              // 50% 즉시 청산
  },

  // 총 손실 한계 (포지션 유형별)
  MAX_LOSS_PYRAMID_UP: 0.40,       // 불타기: -0.4% 손실 시 전량 청산
  MAX_LOSS_AVERAGING_DOWN: 0.60,   // 물타기: -0.6% 손실 시 전량 청산

  // 거래량 급감
  VOLUME_DROP: {
    threshold: 50,                 // 평균 대비 50% 미만
    closeRatio: 0.75,              // 75% 청산
  },

  // 상위 타임프레임 반전
  MTF_REVERSAL: {
    enabled: true,                 // 15분봉 추세 반전 시
    closeRatio: 1.00,              // 전량 청산
  },
};

// ===== 리스크 관리 설정 =====
export const RISK_CONFIG = {
  // 일일 한도
  DAILY_MAX_TRADES: 10,            // 하루 최대 10회 (물타기로 늘림)
  DAILY_MAX_LOSS_PERCENT: 3.0,     // 일일 최대 손실 -3%
  DAILY_TARGET_PROFIT_PERCENT: 5.0, // 목표 달성 시 중단 고려

  // 연속 손실
  MAX_CONSECUTIVE_LOSSES: 3,       // 연속 3패 시 중단
  LOSS_COOLDOWN_MINUTES: 60,       // 60분 휴식

  // 올인 제한
  MAX_FULL_POSITION_DAILY: 3,      // 5단계 올인 하루 최대 3회

  // 포지션 노출 한도
  MAX_EXPOSURE_PERCENT: 1000,      // 절대 한계 (100% × 10배)
  SAFE_EXPOSURE_PERCENT: 600,      // 안전 권장 (60% × 10배)
  COMFORT_EXPOSURE_PERCENT: 400,   // 편안한 구간 (40% × 10배)
};

// ===== 포지션 유형 =====
export type PositionType = 'initial' | 'pyramid_up' | 'averaging_down';

export function getPositionType(currentStage: number): PositionType {
  if (currentStage === 1) return 'initial';
  if (currentStage <= 3) return 'pyramid_up';
  return 'averaging_down';
}

// ===== 유틸리티 함수 =====

export function getStageSL(currentStage: number, positionType?: PositionType): number {
  const type = positionType || getPositionType(currentStage);
  if (type === 'averaging_down') return STOP_LOSS_CONFIG.AVERAGING_DOWN_SL;
  return STOP_LOSS_CONFIG.PYRAMID_UP_SL;
}

export function getStageTPConfig(currentStage: number, positionType?: PositionType) {
  const type = positionType || getPositionType(currentStage);
  
  if (currentStage === 1) return TAKE_PROFIT_CONFIG.STAGE_1_ONLY;
  
  if (type === 'pyramid_up') {
    return {
      targets: currentStage === 2 
        ? TAKE_PROFIT_CONFIG.PYRAMID_UP.targets_stage2
        : TAKE_PROFIT_CONFIG.PYRAMID_UP.targets_stage3,
      maxHoldMinutes: TAKE_PROFIT_CONFIG.PYRAMID_UP.maxHoldMinutes,
    };
  }
  
  // 물타기
  return {
    targets: TAKE_PROFIT_CONFIG.AVERAGING_DOWN.useQuickExit
      ? TAKE_PROFIT_CONFIG.AVERAGING_DOWN.targets_quick
      : TAKE_PROFIT_CONFIG.AVERAGING_DOWN.targets_full_recovery,
    maxHoldMinutes: TAKE_PROFIT_CONFIG.AVERAGING_DOWN.maxHoldMinutes,
  };
}

export function getStageMaxHold(currentStage: number, positionType?: PositionType): number {
  const type = positionType || getPositionType(currentStage);
  
  if (currentStage === 1) return TAKE_PROFIT_CONFIG.STAGE_1_ONLY.maxHoldMinutes;
  if (type === 'pyramid_up') return TAKE_PROFIT_CONFIG.PYRAMID_UP.maxHoldMinutes;
  return TAKE_PROFIT_CONFIG.AVERAGING_DOWN.maxHoldMinutes;
}

export function getMaxLossPercent(currentStage: number, positionType?: PositionType): number {
  const type = positionType || getPositionType(currentStage);
  if (type === 'averaging_down') return EMERGENCY_CONFIG.MAX_LOSS_AVERAGING_DOWN;
  return EMERGENCY_CONFIG.MAX_LOSS_PYRAMID_UP;
}

export function getExposurePercent(stageCount: number): number {
  return stageCount * PYRAMID_CONFIG.STAGE_SIZE_PERCENT * PYRAMID_CONFIG.LEVERAGE;
}

// 물타기 후 평균단가 개선 효과 계산
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

// 물타기 필요 여부 판단
export function shouldAverageDown(
  currentStage: number,
  pnlPercent: number,
  positionType: PositionType
): { should: boolean; reason: string } {
  // 이미 물타기 중이면 다음 물타기 체크
  if (positionType === 'averaging_down') {
    if (currentStage >= 5) {
      return { should: false, reason: '물타기 최대 단계 도달' };
    }
    const condition = PYRAMID_CONFIG.AVERAGING_DOWN.conditions[currentStage + 1];
    if (!condition) {
      return { should: false, reason: '물타기 조건 없음' };
    }
    if (pnlPercent <= -condition.lossRequired) {
      return { should: true, reason: `${currentStage + 1}단계 물타기 조건 충족` };
    }
    return { should: false, reason: '물타기 조건 미충족' };
  }

  // 불타기 포지션에서 물타기로 전환 (Stage 4)
  if (positionType === 'initial' || positionType === 'pyramid_up') {
    const condition = PYRAMID_CONFIG.AVERAGING_DOWN.conditions[4];
    if (pnlPercent <= -condition.lossRequired) {
      return { should: true, reason: '물타기 전환 조건 충족' };
    }
  }

  return { should: false, reason: '' };
}

// 불타기 필요 여부 판단
export function shouldPyramidUp(
  currentStage: number,
  pnlPercent: number,
  positionType: PositionType
): { should: boolean; reason: string } {
  // 물타기 포지션에서는 불타기 불가
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
    return { should: true, reason: `${nextStage}단계 불타기 조건 충족` };
  }

  return { should: false, reason: '불타기 조건 미충족' };
}
