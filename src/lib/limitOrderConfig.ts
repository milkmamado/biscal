/**
 * ⚡ 분할 매매 설정 v3.0
 * 
 * 🎯 설계 원칙:
 * 1. 자동매매: 시그널 스캔 전용 (종목 탐지)
 * 2. 수동 진입: 분할 시장가 / 분할 지정가
 * 3. 레버리지 1x/5x/10x, 분할 1/5/10 선택 가능
 * 4. 바이낸스 SL/TP 주문 연동
 */

// ===== 기본 설정 =====
export const LIMIT_ORDER_CONFIG = {
  // 기본
  LEVERAGE: 10,                    // 기본 레버리지 (UI에서 1/5/10 선택 가능)
  POSITION_SIZE_PERCENT: 95,       // 잔고의 95% 사용

  // 수수료 (바이낸스)
  MAKER_FEE: 0.02,                 // 지정가 0.02%
  TAKER_FEE: 0.05,                 // 시장가 0.05%
  
  // ===== 손절 설정 =====
  STOP_LOSS: {
    TIME_STOP_MINUTES: 5,          // 5분 타임스탑
  },
  
  // ===== 진입 조건 (시그널 필터) =====
  SIGNAL: {
    MIN_SIGNALS: 2,                // 최소 2개 조건 충족
    MIN_VOLUME_RATIO: 80,          // 거래량 평균 80% 이상
    MIN_ADX: 20,                   // ADX 20 이상
  },
};

// ===== 타입 정의 =====
export interface LimitOrderEntry {
  orderId: string;
  price: number;
  quantity: number;
  filled: number;
  status: 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED';
  timestamp: number;
}

export interface LimitOrderPosition {
  symbol: string;
  side: 'long' | 'short';
  entries: LimitOrderEntry[];
  avgPrice: number;
  totalQuantity: number;
  filledQuantity: number;
  startTime: number;
  entryPhase: 'ordering' | 'waiting' | 'active' | 'closing';
  takeProfitOrders: LimitOrderEntry[];
  stopLossPrice: number;
  unrealizedPnl?: number;  // 바이낸스 API에서 가져온 실제 미실현 손익 (USD)
  markPrice?: number;      // 바이낸스 마크가격
}

// ===== 유틸리티 함수 =====

/**
 * 타임스탑 조건 충족 여부
 */
export function shouldTimeStop(startTime: number): boolean {
  const holdTimeMin = (Date.now() - startTime) / 60000;
  return holdTimeMin >= LIMIT_ORDER_CONFIG.STOP_LOSS.TIME_STOP_MINUTES;
}
