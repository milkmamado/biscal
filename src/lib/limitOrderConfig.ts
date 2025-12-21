/**
 * ⚡ 지정가 기반 빠른 회전 전략 v1.0
 * 
 * 🎯 설계 원칙:
 * 1. 지정가 10분할 진입 (수수료 0.02% vs 시장가 0.05%)
 * 2. 10초 타임아웃 필터 (변동성 없는 종목 배제)
 * 3. 5분할 지정가 익절 (빠른 수익 확정)
 * 4. 3초 내 미체결 시 시장가 청산
 * 5. 간결하고 빠른 회전
 */

// ===== 기본 설정 =====
export const LIMIT_ORDER_CONFIG = {
  // 기본
  LEVERAGE: 10,                    // 10배 고정
  POSITION_SIZE_PERCENT: 100,      // 전체 잔고 사용
  
  // 수수료 (바이낸스)
  MAKER_FEE: 0.02,                 // 지정가 0.02%
  TAKER_FEE: 0.05,                 // 시장가 0.05%
  
  // ===== 진입 설정 =====
  ENTRY: {
    SPLIT_COUNT: 10,               // 10분할 지정가
    PRICE_OFFSET_PERCENT: 0.03,    // 현재가 대비 ±0.03% 범위
    TIMEOUT_SEC: 10,               // 10초 내 미체결 시 취소
    PARTIAL_WAIT_SEC: 5,           // 일부 체결 후 5초 대기
    MIN_FILL_RATIO: 0.1,           // 최소 10% 이상 체결되어야 유효
    LOW_FILL_THRESHOLD: 0.3,       // 30% 미만 체결 시 저체결 처리
    BREAKEVEN_FEE_BUFFER: 0.1,     // 손익분기 청산 시 수수료 버퍼 (%)
  },
  
  // ===== 익절 설정 =====
  TAKE_PROFIT: {
    SPLIT_COUNT: 5,                // 5분할 지정가 익절
    MIN_PROFIT_KRW: 10000,         // 최소 익절금액 1만원
    PROFIT_STEP_KRW: 5000,         // 5천원 간격으로 분할
    CLOSE_TIMEOUT_SEC: 3,          // 익절 체결 후 3초 내 잔량 미체결 시 시장가
    TRAILING_ENABLED: false,       // 트레일링 비활성화 (빠른 회전)
  },
  
  // ===== 손절 설정 =====
  STOP_LOSS: {
    PERCENT: 0.15,                 // -0.15% 손절 (수수료 포함 실질 -0.22%)
    TIME_STOP_MINUTES: 5,          // 5분 타임스탑
  },
  
  // ===== 진입 조건 (시그널 필터) =====
  SIGNAL: {
    MIN_SIGNALS: 2,                // 최소 2개 조건 충족
    MIN_VOLUME_RATIO: 80,          // 거래량 평균 80% 이상
    MIN_ADX: 20,                   // ADX 20 이상
  },
  
  // ===== 리스크 관리 =====
  RISK: {
    DAILY_MAX_TRADES: 50,          // 빠른 회전으로 거래 횟수 증가
    DAILY_MAX_LOSS_PERCENT: 3.0,   // 일일 최대 손실 -3%
    MAX_CONSECUTIVE_LOSSES: 5,     // 연속 5패 시 휴식
    LOSS_COOLDOWN_MINUTES: 15,     // 15분 휴식
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
}

// ===== 유틸리티 함수 =====

/**
 * 10분할 지정가 가격 배열 생성
 * 롱: 현재가 아래로 / 숏: 현재가 위로
 */
export function generateEntryPrices(
  currentPrice: number,
  side: 'long' | 'short',
  tickSize: number
): number[] {
  const prices: number[] = [];
  const offsetPercent = LIMIT_ORDER_CONFIG.ENTRY.PRICE_OFFSET_PERCENT / 100;
  const totalOffset = currentPrice * offsetPercent;
  const stepSize = totalOffset / LIMIT_ORDER_CONFIG.ENTRY.SPLIT_COUNT;
  
  for (let i = 0; i < LIMIT_ORDER_CONFIG.ENTRY.SPLIT_COUNT; i++) {
    let price: number;
    if (side === 'long') {
      // 롱: 현재가 아래로 분할
      price = currentPrice - (stepSize * (i + 1));
    } else {
      // 숏: 현재가 위로 분할
      price = currentPrice + (stepSize * (i + 1));
    }
    
    // 틱 사이즈에 맞게 반올림
    price = Math.round(price / tickSize) * tickSize;
    prices.push(price);
  }
  
  return prices;
}

/**
 * 5분할 익절 가격 배열 생성
 */
export function generateTakeProfitPrices(
  avgPrice: number,
  totalQuantity: number,
  side: 'long' | 'short',
  tickSize: number,
  krwRate: number,
  balanceKRW: number
): { price: number; quantity: number }[] {
  const targets: { price: number; quantity: number }[] = [];
  const config = LIMIT_ORDER_CONFIG.TAKE_PROFIT;
  
  // 수수료 반영 (지정가 익절 = maker 0.02% × 2 = 0.04%)
  const roundTripFeePercent = LIMIT_ORDER_CONFIG.MAKER_FEE * 2 / 100;
  
  // 1만원 익절을 위한 필요 수익률
  const minProfitPercent = (config.MIN_PROFIT_KRW / balanceKRW) + roundTripFeePercent;
  
  const splitQty = totalQuantity / config.SPLIT_COUNT;
  
  for (let i = 0; i < config.SPLIT_COUNT; i++) {
    // 각 분할별 목표 수익률 (1만원, 1.5만원, 2만원, 2.5만원, 3만원)
    const targetProfitKRW = config.MIN_PROFIT_KRW + (config.PROFIT_STEP_KRW * i);
    const targetProfitPercent = (targetProfitKRW / balanceKRW) + roundTripFeePercent;
    
    let price: number;
    if (side === 'long') {
      price = avgPrice * (1 + targetProfitPercent);
    } else {
      price = avgPrice * (1 - targetProfitPercent);
    }
    
    // 틱 사이즈에 맞게 반올림
    price = Math.round(price / tickSize) * tickSize;
    
    targets.push({
      price,
      quantity: splitQty,
    });
  }
  
  return targets;
}

/**
 * 체결률 계산
 */
export function calculateFillRatio(entries: LimitOrderEntry[]): number {
  const totalQty = entries.reduce((sum, e) => sum + e.quantity, 0);
  const filledQty = entries.reduce((sum, e) => sum + e.filled, 0);
  return totalQty > 0 ? filledQty / totalQty : 0;
}

/**
 * 평균 체결가 계산
 */
export function calculateAvgFillPrice(entries: LimitOrderEntry[]): number {
  const filledEntries = entries.filter(e => e.filled > 0);
  if (filledEntries.length === 0) return 0;
  
  const totalValue = filledEntries.reduce((sum, e) => sum + (e.price * e.filled), 0);
  const totalQty = filledEntries.reduce((sum, e) => sum + e.filled, 0);
  
  return totalQty > 0 ? totalValue / totalQty : 0;
}

/**
 * 손익률 계산 (수수료 반영)
 */
export function calculatePnLPercent(
  avgPrice: number,
  currentPrice: number,
  side: 'long' | 'short',
  isMakerExit: boolean = false
): number {
  const direction = side === 'long' ? 1 : -1;
  const priceDiff = (currentPrice - avgPrice) * direction;
  const pnlPercentRaw = (priceDiff / avgPrice) * 100;
  
  // 수수료: 진입(maker) + 청산(maker or taker)
  const entryFee = LIMIT_ORDER_CONFIG.MAKER_FEE;
  const exitFee = isMakerExit ? LIMIT_ORDER_CONFIG.MAKER_FEE : LIMIT_ORDER_CONFIG.TAKER_FEE;
  const totalFee = entryFee + exitFee;
  
  return pnlPercentRaw - totalFee;
}

/**
 * 손절가 계산
 */
export function calculateStopLossPrice(
  avgPrice: number,
  side: 'long' | 'short'
): number {
  const slPercent = LIMIT_ORDER_CONFIG.STOP_LOSS.PERCENT / 100;
  
  if (side === 'long') {
    return avgPrice * (1 - slPercent);
  } else {
    return avgPrice * (1 + slPercent);
  }
}

/**
 * 익절 조건 충족 여부
 */
export function shouldTakeProfit(
  pnlKRW: number
): boolean {
  return pnlKRW >= LIMIT_ORDER_CONFIG.TAKE_PROFIT.MIN_PROFIT_KRW;
}

/**
 * 손절 조건 충족 여부
 */
export function shouldStopLoss(
  currentPrice: number,
  stopLossPrice: number,
  side: 'long' | 'short'
): boolean {
  if (side === 'long') {
    return currentPrice <= stopLossPrice;
  } else {
    return currentPrice >= stopLossPrice;
  }
}

/**
 * 타임스탑 조건 충족 여부
 */
export function shouldTimeStop(startTime: number): boolean {
  const holdTimeMin = (Date.now() - startTime) / 60000;
  return holdTimeMin >= LIMIT_ORDER_CONFIG.STOP_LOSS.TIME_STOP_MINUTES;
}
