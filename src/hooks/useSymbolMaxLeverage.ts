import { useState, useEffect, useCallback } from 'react';

interface LeverageBracket {
  bracket: number;
  initialLeverage: number;
  notionalCap: number;
  notionalFloor: number;
  maintMarginRatio: number;
}

interface SymbolLeverageInfo {
  symbol: string;
  brackets: LeverageBracket[];
  maxLeverage: number;
}

// 캐시: 심볼별 최대 레버리지
const leverageCache = new Map<string, number>();

// 전체 심볼 레버리지 정보 캐시
let allSymbolsLeverageCache: Map<string, number> | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5분

export function useSymbolMaxLeverage(symbol: string) {
  const [maxLeverage, setMaxLeverage] = useState<number>(125); // 기본값
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;

    // 캐시에서 먼저 확인
    if (leverageCache.has(symbol)) {
      setMaxLeverage(leverageCache.get(symbol)!);
      return;
    }

    const fetchLeverage = async () => {
      setLoading(true);
      try {
        // 바이낸스 선물 심볼 정보에서 레버리지 브라켓 가져오기
        const res = await fetch(
          `https://fapi.binance.com/fapi/v1/leverageBracket?symbol=${symbol}`
        );
        
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            const brackets = data[0]?.brackets || [];
            if (brackets.length > 0) {
              // 첫 번째 브라켓이 가장 높은 레버리지
              const max = brackets[0]?.initialLeverage || 125;
              leverageCache.set(symbol, max);
              setMaxLeverage(max);
            }
          }
        }
      } catch {
        // 실패 시 기본값 유지
      } finally {
        setLoading(false);
      }
    };

    fetchLeverage();
  }, [symbol]);

  return { maxLeverage, loading };
}

// 모든 심볼의 레버리지 정보를 한번에 가져오는 함수
export async function fetchAllSymbolsMaxLeverage(): Promise<Map<string, number>> {
  const now = Date.now();
  
  // 캐시가 유효하면 반환
  if (allSymbolsLeverageCache && (now - cacheTimestamp) < CACHE_DURATION) {
    return allSymbolsLeverageCache;
  }

  try {
    const res = await fetch('https://fapi.binance.com/fapi/v1/exchangeInfo');
    if (res.ok) {
      const data = await res.json();
      const symbols = data.symbols || [];
      
      const leverageMap = new Map<string, number>();
      
      for (const sym of symbols) {
        // 기본 최대 레버리지 설정 (심볼마다 다름)
        // exchangeInfo에서는 직접적인 레버리지 정보가 없으므로 leverageBracket 사용해야 함
        // 하지만 각 심볼별로 API 호출하면 rate limit 문제가 있으므로
        // 일반적인 기본값을 사용하고, 선택된 심볼만 정확히 조회
        leverageMap.set(sym.symbol, 125);
      }
      
      allSymbolsLeverageCache = leverageMap;
      cacheTimestamp = now;
      
      return leverageMap;
    }
  } catch {
    // 실패 시 빈 맵 반환
  }
  
  return new Map();
}

// 레버리지 옵션 생성 (최대 레버리지에 맞게)
export function generateLeverageOptions(maxLeverage: number): number[] {
  const options: number[] = [];
  
  // 1, 2, 3, 5, 10, 20, 25, 50, 75, 100, 125 중 최대 레버리지 이하만
  const presets = [1, 2, 3, 5, 10, 15, 20, 25, 50, 75, 100, 125];
  
  for (const preset of presets) {
    if (preset <= maxLeverage) {
      options.push(preset);
    }
  }
  
  // 최대 레버리지가 presets에 없으면 추가
  if (maxLeverage > 0 && !options.includes(maxLeverage)) {
    options.push(maxLeverage);
    options.sort((a, b) => a - b);
  }
  
  return options;
}

// 분할 옵션
export const SPLIT_OPTIONS = [1, 2, 3, 5, 10] as const;
export type SplitCount = typeof SPLIT_OPTIONS[number];
