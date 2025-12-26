/**
 * DTFX 자동 스캔 훅
 * - 핫코인 리스트에서 1분봉 DTFX 존 스캔
 * - OTE 구간(61.8%~70.5%)에 가장 가까운 코인 자동 선택
 * - 존 사라지면 다른 코인 자동 탐색
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { analyzeDTFX, checkDTFXOTEEntry, DTFXZone, Candle, OTE_ZONE } from './useDTFX';
import { addScreeningLog } from '@/components/ScreeningLogPanel';

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
}

export function useDTFXScanner({
  hotCoins,
  enabled,
  onSymbolChange,
  currentSymbol,
  hasPosition,
}: UseDTFXScannerProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<DTFXScanResult[]>([]);
  const [bestCandidate, setBestCandidate] = useState<DTFXScanResult | null>(null);
  const [lastScanTime, setLastScanTime] = useState(0);
  const [statusMessage, setStatusMessage] = useState('대기 중');

  const isMountedRef = useRef(true);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isScanningRef = useRef(false);
  const enabledRef = useRef(enabled);
  const hasPositionRef = useRef(hasPosition);
  const currentSymbolRef = useRef(currentSymbol);

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

  // 스캔 실행
  const runScan = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (isScanningRef.current) return;
    if (!enabledRef.current) return;
    if (hasPositionRef.current) {
      setStatusMessage('포지션 보유 중 - 스캔 일시정지');
      return;
    }

    const coins = hotCoins.slice(0, 30); // 최대 30개 스캔
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
          const klines = await fetch1mKlines(symbol, 100);
          if (!klines || klines.length < 30) continue;

          const currentPrice = klines[klines.length - 1].close;
          const { zones } = analyzeDTFX(klines, 5); // 1분봉이라 lookback 5로 줄임

          if (zones.length === 0) continue;

          const { distance, direction, inOTE, entryRatio } = calculateOTEDistance(currentPrice, zones);

          // 활성 존이 있고, 거리가 합리적인 경우만 추가 (5% 이내)
          if (direction && distance < 5) {
            results.push({
              symbol,
              zones,
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
          
          // 자동으로 해당 코인으로 차트 전환
          if (currentSymbolRef.current !== best.symbol) {
            onSymbolChange(best.symbol);
          }
        } else {
          setStatusMessage(`⏳ ${best.symbol.replace('USDT', '')} OTE ${best.oteDistance.toFixed(2)}% 거리`);
          
          // OTE에 가장 가까운 코인으로 차트 전환
          if (currentSymbolRef.current !== best.symbol) {
            onSymbolChange(best.symbol);
          }
        }
      } else {
        setStatusMessage(`DTFX 존 없음 (${coins.length}개 스캔)`);
      }

    } catch (error) {
      console.error('[DTFX스캔] 오류:', error);
      setStatusMessage('스캔 오류 발생');
    } finally {
      isScanningRef.current = false;
      setIsScanning(false);
    }
  }, [hotCoins, calculateOTEDistance, onSymbolChange]);

  // 자동 스캔 인터벌
  useEffect(() => {
    isMountedRef.current = true;

    if (enabled && !hasPosition) {
      // 초기 스캔 (1초 후)
      const initialDelay = setTimeout(() => {
        runScan();
      }, 1000);

      // 10초 간격 스캔
      scanIntervalRef.current = setInterval(runScan, 10000);

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
