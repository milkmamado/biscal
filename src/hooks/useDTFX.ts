/**
 * DTFX 매매법 훅
 * - Swing High/Low 자동 감지
 * - BOS (Break of Structure) / CHoCH (Change of Character) 감지
 * - 피보나치 되돌림 존 자동 생성
 * - Supply/Demand Zone 관리
 */

export interface SwingPoint {
  type: 'high' | 'low';
  index: number;
  price: number;
  time: number;
}

export interface StructureShift {
  id: string;
  type: 'bullish_bos' | 'bearish_bos' | 'bullish_choch' | 'bearish_choch';
  from: SwingPoint;
  to: SwingPoint;
  timestamp: number;
}

export interface FibonacciLevel {
  value: number;
  price: number;
  label: string;
}

export interface DTFXZone {
  id: string;
  type: 'demand' | 'supply';
  from: SwingPoint;
  to: SwingPoint;
  levels: FibonacciLevel[];
  created: number;
  active: boolean;
  topPrice: number;
  bottomPrice: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// 피보나치 레벨 설정 (OTE Zone: 61.8% ~ 70.5%, Sweet Spot: 70.5%)
const FIB_LEVELS = [
  { value: 0.618, label: '61.8%' },
  { value: 0.705, label: '70.5%' },  // Sweet Spot
  { value: 0.786, label: '78.6%' },
];

// OTE 구간 범위 (진입용)
export const OTE_ZONE = {
  start: 0.618,
  end: 0.705,
  sweetSpot: 0.705,
};

// Structure Length (LuxAlgo 기본값: 10)
export const DTFX_STRUCTURE_LENGTH = 10;

/**
 * Swing High/Low 포인트 감지
 * @param candles 캔들 배열
 * @param lookback 좌우로 확인할 캔들 수 (기본: 5)
 */
export function detectSwingPoints(candles: Candle[], lookback: number = DTFX_STRUCTURE_LENGTH): SwingPoint[] {
  const swings: SwingPoint[] = [];
  
  if (candles.length < lookback * 2 + 1) return swings;
  
  for (let i = lookback; i < candles.length - lookback; i++) {
    const current = candles[i];
    let isSwingHigh = true;
    let isSwingLow = true;
    
    // 좌우 캔들과 비교
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      
      if (candles[j].high >= current.high) {
        isSwingHigh = false;
      }
      if (candles[j].low <= current.low) {
        isSwingLow = false;
      }
    }
    
    if (isSwingHigh) {
      swings.push({
        type: 'high',
        index: i,
        price: current.high,
        time: current.time,
      });
    }
    
    if (isSwingLow) {
      swings.push({
        type: 'low',
        index: i,
        price: current.low,
        time: current.time,
      });
    }
  }
  
  return swings.sort((a, b) => a.index - b.index);
}

/**
 * BOS/CHoCH 구조 변화 감지
 * @param swings Swing 포인트 배열
 * @param candles 캔들 배열
 */
export function detectStructureShifts(swings: SwingPoint[], candles: Candle[]): StructureShift[] {
  const shifts: StructureShift[] = [];
  
  if (swings.length < 3) return shifts;
  
  // 최근 스윙들 분석 (최대 10개)
  const recentSwings = swings.slice(-10);
  
  // 이전 추세 방향 추적
  let prevTrend: 'up' | 'down' | 'neutral' = 'neutral';
  let lastHigh: SwingPoint | null = null;
  let lastLow: SwingPoint | null = null;
  
  for (let i = 0; i < recentSwings.length; i++) {
    const swing = recentSwings[i];
    
    if (swing.type === 'high') {
      if (lastHigh) {
        // 이전 고점보다 높은 고점 = Higher High
        if (swing.price > lastHigh.price) {
          if (prevTrend === 'down') {
            // 하락 추세에서 Higher High = CHoCH (상승 전환)
            shifts.push({
              id: `choch_bull_${swing.time}`,
              type: 'bullish_choch',
              from: lastHigh,
              to: swing,
              timestamp: swing.time,
            });
          }
          prevTrend = 'up';
        }
        // 이전 고점보다 낮은 고점 = Lower High
        else if (swing.price < lastHigh.price && prevTrend === 'up') {
          // 상승 추세에서 Lower High = 약화 신호
        }
      }
      lastHigh = swing;
    } else {
      if (lastLow) {
        // 이전 저점보다 낮은 저점 = Lower Low
        if (swing.price < lastLow.price) {
          if (prevTrend === 'up') {
            // 상승 추세에서 Lower Low = CHoCH (하락 전환)
            shifts.push({
              id: `choch_bear_${swing.time}`,
              type: 'bearish_choch',
              from: lastLow,
              to: swing,
              timestamp: swing.time,
            });
          }
          prevTrend = 'down';
        }
        // 이전 저점보다 높은 저점 = Higher Low
        else if (swing.price > lastLow.price && prevTrend === 'down') {
          // 하락 추세에서 Higher Low = 약화 신호
        }
      }
      lastLow = swing;
    }
  }
  
  // BOS 감지: 최근 가격이 이전 구조를 돌파했는지 확인
  if (candles.length > 0 && recentSwings.length >= 2) {
    const currentPrice = candles[candles.length - 1].close;
    
    // 최근 스윙 하이 돌파 = Bullish BOS
    const recentHighs = recentSwings.filter(s => s.type === 'high').slice(-2);
    if (recentHighs.length >= 1) {
      const lastSwingHigh = recentHighs[recentHighs.length - 1];
      if (currentPrice > lastSwingHigh.price) {
        const bosExists = shifts.some(s => 
          s.type === 'bullish_bos' && 
          Math.abs(s.timestamp - lastSwingHigh.time) < 60000
        );
        if (!bosExists) {
          shifts.push({
            id: `bos_bull_${Date.now()}`,
            type: 'bullish_bos',
            from: lastSwingHigh,
            to: {
              type: 'high',
              index: candles.length - 1,
              price: currentPrice,
              time: candles[candles.length - 1].time,
            },
            timestamp: candles[candles.length - 1].time,
          });
        }
      }
    }
    
    // 최근 스윙 로우 돌파 = Bearish BOS
    const recentLows = recentSwings.filter(s => s.type === 'low').slice(-2);
    if (recentLows.length >= 1) {
      const lastSwingLow = recentLows[recentLows.length - 1];
      if (currentPrice < lastSwingLow.price) {
        const bosExists = shifts.some(s => 
          s.type === 'bearish_bos' && 
          Math.abs(s.timestamp - lastSwingLow.time) < 60000
        );
        if (!bosExists) {
          shifts.push({
            id: `bos_bear_${Date.now()}`,
            type: 'bearish_bos',
            from: lastSwingLow,
            to: {
              type: 'low',
              index: candles.length - 1,
              price: currentPrice,
              time: candles[candles.length - 1].time,
            },
            timestamp: candles[candles.length - 1].time,
          });
        }
      }
    }
  }
  
  return shifts;
}

/**
 * 피보나치 되돌림 존 생성
 * @param shift 구조 변화 정보
 */
export function createFibonacciZone(shift: StructureShift): DTFXZone {
  const isBullish = shift.type.includes('bullish');
  const range = Math.abs(shift.to.price - shift.from.price);
  
  // 피보나치 레벨 계산
  const levels: FibonacciLevel[] = FIB_LEVELS.map(level => {
    const price = isBullish
      ? shift.to.price - (range * level.value)  // 상승 후 되돌림
      : shift.to.price + (range * level.value); // 하락 후 되돌림
      
    return {
      value: level.value,
      price,
      label: level.label,
    };
  });
  
  const topPrice = Math.max(shift.from.price, shift.to.price);
  const bottomPrice = Math.min(shift.from.price, shift.to.price);
  
  return {
    id: `zone_${shift.id}`,
    type: isBullish ? 'demand' : 'supply',
    from: shift.from,
    to: shift.to,
    levels,
    created: shift.timestamp,
    active: true,
    topPrice,
    bottomPrice,
  };
}

/**
 * DTFX 분석 실행
 * @param candles 캔들 배열
 * @param lookback 스윙 포인트 감지 lookback (기본: 5)
 */
export function analyzeDTFX(candles: Candle[], lookback: number = DTFX_STRUCTURE_LENGTH): {
  swingPoints: SwingPoint[];
  structureShifts: StructureShift[];
  zones: DTFXZone[];
} {
  if (candles.length < lookback * 2 + 1) {
    return { swingPoints: [], structureShifts: [], zones: [] };
  }
  
  // 1. Swing 포인트 감지
  const swingPoints = detectSwingPoints(candles, lookback);
  
  // 2. 구조 변화 감지
  const structureShifts = detectStructureShifts(swingPoints, candles);
  
  // 3. 피보나치 존 생성 (최근 3개만)
  const recentShifts = structureShifts.slice(-3);
  const zones = recentShifts.map(shift => createFibonacciZone(shift));
  
  // 4. 존 무효화 체크 (가격이 존을 완전히 이탈하면 비활성화)
  const currentPrice = candles[candles.length - 1]?.close || 0;
  zones.forEach(zone => {
    if (zone.type === 'demand') {
      // Demand 존: 가격이 존 아래로 내려가면 무효화
      if (currentPrice < zone.bottomPrice * 0.995) {
        zone.active = false;
      }
    } else {
      // Supply 존: 가격이 존 위로 올라가면 무효화
      if (currentPrice > zone.topPrice * 1.005) {
        zone.active = false;
      }
    }
  });
  
  return {
    swingPoints,
    structureShifts,
    zones: zones.filter(z => z.active), // 활성 존만 반환
  };
}

/**
 * DTFX 진입 시그널 체크
 * @param currentPrice 현재 가격
 * @param zones 활성 DTFX 존 배열
 */
export function checkDTFXEntrySignal(
  currentPrice: number, 
  zones: DTFXZone[]
): { direction: 'long' | 'short' | null; zone: DTFXZone | null; fibLevel: FibonacciLevel | null } {
  for (const zone of zones) {
    if (!zone.active) continue;
    
    for (const level of zone.levels) {
      const tolerance = Math.abs(level.price) * 0.002; // 0.2% 허용 오차
      
      if (Math.abs(currentPrice - level.price) <= tolerance) {
        if (zone.type === 'demand') {
          return { direction: 'long', zone, fibLevel: level };
        } else {
          return { direction: 'short', zone, fibLevel: level };
        }
      }
    }
  }
  
  return { direction: null, zone: null, fibLevel: null };
}

/**
 * DTFX OTE 구간 진입 시그널 체크 (61.8% ~ 70.5%)
 * @param currentPrice 현재 가격
 * @param zones 활성 DTFX 존 배열
 */
export function checkDTFXOTEEntry(
  currentPrice: number, 
  zones: DTFXZone[]
): { direction: 'long' | 'short' | null; zone: DTFXZone | null; entryRatio: number | null } {
  for (const zone of zones) {
    if (!zone.active) continue;
    
    // OTE 구간 가격 계산
    const range = Math.abs(zone.to.price - zone.from.price);
    const isBullish = zone.type === 'demand';
    
    // 61.8% ~ 70.5% 레벨 가격 계산
    const oteStartPrice = isBullish
      ? zone.to.price - (range * OTE_ZONE.start)
      : zone.to.price + (range * OTE_ZONE.start);
    const oteEndPrice = isBullish
      ? zone.to.price - (range * OTE_ZONE.end)
      : zone.to.price + (range * OTE_ZONE.end);
    
    // OTE 구간 범위 내에 있는지 확인
    const minOte = Math.min(oteStartPrice, oteEndPrice);
    const maxOte = Math.max(oteStartPrice, oteEndPrice);
    
    if (currentPrice >= minOte && currentPrice <= maxOte) {
      // 현재 가격이 구간 내 몇 %인지 계산
      const entryRatio = isBullish
        ? (zone.to.price - currentPrice) / range
        : (currentPrice - zone.to.price) / range;
      
      return {
        direction: isBullish ? 'long' : 'short',
        zone,
        entryRatio,
      };
    }
  }
  
  return { direction: null, zone: null, entryRatio: null };
}
