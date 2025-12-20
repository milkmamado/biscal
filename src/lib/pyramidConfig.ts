/**
 * ⚡ 하이브리드 피라미드 전략 설정 (10배 고정)
 * 불타기 (수익시) + 물타기 (손실시) 하이브리드 시스템
 * 
 * 🔧 v2.0 - 충돌 해결 버전
 * - 불타기 조건을 익절보다 낮게 설정
 * - 물타기 RSI 조건 완화
 * - 시간 윈도우 확장
 * - 연속 캔들 조건 완화
 */

// ===== 기본 설정 =====
export const PYRAMID_CONFIG = {
  // 기본
  LEVERAGE: 10,                    // 10배 고정
  TOTAL_STAGES: 5,                 // 5단계 분할 (불타기 3 + 물타기 2)
  STAGE_SIZE_PERCENT: 20,          // 각 단계 20%
  FEE_RATE: 0.05,                  // 0.05% per side (왕복 0.10%)

  // 진입 조건 (시그널 필터)
  MIN_SIGNALS: 2,                  // 최소 2개 조건 충족
  MIN_VOLUME_RATIO: 130,           // 거래량 평균 130% 이상
  MIN_ADX: 20,                     // ADX 20 이상

  // ===== 불타기 (수익시 추가 진입) Stage 2-3 =====
  // 🔧 수정: 익절 조건(+0.15%)보다 낮은 값으로 설정
  PYRAMID_UP: {
    enabled: true,
    maxStages: 3,                  // Stage 1 + 불타기 2단계 = 3단계
    conditions: {
      2: { profitRequired: 0.04 }, // 🔧 +0.04% 수익시 Stage 2 진입 (기존 0.08%)
      3: { profitRequired: 0.08 }, // 🔧 +0.08% 수익시 Stage 3 진입 (기존 0.12%)
    } as Record<number, { profitRequired: number }>,
    sizeMultiplier: 1.0,           // 동일 사이즈 (20%)
  },

  // ===== 물타기 (손실시 추가 진입) Stage 4-5 =====
  AVERAGING_DOWN: {
    enabled: true,
    maxStages: 2,                  // 물타기 최대 2단계
    conditions: {
      4: { lossRequired: 0.08 },   // 🔧 -0.08% 손실시 Stage 4 물타기 (기존 0.12%)
      5: { lossRequired: 0.14 },   // 🔧 -0.14% 손실시 Stage 5 물타기 (기존 0.18%)
    } as Record<number, { lossRequired: number }>,
    sizeMultiplier: 1.0,           // 동일 사이즈 (1.0x) - 보수적 접근
    
    // 🛡️ 안전 필터 (모두 충족시에만 물타기)
    // 🔧 수정: RSI 조건 완화
    safetyFilters: {
      requireRsiOversold: true,    // RSI 과매도 필수
      rsiThreshold: 40,            // 🔧 RSI 40 이하 (기존 30)
      blockOnAdxFalling: false,    // 🔧 ADX 필터 비활성화 (기존 true)
      blockOnOppositeCandles: 4,   // 🔧 반대 캔들 4개 연속시 차단 (기존 3)
      maxDailyAverageDown: 5,      // 🔧 일일 물타기 최대 5회 (기존 3)
    },
  },

  // 단계별 연속 캔들 조건 (불타기 전용)
  // 🔧 수정: 조건 완화
  STAGE_CANDLE_REQUIRED: {
    1: 0,                          // 1단계: 조건 없음
    2: 1,                          // 🔧 2단계: 1개 연속 (기존 2)
    3: 2,                          // 🔧 3단계: 2개 연속 (기존 3)
  } as Record<number, number>,

  // 단계별 시간 윈도우 (분)
  // 🔧 수정: 윈도우 확장
  STAGE_TIME_WINDOW: {
    2: [0.1, 8],                   // 🔧 불타기 2단계: 6초-8분 (기존 1-5분)
    3: [0.5, 12],                  // 🔧 불타기 3단계: 30초-12분 (기존 3-10분)
    4: [0.1, 10],                  // 🔧 물타기 4단계: 6초-10분 (기존 0.5-8분)
    5: [0.5, 15],                  // 🔧 물타기 5단계: 30초-15분 (기존 2-12분)
  } as Record<number, [number, number]>,
};

// ===== 익절 설정 =====
// 🔧 수정: 불타기 조건보다 높게 설정
export const TAKE_PROFIT_CONFIG = {
  // 1단계만 진입 시
  STAGE_1_ONLY: {
    targets: [
      { percent: 0.15, closeRatio: 0.50 },  // 🔧 +0.15%에서 50% 청산 (기존 0.12%)
      { percent: 0.30, closeRatio: 1.00 },  // 🔧 +0.30%에서 나머지 청산 (기존 0.25%)
    ],
    maxHoldMinutes: 8,                       // 🔧 8분 (기존 5분)
    breakEvenTrigger: 0.08,                  // 🔧 +0.08% 도달 시 BE 활성화 (기존 0.06%)
    breakEvenSL: 0.02,
  },

  // 불타기 포지션 (2-3단계)
  PYRAMID_UP: {
    targets_stage2: [
      { percent: 0.20, closeRatio: 0.50 },  // 🔧 2단계: +0.20%에서 50% 청산
      { percent: 0.35, closeRatio: 1.00 },  // 🔧 +0.35%에서 나머지 청산
    ],
    targets_stage3: [
      { percent: 0.18, closeRatio: 0.50 },  // 🔧 3단계: +0.18%에서 50% 청산
      { percent: 0.30, closeRatio: 1.00 },  // 🔧 +0.30%에서 나머지 청산
    ],
    maxHoldMinutes: 12,                      // 🔧 12분 (기존 10분)
    trailingStopGap: 0.10,                   // 🔧 트레일링 갭 (기존 0.12%)
  },

  // 물타기 포지션 (4-5단계)
  AVERAGING_DOWN: {
    targets_quick: [
      { percent: 0.08, closeRatio: 0.50 },  // 🔧 빠른 탈출: +0.08%에서 50%
      { percent: 0.15, closeRatio: 1.00 },  // 🔧 +0.15%에서 나머지
    ],
    targets_full_recovery: [
      { percent: 0.12, closeRatio: 0.50 },  // 🔧 회복: +0.12%에서 50%
      { percent: 0.25, closeRatio: 1.00 },  // 🔧 +0.25%에서 나머지
    ],
    maxHoldMinutes: 15,                      // 🔧 15분 (기존 12분)
    useQuickExit: true,                      // 빠른 탈출 모드 우선
  },

  // 시간 기반 강제 익절
  TIME_BASED: {
    within5min: [
      { profitPercent: 0.3, closeRatio: 0.30 },
      { profitPercent: 0.5, closeRatio: 0.50 },
    ],
    within10min: [
      { profitPercent: 0.6, closeRatio: 0.50 },
      { profitPercent: 1.0, closeRatio: 0.70 },
    ],
    over15min: {
      profitThreshold: 0.2,                  // 🔧 +0.2% 이상이면 전량 청산 (기존 0.3%)
      breakEvenCloseRatio: 0.80,             // 손익분기면 80% 청산
    },
  },
};

// ===== 손절 설정 =====
// 🔧 수정: 물타기 여유 공간 확보
export const STOP_LOSS_CONFIG = {
  // 불타기 포지션 손절 (Stage 1-3)
  PYRAMID_UP_SL: 0.25,             // 🔧 -0.25% (기존 0.20%) - 물타기 진입 여유

  // 물타기 포지션 손절 (Stage 4-5) - 더 넉넉한 공간
  AVERAGING_DOWN_SL: 0.40,         // 🔧 -0.40% (기존 0.35%)

  // 1단계 조기 손절
  STAGE_1_EARLY: {
    timeSeconds: 240,              // 🔧 4분 후 (기존 3분)
    lossThreshold: 0.10,           // 🔧 -0.10%면 청산 (기존 0.08%)
    closeRatio: 0.50,              // 50% 조기 청산
  },

  // 불타기 분할 손절
  PYRAMID_UP_PARTIAL: [
    { lossPercent: 0.15, closeRatio: 0.50, description: '50% 조기 청산' },
    { lossPercent: 0.25, closeRatio: 1.00, description: '전량 손절' },
  ],

  // 동적 손절 (높은 수익 도달 시)
  // 🔧 수정: 불타기 후에만 적용되도록 트리거 상향
  DYNAMIC_SL: [
    { profitTrigger: 0.25, newSL: 0.10 },   // 🔧 +0.25% 도달 시 SL → -0.10% (기존 0.20)
    { profitTrigger: 0.40, newSL: 0.02 },   // 🔧 +0.4% 도달 시 SL → -0.02% (본전 근처)
    { profitTrigger: 0.60, newSL: -0.10 },  // 🔧 +0.6% 도달 시 SL → +0.10% (수익 확보)
  ],
};

// ===== 긴급 탈출 설정 =====
export const EMERGENCY_CONFIG = {
  // 연속 반대 캔들
  OPPOSITE_CANDLES: {
    count: 4,                      // 🔧 4개 연속 반대 방향 (기존 3)
    closeRatio: 0.50,              // 50% 즉시 청산
  },

  // 총 손실 한계 (포지션 유형별)
  MAX_LOSS_PYRAMID_UP: 0.50,       // 🔧 불타기: -0.5% 손실 시 전량 청산 (기존 0.4%)
  MAX_LOSS_AVERAGING_DOWN: 0.70,   // 🔧 물타기: -0.7% 손실 시 전량 청산 (기존 0.6%)

  // 거래량 급감
  VOLUME_DROP: {
    threshold: 40,                 // 🔧 평균 대비 40% 미만 (기존 50%)
    closeRatio: 0.75,              // 75% 청산
  },

  // 상위 타임프레임 반전
  MTF_REVERSAL: {
    enabled: false,                // 🔧 비활성화 (기존 true) - 너무 자주 트리거됨
    closeRatio: 1.00,              // 전량 청산
  },
};

// ===== 리스크 관리 설정 =====
export const RISK_CONFIG = {
  // 일일 한도
  DAILY_MAX_TRADES: 15,            // 🔧 하루 최대 15회 (기존 10)
  DAILY_MAX_LOSS_PERCENT: 5.0,     // 🔧 일일 최대 손실 -5% (기존 3%)
  DAILY_TARGET_PROFIT_PERCENT: 8.0, // 🔧 목표 +8% (기존 5%)

  // 연속 손실
  MAX_CONSECUTIVE_LOSSES: 4,       // 🔧 연속 4패 시 중단 (기존 3)
  LOSS_COOLDOWN_MINUTES: 30,       // 🔧 30분 휴식 (기존 60분)

  // 올인 제한
  MAX_FULL_POSITION_DAILY: 5,      // 🔧 5단계 올인 하루 최대 5회 (기존 3)

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
