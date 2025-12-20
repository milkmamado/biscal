/**
 * ⚡ 1분봉 피라미드 전략 설정 (10배 고정)
 * 수익 기반 분할 진입 시스템
 */

// ===== 기본 설정 =====
export const PYRAMID_CONFIG = {
  // 기본
  LEVERAGE: 10,                    // 10배 고정
  TOTAL_STAGES: 5,                 // 5단계 분할
  STAGE_SIZE_PERCENT: 20,          // 각 단계 20%
  FEE_RATE: 0.05,                  // 0.05% per side

  // 진입 조건 (시그널 필터)
  MIN_SIGNALS: 2,                  // 최소 2개 조건 충족
  MIN_VOLUME_RATIO: 130,           // 거래량 평균 130% 이상
  MIN_ADX: 20,                     // ADX 20 이상

  // 단계별 추가 진입 조건 (수익률 %)
  STAGE_PROFIT_REQUIRED: {
    1: 0,                          // 1단계: 즉시 진입
    2: 0.08,                       // 2단계: +0.08% 수익 필요
    3: 0.15,                       // 3단계: +0.15% 수익 필요
    4: 0.25,                       // 4단계: +0.25% 수익 필요
    5: 0.40,                       // 5단계: +0.40% 수익 필요
  } as Record<number, number>,

  // 단계별 연속 캔들 조건
  STAGE_CANDLE_REQUIRED: {
    1: 0,                          // 1단계: 조건 없음
    2: 2,                          // 2단계: 2개 연속 같은 방향
    3: 3,                          // 3단계: 3개 연속
    4: 5,                          // 4단계: 5개 연속
    5: 7,                          // 5단계: 7개 연속
  } as Record<number, number>,

  // 단계별 진입 시간 윈도우 (분)
  STAGE_TIME_WINDOW: {
    1: [0, 0],                     // 1단계: 즉시
    2: [1, 2],                     // 2단계: 1-2분 후
    3: [3, 6],                     // 3단계: 3-6분 후
    4: [6, 12],                    // 4단계: 6-12분 후
    5: [12, 20],                   // 5단계: 12-20분 후
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

  // 2-3단계 진입 시
  STAGE_23: {
    targets: [
      { percent: 0.30, closeRatio: 0.30 },
      { percent: 0.60, closeRatio: 0.50 },
      { percent: 1.00, closeRatio: 1.00 },
    ],
    maxHoldMinutes: 10,
    trailingStopGap: 0.15,
  },

  // 4-5단계 올인 시
  STAGE_45: {
    targets: [
      { percent: 0.80, closeRatio: 0.25 },
      { percent: 1.50, closeRatio: 0.35 },
      { percent: 2.50, closeRatio: 0.25 },
      { percent: 4.00, closeRatio: 1.00 },  // 러너
    ],
    maxHoldMinutes: 15,
    trailingStopGap: 0.25,
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
  // 단계별 손절
  STAGE_SL: {
    1: 0.15,                       // 1단계: -0.15%
    23: 0.18,                      // 2-3단계: -0.18%
    45: 0.25,                      // 4-5단계: -0.25%
  },

  // 1단계 조기 손절
  STAGE_1_EARLY: {
    timeSeconds: 180,              // 3분 후
    lossThreshold: 0.08,           // -0.08%면 청산
    closeRatio: 0.50,              // 50% 조기 청산
  },

  // 2-3단계 분할 손절
  STAGE_23_PARTIAL: [
    { lossPercent: 0.10, closeRatio: 0.75, stage: 1 },  // -0.1%: 1단계 75% 청산
    { lossPercent: 0.15, closeRatio: 0.50, stage: 2 },  // -0.15%: 2단계 50% 청산
  ],

  // 4-5단계 동적 손절
  STAGE_45_DYNAMIC: [
    { profitTrigger: 0.30, newSL: 0.10 },   // +0.3% 도달 시 SL → -0.10%
    { profitTrigger: 0.60, newSL: 0.00 },   // +0.6% 도달 시 SL → 0% (본전)
    { profitTrigger: 1.00, newSL: -0.30 },  // +1.0% 도달 시 SL → +0.30%
  ],

  // 2-3단계 시간 기반 손절
  STAGE_23_TIME: {
    timeSeconds: 480,              // 8분 후
    breakEvenCheck: true,          // 손익분기 미달 시
    closeRatio: 0.75,              // 75% 청산
  },
};

// ===== 긴급 탈출 설정 =====
export const EMERGENCY_CONFIG = {
  // 연속 반대 캔들
  OPPOSITE_CANDLES: {
    count: 3,                      // 3개 연속 반대 방향
    closeRatio: 0.50,              // 50% 즉시 청산
  },

  // 총 손실 한계
  MAX_LOSS_PERCENT: 0.80,          // -0.8% 손실 시 전량 청산

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
  DAILY_MAX_TRADES: 8,             // 하루 최대 8회
  DAILY_MAX_LOSS_PERCENT: 3.0,     // 일일 최대 손실 -3%
  DAILY_TARGET_PROFIT_PERCENT: 5.0, // 목표 달성 시 중단 고려

  // 연속 손실
  MAX_CONSECUTIVE_LOSSES: 3,       // 연속 3패 시 중단
  LOSS_COOLDOWN_MINUTES: 60,       // 60분 휴식

  // 올인 제한
  MAX_FULL_POSITION_DAILY: 2,      // 5단계 올인 하루 최대 2회

  // 포지션 노출 한도
  MAX_EXPOSURE_PERCENT: 1000,      // 절대 한계 (100% × 10배)
  SAFE_EXPOSURE_PERCENT: 600,      // 안전 권장 (60% × 10배)
  COMFORT_EXPOSURE_PERCENT: 400,   // 편안한 구간 (40% × 10배)
};

// ===== 유틸리티 함수 =====

export function getStageSL(currentStage: number): number {
  if (currentStage === 1) return STOP_LOSS_CONFIG.STAGE_SL[1];
  if (currentStage <= 3) return STOP_LOSS_CONFIG.STAGE_SL[23];
  return STOP_LOSS_CONFIG.STAGE_SL[45];
}

export function getStageTPConfig(currentStage: number) {
  if (currentStage === 1) return TAKE_PROFIT_CONFIG.STAGE_1_ONLY;
  if (currentStage <= 3) return TAKE_PROFIT_CONFIG.STAGE_23;
  return TAKE_PROFIT_CONFIG.STAGE_45;
}

export function getStageMaxHold(currentStage: number): number {
  if (currentStage === 1) return TAKE_PROFIT_CONFIG.STAGE_1_ONLY.maxHoldMinutes;
  if (currentStage <= 3) return TAKE_PROFIT_CONFIG.STAGE_23.maxHoldMinutes;
  return TAKE_PROFIT_CONFIG.STAGE_45.maxHoldMinutes;
}

export function getExposurePercent(stageCount: number): number {
  return stageCount * PYRAMID_CONFIG.STAGE_SIZE_PERCENT * PYRAMID_CONFIG.LEVERAGE;
}
