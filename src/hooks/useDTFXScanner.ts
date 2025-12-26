/**
 * DTFX 자동 스캔 훅
 * - 핫코인 리스트에서 1분봉 DTFX 존 스캔
 * - OTE 구간(61.8%~70.5%)에 가장 가까운 코인 자동 선택
 * - 존 사라지면 다른 코인 자동 탐색
 * - 1분 타임아웃: OTE 반응 없으면 다음 종목
 * - 존 소멸 감지 시 즉시 다음 스캔
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { analyzeDTFX, DTFXZone, Candle, OTE_ZONE, DTFX_STRUCTURE_LENGTH } from './useDTFX';
import { addScreeningLog } from '@/components/ScreeningLogPanel';

// 타임아웃 설정 (ms)
const OTE_TIMEOUT_MS = 60000; // 1분

// 1분봉 조회 함수
const fetch1mKlines = async (symbol: string, limit: number = 100): Promise<Candle[] | null> => {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=${limit}`);
    const data = await res.json();
    return data.map((k: any) => ({
      time: parseInt(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch { return null; }
};

// 스캔 결과 타입
export interface DTFXScanResult {
  symbol: string;
  zones: DTFXZone[];
  oteDistance: number; // OTE 구간까지의 거리 (%)
  oteDirection: 'long' | 'short' | null;
  currentPrice: number;
  inOTE: boolean; // 현재 OTE 구간 내에 있는지
  entryRatio: number | null; // OTE 구간 내 진입 비율
}

interface UseDTFXScannerProps {
  hotCoins: string[]; // 핫코인 심볼 리스트
  enabled: boolean;
  onSymbolChange: (symbol: string) => void;
  currentSymbol: string;
  hasPosition: boolean; // 현재 포지션 보유 여부
  onZoneLostDuringPosition?: () => void; // 🆕 포지션 중 존 소멸 시 콜백
}

export function useDTFXScanner({
  hotCoins,
  enabled,
  onSymbolChange,
  currentSymbol,
  hasPosition,
  onZoneLostDuringPosition,
}: UseDTFXScannerProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<DTFXScanResult[]>([]);
  const [bestCandidate, setBestCandidate] = useState<DTFXScanResult | null>(null);
  const [lastScanTime, setLastScanTime] = useState(0);
  const [statusMessage, setStatusMessage] = useState('대기 중');

  const isMountedRef = useRef(true);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const zoneCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isScanningRef = useRef(false);
  const enabledRef = useRef(enabled);
  const hasPositionRef = useRef(hasPosition);
  const currentSymbolRef = useRef(currentSymbol);
  const hotCoinsRef = useRef(hotCoins);

  // 현재 종목 선택 시점 (타임아웃 체크용)
  const symbolSelectedTimeRef = useRef<number>(0);
  // 마지막으로 존이 확인된 시점
  const lastZoneConfirmedTimeRef = useRef<number>(0);
  // 현재 종목의 존 상태
  const currentSymbolHasZoneRef = useRef<boolean>(false);
  // 🆕 포지션 중 존 소멸 콜백 ref
  const onZoneLostDuringPositionRef = useRef(onZoneLostDuringPosition);
  
  useEffect(() => {
    onZoneLostDuringPositionRef.current = onZoneLostDuringPosition;
  }, [onZoneLostDuringPosition]);

  // Refs 업데이트
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    hasPositionRef.current = hasPosition;
  }, [hasPosition]);

  useEffect(() => {
    currentSymbolRef.current = currentSymbol;
  }, [currentSymbol]);

  useEffect(() => {
    hotCoinsRef.current = hotCoins;
  }, [hotCoins]);

  // OTE 구간까지의 거리 계산 (%)
  const calculateOTEDistance = useCallback((
    currentPrice: number,
    zones: DTFXZone[]
  ): { distance: number; direction: 'long' | 'short' | null; inOTE: boolean; entryRatio: number | null } => {
    if (zones.length === 0) {
      return { distance: Infinity, direction: null, inOTE: false, entryRatio: null };
    }

    let minDistance = Infinity;
    let bestDirection: 'long' | 'short' | null = null;
    let isInOTE = false;
    let bestEntryRatio: number | null = null;

    for (const zone of zones) {
      if (!zone.active) continue;

      const range = Math.abs(zone.to.price - zone.from.price);
      const isBullish = zone.type === 'demand';

      // OTE 구간 가격 계산 (61.8% ~ 70.5%)
      const ote618Price = isBullish
        ? zone.to.price - (range * OTE_ZONE.start)
        : zone.to.price + (range * OTE_ZONE.start);
      const ote705Price = isBullish
        ? zone.to.price - (range * OTE_ZONE.end)
        : zone.to.price + (range * OTE_ZONE.end);

      const minOte = Math.min(ote618Price, ote705Price);
      const maxOte = Math.max(ote618Price, ote705Price);

      // 현재가가 OTE 구간 내에 있는지 확인
      if (currentPrice >= minOte && currentPrice <= maxOte) {
        const entryRatio = isBullish
          ? (zone.to.price - currentPrice) / range
          : (currentPrice - zone.to.price) / range;

        return {
          distance: 0,
          direction: isBullish ? 'long' : 'short',
          inOTE: true,
          entryRatio,
        };
      }

      // OTE 구간까지의 거리 계산
      let distance: number;
      if (isBullish) {
        // 롱: 가격이 OTE 위에 있으면 내려와야 함
        if (currentPrice > maxOte) {
          distance = ((currentPrice - maxOte) / currentPrice) * 100;
        } else {
          // 가격이 OTE 아래로 갔으면 무효
          distance = Infinity;
        }
      } else {
        // 숏: 가격이 OTE 아래에 있으면 올라와야 함
        if (currentPrice < minOte) {
          distance = ((minOte - currentPrice) / currentPrice) * 100;
        } else {
          // 가격이 OTE 위로 갔으면 무효
          distance = Infinity;
        }
      }

      if (distance < minDistance) {
        minDistance = distance;
        bestDirection = isBullish ? 'long' : 'short';
      }
    }

    return { distance: minDistance, direction: bestDirection, inOTE: isInOTE, entryRatio: bestEntryRatio };
  }, []);

  // 현재 종목의 존 상태 체크 (존 소멸 감지용)
  const checkCurrentSymbolZone = useCallback(async (): Promise<boolean> => {
    const symbol = currentSymbolRef.current;
    if (!symbol) return true;

    try {
      const klines = await fetch1mKlines(symbol, 200);
      if (!klines || klines.length < 30) return false;

      const { zones } = analyzeDTFX(klines, DTFX_STRUCTURE_LENGTH);
      const activeZones = zones.filter(z => z.active);
      
      if (activeZones.length > 0) {
        lastZoneConfirmedTimeRef.current = Date.now();
        currentSymbolHasZoneRef.current = true;
        return true;
      } else {
        currentSymbolHasZoneRef.current = false;
        return false;
      }
    } catch {
      return false;
    }
  }, []);

  // 🆕 포지션 보유 중 존 소멸 감지 (3초마다)
  useEffect(() => {
    if (!enabled || !hasPosition) return;
    
    const checkZoneDuringPosition = async () => {
      if (!enabledRef.current || !hasPositionRef.current) return;
      
      const hasZone = await checkCurrentSymbolZone();
      
      if (!hasZone) {
        const symbol = currentSymbolRef.current;
        console.log(`🚨 [DTFX] 포지션 중 존 소멸 감지! ${symbol} → 청산 트리거`);
        addScreeningLog('reject', `포지션 중 존 소멸 → 청산`, symbol);
        
        // 청산 콜백 호출
        if (onZoneLostDuringPositionRef.current) {
          onZoneLostDuringPositionRef.current();
        }
      }
    };
    
    // 3초마다 체크
    const interval = setInterval(checkZoneDuringPosition, 3000);
    
    return () => clearInterval(interval);
  }, [enabled, hasPosition, checkCurrentSymbolZone]);

  // 스캔 실행 (현재 종목 제외 옵션)
  const runScan = useCallback(async (excludeSymbol?: string) => {
    if (!isMountedRef.current) return;
    if (isScanningRef.current) return;
    if (!enabledRef.current) return;
    if (hasPositionRef.current) {
      setStatusMessage('포지션 보유 중 - 스캔 일시정지');
      return;
    }

    // 제외할 종목 필터링
    let coins = hotCoinsRef.current.slice(0, 30);
    if (excludeSymbol) {
      coins = coins.filter(c => c !== excludeSymbol);
      addScreeningLog('start', `${excludeSymbol.replace('USDT', '')} 제외, 다른 종목 스캔...`);
    }
    
    if (coins.length === 0) {
      setStatusMessage('스캔할 코인 없음');
      return;
    }

    isScanningRef.current = true;
    setIsScanning(true);
    setStatusMessage(`${coins.length}개 코인 스캔 중...`);

    const results: DTFXScanResult[] = [];

    try {
      for (let i = 0; i < coins.length; i++) {
        if (!isMountedRef.current || !enabledRef.current) break;

        const symbol = coins[i];
        
        try {
          const klines = await fetch1mKlines(symbol, 200);
          if (!klines || klines.length < 30) continue;

          const currentPrice = klines[klines.length - 1].close;
          const { zones } = analyzeDTFX(klines, DTFX_STRUCTURE_LENGTH);

          // 🆕 활성 존만 필터링 (active: true)
          const activeZones = zones.filter(z => z.active);
          if (activeZones.length === 0) continue;

          const { distance, direction, inOTE, entryRatio } = calculateOTEDistance(currentPrice, activeZones);

          // 활성 존이 있고, 거리가 합리적인 경우만 추가 (5% 이내)
          if (direction && distance < 5) {
            results.push({
              symbol,
              zones: activeZones, // 🆕 활성 존만 저장
              oteDistance: distance,
              oteDirection: direction,
              currentPrice,
              inOTE,
              entryRatio,
            });
          }

          // OTE 구간 내에 있는 코인 발견 시 바로 로그
          if (inOTE) {
            addScreeningLog('approve', `OTE 구간 내 진입 가능! ${direction?.toUpperCase()}`, symbol);
          }
        } catch (err) {
          console.warn(`[DTFX스캔] ${symbol} 분석 실패:`, err);
        }

        // API 부하 방지 (50ms 간격)
        if (i < coins.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      if (!isMountedRef.current) return;

      // OTE 거리 기준 정렬 (가까운 순)
      results.sort((a, b) => {
        // OTE 내에 있는 코인 우선
        if (a.inOTE && !b.inOTE) return -1;
        if (!a.inOTE && b.inOTE) return 1;
        return a.oteDistance - b.oteDistance;
      });

      setScanResults(results);
      setLastScanTime(Date.now());

      // 최적 후보 선정
      const best = results[0] || null;
      setBestCandidate(best);

      if (best) {
        if (best.inOTE) {
          setStatusMessage(`🎯 ${best.symbol.replace('USDT', '')} OTE 구간 내! ${best.oteDirection?.toUpperCase()}`);
          addScreeningLog('approve', `OTE 진입 대기: ${best.oteDirection?.toUpperCase()} (${(best.entryRatio! * 100).toFixed(1)}%)`, best.symbol);
        } else {
          setStatusMessage(`⏳ ${best.symbol.replace('USDT', '')} OTE ${best.oteDistance.toFixed(2)}% 거리`);
        }
        
        // 차트 전환 + 타이머 리셋
        if (currentSymbolRef.current !== best.symbol) {
          const now = Date.now();
          const inHoldWindow =
            symbolSelectedTimeRef.current > 0 &&
            now - symbolSelectedTimeRef.current < OTE_TIMEOUT_MS;

          // 현재 종목이 아직 유효한 존을 가지고 있고(=존 소멸 아님), 1분 대기창이면 종목을 바꾸지 않음
          if (inHoldWindow && currentSymbolHasZoneRef.current) {
            addScreeningLog('analyze', `대기 유지: ${currentSymbolRef.current?.replace('USDT', '')} (1분 타이머 진행 중)`);
          } else {
            const hasActiveZone = best.zones.some(z => z.active);
            onSymbolChange(best.symbol);
            symbolSelectedTimeRef.current = now;
            lastZoneConfirmedTimeRef.current = now;
            currentSymbolHasZoneRef.current = hasActiveZone;
            addScreeningLog(
              'signal',
              `차트 전환: ${best.symbol.replace('USDT', '')} (존 ${best.zones.length}개, OTE ${best.oteDistance.toFixed(2)}%)`
            );
          }
        }
      } else {
        setStatusMessage(`DTFX 존 없음 (${coins.length}개 스캔)`);
        // 존 있는 코인 없으면 현재 종목 유지 (다음 스캔 대기)
      }

    } catch (error) {
      console.error('[DTFX스캔] 오류:', error);
      setStatusMessage('스캔 오류 발생');
    } finally {
      isScanningRef.current = false;
      setIsScanning(false);
    }
  }, [calculateOTEDistance, onSymbolChange]);

  // 존 상태 + 타임아웃 체크 (5초마다)
  useEffect(() => {
    if (!enabled || hasPosition) {
      if (zoneCheckIntervalRef.current) {
        clearInterval(zoneCheckIntervalRef.current);
        zoneCheckIntervalRef.current = null;
      }
      return;
    }

    const checkZoneAndTimeout = async () => {
      if (!enabledRef.current || hasPositionRef.current || isScanningRef.current) return;

      const now = Date.now();
      const timeSinceSelected = now - symbolSelectedTimeRef.current;
      const currentSymbol = currentSymbolRef.current;

      // 1) 타임아웃 체크: 1분 이상 OTE 반응 없으면 다른 종목 스캔
      if (symbolSelectedTimeRef.current > 0 && timeSinceSelected >= OTE_TIMEOUT_MS) {
        addScreeningLog('reject', `1분 타임아웃 - 다른 종목 탐색`, currentSymbol);
        symbolSelectedTimeRef.current = 0; // 리셋
        runScan(currentSymbol); // 현재 종목 제외하고 스캔
        return;
      }

      // 2) 존 소멸 체크
      const hadZone = currentSymbolHasZoneRef.current;
      const hasZone = await checkCurrentSymbolZone();
      if (hadZone && !hasZone) {
        // 이전에는 존이 있었는데 지금은 없으면 → 존 소멸 확정
        addScreeningLog('reject', `존 소멸 감지 - 다른 종목 탐색`, currentSymbol);
        runScan(currentSymbol); // 현재 종목 제외하고 스캔
        return;
      }
    };

    // 5초마다 체크
    zoneCheckIntervalRef.current = setInterval(checkZoneAndTimeout, 5000);

    return () => {
      if (zoneCheckIntervalRef.current) {
        clearInterval(zoneCheckIntervalRef.current);
        zoneCheckIntervalRef.current = null;
      }
    };
  }, [enabled, hasPosition, runScan, checkCurrentSymbolZone]);

  // 자동 스캔 인터벌 (10초) - 존 있는 종목 발굴용
  useEffect(() => {
    isMountedRef.current = true;

    if (enabled && !hasPosition) {
      // 초기 스캔 (1초 후)
      const initialDelay = setTimeout(() => {
        symbolSelectedTimeRef.current = Date.now();
        runScan();
      }, 1000);

      // 10초 간격 스캔 (단, 1분 대기창에서는 차트 스위칭/재스캔 최소화)
      scanIntervalRef.current = setInterval(() => {
        const now = Date.now();
        const inHoldWindow =
          symbolSelectedTimeRef.current > 0 &&
          now - symbolSelectedTimeRef.current < OTE_TIMEOUT_MS;

        // 이미 선택된 종목이 존을 유지하고 있으면 1분 동안은 추가 스캔으로 흔들지 않음
        if (inHoldWindow && currentSymbolHasZoneRef.current) return;

        runScan();
      }, 10000);

      return () => {
        clearTimeout(initialDelay);
        if (scanIntervalRef.current) {
          clearInterval(scanIntervalRef.current);
        }
      };
    } else {
      // 비활성화 시 인터벌 정리
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
        scanIntervalRef.current = null;
      }
    }

    return () => {
      isMountedRef.current = false;
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
    };
  }, [enabled, hasPosition, runScan]);

  // 수동 스캔
  const manualScan = useCallback(() => {
    symbolSelectedTimeRef.current = Date.now();
    runScan();
  }, [runScan]);

  return {
    isScanning,
    scanResults,
    bestCandidate,
    lastScanTime,
    statusMessage,
    manualScan,
  };
}
