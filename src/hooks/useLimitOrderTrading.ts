/**
 * ⚡ 분할 매매 훅 v3.0
 * 
 * 특징:
 * 1. 자동매매: 시그널 스캔 전용 (종목 탐지)
 * 2. 수동 진입: 분할 시장가 / 분할 지정가
 * 3. 레버리지 1x/5x/10x, 분할 1/5/10 선택 가능
 * 4. 바이낸스 SL/TP 주문 연동
 * 5. 실거래 전용
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useBinanceApi } from './useBinanceApi';
import { useAuth } from './useAuth';
import { useMarketAnalysis } from './useMarketAnalysis';
import { TechnicalIndicators, checkLongSignal, checkShortSignal, calculateAllIndicators } from './useTechnicalIndicators';
import { initAudio, playTpSound, playSlSound } from '@/lib/sounds';
import { fetchSymbolPrecision, roundQuantity, roundPrice } from '@/lib/binance';
import {
  LIMIT_ORDER_CONFIG,
  LimitOrderEntry,
  LimitOrderPosition,
} from '@/lib/limitOrderConfig';
import { toast } from 'sonner';
import { analyzeDTFX, checkDTFXOTEEntry, Candle as DTFXCandle } from './useDTFX';

// 1분봉 조회
const fetch1mKlines = async (symbol: string, limit: number = 10) => {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=${limit}`);
    const data = await res.json();
    return data.map((k: any) => ({
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch { return null; }
};

const fetch5mKlines = async (symbol: string, limit: number = 50) => {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=5m&limit=${limit}`);
    const data = await res.json();
    return data.map((k: any) => ({
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  } catch { return null; }
};

// 1분봉 조회 (DTFX 스캘핑용) - time 포함 버전
const fetch1mKlinesForDTFX = async (symbol: string, limit: number = 100): Promise<DTFXCandle[] | null> => {
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

// ===== 타입 정의 =====
export interface LimitOrderTradeLog {
  id: string;
  timestamp: number;
  symbol: string;
  action: 'order' | 'fill' | 'cancel' | 'tp' | 'sl' | 'timeout' | 'error';
  side: 'long' | 'short';
  price: number;
  quantity: number;
  pnl?: number;
  reason?: string;
}

export interface PendingSignal {
  symbol: string;
  direction: 'long' | 'short';
  strength: 'weak' | 'medium' | 'strong';
  reasons: string[];
  signalTime: number;
  signalPrice: number;
  indicators: TechnicalIndicators;
}

// DTFX OTE 진입 대기 시그널
export interface PendingDTFXSignal {
  symbol: string;
  direction: 'long' | 'short';
  entryRatio: number;
  zoneType: 'demand' | 'supply';
  currentPrice: number;
  timestamp: number;
}

export interface LimitOrderTradingState {
  isEnabled: boolean;
  isProcessing: boolean;
  currentSymbol: string | null;
  pendingSignal: PendingSignal | null;
  currentPosition: LimitOrderPosition | null;
  todayStats: {
    trades: number;
    wins: number;
    losses: number;
    totalPnL: number;
  };
  tradeLogs: LimitOrderTradeLog[];
  statusMessage: string;
  scanningProgress: string;
  aiAnalysis: any | null;
  isAiAnalyzing: boolean;
  aiEnabled: boolean;
  // 진입 상태
  entryOrderIds: string[];
  entryStartTime: number | null;
  // DTFX 상태
  dtfxZones?: any[];
  dtfxLastCheck?: number;
  // DTFX OTE 대기 시그널 (사용자 확인 필요)
  pendingDTFXSignal?: PendingDTFXSignal | null;
}

interface UseLimitOrderTradingProps {
  balanceUSD: number;
  leverage: number;
  krwRate: number;
  // 현재 화면에서 보고 있는 종목(호가창 기준)
  viewingSymbol?: string;
  onTradeComplete?: () => void;
  majorCoinMode?: boolean;
  // 필터 설정
  filterSettings?: {
    takeProfitUsdt: number; // USDT 기반 익절
    dtfxEnabled?: boolean; // DTFX OTE 구간 진입 모드
    chartTpEnabled?: boolean; // 차트 TP 모드 활성화 시 자동 TP 배치 비활성화
  };
}

// ===== 메인 훅 =====
export function useLimitOrderTrading({
  balanceUSD,
  leverage: _leverage,
  krwRate,
  viewingSymbol,
  onTradeComplete,
  majorCoinMode = true,
  filterSettings,
}: UseLimitOrderTradingProps) {
  // PaperTrading/Index에서 전달된 레버리지를 우선 사용 (기본값은 config)
  const leverage = _leverage ?? LIMIT_ORDER_CONFIG.LEVERAGE;

  const [state, setState] = useState<LimitOrderTradingState>({
    isEnabled: false,
    isProcessing: false,
    currentSymbol: null,
    pendingSignal: null,
    currentPosition: null,
    todayStats: { trades: 0, wins: 0, losses: 0, totalPnL: 0 },
    tradeLogs: [],
    statusMessage: '🔄 지정가 매매 비활성화',
    scanningProgress: '',
    aiAnalysis: null,
    isAiAnalyzing: false,
    aiEnabled: true,
    entryOrderIds: [],
    entryStartTime: null,
    pendingDTFXSignal: null,
  });

  const { user } = useAuth();
  const {
    placeMarketOrder,
    placeLimitOrder,
    placeStopMarketOrder,
    placeTakeProfitMarketOrder,
    getPositions,
    setLeverage,
    cancelOrder,
    cancelAllOrders,
    getOpenOrders,
  } = useBinanceApi();
  
  const { analysis: aiAnalysisResult, isAnalyzing: isAiAnalyzing, analyzeMarket, resetAnalysis } = useMarketAnalysis({ 
    enabled: state.aiEnabled,
    showToasts: state.isEnabled,
  });

  // AI 분석 결과 동기화
  useEffect(() => {
    setState(prev => ({
      ...prev,
      aiAnalysis: aiAnalysisResult,
      isAiAnalyzing,
    }));
  }, [aiAnalysisResult, isAiAnalyzing]);

  // 시그널 발생 시 즉시 AI 분석 실행
  const lastAnalyzedSymbolRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user) return;
    if (!state.aiEnabled) return;
    if (!state.isEnabled) return;
    if (!state.pendingSignal) return;

    const { symbol, indicators, signalPrice } = state.pendingSignal;

    if (lastAnalyzedSymbolRef.current === symbol) return;
    lastAnalyzedSymbolRef.current = symbol;

    console.log(`[AI분석] 시그널 감지 → ${symbol} 분석 시작`);
    analyzeMarket(symbol, indicators, signalPrice, 0, 0)
      .then((result) => {
        if (result) console.log(`[AI분석] ${symbol} 결과: ${result.marketCondition} (${result.confidence}%)`);
      })
      .catch((err) => console.warn('[AI분석] 실패:', err));
  }, [user, state.pendingSignal, state.aiEnabled, state.isEnabled, analyzeMarket]);

  // 수동 AI 분석 함수 (버튼 클릭 시 호출)
  const manualAnalyzeMarket = useCallback(async () => {
    if (!user) return;
    if (!state.aiEnabled) return;
    if (!viewingSymbol) return;

    const symbol = viewingSymbol;

    try {
      const klines = await fetch5mKlines(symbol, 60);
      if (!klines || klines.length < 30) {
        console.warn('[AI분석] 데이터 부족');
        return;
      }

      const klinesForCalc = klines.map((k: any, idx: number) => ({
        openTime: idx,
        closeTime: idx,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
      }));

      const indicators = calculateAllIndicators(klinesForCalc as any);
      if (!indicators) return;

      const lastClose = klinesForCalc[klinesForCalc.length - 1]?.close ?? 0;
      if (!lastClose) return;

      console.log(`[AI분석] 수동 분석 시작 → ${symbol}`);
      await analyzeMarket(symbol, indicators, lastClose, 0, 0);
    } catch (err) {
      console.warn('[AI분석] 수동 분석 실패:', err);
    }
  }, [user, viewingSymbol, state.aiEnabled, analyzeMarket, fetch5mKlines]);


  const processingRef = useRef(false);
  const lastEntryTimeRef = useRef(0);
  const currentPositionRef = useRef<LimitOrderPosition | null>(null);
  const lastSyncedPositionRef = useRef<string | null>(null);
  
  // currentPosition을 ref로 동기화
  useEffect(() => {
    currentPositionRef.current = state.currentPosition;
  }, [state.currentPosition]);

  // ===== 실제 포지션 주기적 동기화 (수동 지정가 체결 감지 + 서버 SL/TP 유지) =====
  // 신규 포지션 감지 시 SL/TP 설정을 위한 ref
  const slTpSettingInProgressRef = useRef<string | null>(null);

  // 서버 SL/TP 주문 재설정(수량/평단 변경 시) 스로틀링
  const serverSlTpInProgressRef = useRef(false);
  const serverSlTpLastAttemptRef = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });

  // TP 함수를 ref로 저장 (의존성 문제 방지)
  const placeTakeProfitMarketOrderRef = useRef(placeTakeProfitMarketOrder);
  const getOpenOrdersRef = useRef(getOpenOrders);
  const cancelOrderRef = useRef(cancelOrder);
  const filterSettingsRef = useRef(filterSettings);

  useEffect(() => {
    placeTakeProfitMarketOrderRef.current = placeTakeProfitMarketOrder;
    getOpenOrdersRef.current = getOpenOrders;
    cancelOrderRef.current = cancelOrder;
    filterSettingsRef.current = filterSettings;
  }, [placeTakeProfitMarketOrder, getOpenOrders, cancelOrder, filterSettings]);
  
  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    const ensureServerTpOrders = async (opts: {
      symbol: string;
      side: 'long' | 'short';
      qty: number;
      avgPrice: number;
      positionSide?: 'LONG' | 'SHORT';
    }) => {
      if (!isMounted) return;
      if (processingRef.current) return;
      if (serverSlTpInProgressRef.current) return;
      
      // 🚨 차트 TP 모드 활성화 시 자동 TP 배치 건너뛰기 (수동 TP만 사용)
      if (filterSettingsRef.current?.chartTpEnabled) {
        console.log('[서버 TP] 차트 TP 모드 활성화 → 자동 TP 배치 건너뜀');
        return;
      }

      const targetTakeProfitUsdt = filterSettingsRef.current?.takeProfitUsdt ?? 7;

      const positionValueUsd = opts.avgPrice * opts.qty;
      if (!Number.isFinite(positionValueUsd) || positionValueUsd <= 0) return;

      const tpPercent = (targetTakeProfitUsdt / positionValueUsd) * 100;
      const tpPrice =
        opts.side === 'long'
          ? opts.avgPrice * (1 + tpPercent / 100)
          : opts.avgPrice * (1 - tpPercent / 100);

      const key = `${opts.symbol}-${opts.side}-${opts.qty.toFixed(6)}-${opts.avgPrice.toFixed(6)}-${targetTakeProfitUsdt}`;
      const now = Date.now();

      // 실패 시 반복 호출 방지 (10초 스로틀)
      if (
        serverSlTpLastAttemptRef.current.key === key &&
        now - serverSlTpLastAttemptRef.current.at < 10_000
      ) {
        return;
      }

      serverSlTpLastAttemptRef.current = { key, at: now };
      serverSlTpInProgressRef.current = true;

      const closeSide = opts.side === 'long' ? 'SELL' : 'BUY';

      console.log(
        `🧷 [서버 TP 유지] ${opts.symbol} ${opts.side} qty=${opts.qty.toFixed(6)} avg=${opts.avgPrice} | TP=$${targetTakeProfitUsdt}→${tpPrice.toFixed(4)}`
      );

      try {
        // 기존 TP 주문만 취소
        const openOrders = await getOpenOrdersRef.current(opts.symbol);
        const tpTypes = new Set(['TAKE_PROFIT_MARKET', 'TAKE_PROFIT']);
        const tpOrders = (openOrders || []).filter((o: any) => {
          const t = String(o?.type || o?.origType || '').toUpperCase();
          return tpTypes.has(t);
        });

        for (const o of tpOrders) {
          const orderIdNum = Number(o.orderId);
          if (!Number.isFinite(orderIdNum)) continue;
          try {
            await cancelOrderRef.current(opts.symbol, orderIdNum);
          } catch {
            // ignore
          }
        }

        // 취소 반영 대기
        await new Promise((r) => setTimeout(r, 150));

        // TAKE_PROFIT_MARKET (익절 설정)
        try {
          await placeTakeProfitMarketOrderRef.current(opts.symbol, closeSide, opts.qty, tpPrice, opts.positionSide);
        } catch (e: any) {
          console.warn('[서버 TP] TAKE_PROFIT_MARKET 실패:', e?.message || e);
        }
      } finally {
        serverSlTpInProgressRef.current = false;
      }
    };

    const syncPositionFromExchange = async () => {
      // 처리 중/진입 대기/청산 중이면 스킵 (상태 꼬임 방지)
      if (processingRef.current) return;
      const localPos = currentPositionRef.current;
      if (localPos?.entryPhase === 'waiting') return;
      if (localPos?.entryPhase === 'closing') return;

      try {
        const positions = await getPositions();
        if (!isMounted) return;
        if (!positions || !Array.isArray(positions)) return;

        // 실제 열린 포지션 찾기
        const openPosition = positions.find((p: any) => {
          const amt = parseFloat(p.positionAmt || '0');
          return Math.abs(amt) > 0;
        });

        if (openPosition) {
          const posAmt = parseFloat(openPosition.positionAmt);
          const entryPrice = parseFloat(openPosition.entryPrice);
          const symbol = openPosition.symbol;
          const side: 'long' | 'short' = posAmt > 0 ? 'long' : 'short';
          const qty = Math.abs(posAmt);
          // 바이낸스에서 제공하는 실제 미실현 손익
          const unrealizedPnl = parseFloat(openPosition.unRealizedProfit || '0');
          const markPrice = parseFloat(openPosition.markPrice || '0');

          // 중복 동기화 방지 (unrealizedPnl 변경은 허용)
          const posKey = `${symbol}-${side}-${qty.toFixed(6)}`;
          const isBrandNewPosition = lastSyncedPositionRef.current !== posKey;
          if (isBrandNewPosition) {
            lastSyncedPositionRef.current = posKey;
          }

          console.log(`🔄 [포지션 동기화] ${symbol} ${side} @ ${entryPrice} qty=${qty} PnL=$${unrealizedPnl.toFixed(2)}`);

          if (isMounted) {
            setState(prev => {
              const prevPos = prev.currentPosition;

              // 같은 심볼/방향이면 수량/평단/PnL 갱신
              if (prevPos && prevPos.symbol === symbol && prevPos.side === side) {
                return {
                  ...prev,
                  currentSymbol: symbol,
                  currentPosition: {
                    ...prevPos,
                    avgPrice: entryPrice,
                    totalQuantity: qty,
                    filledQuantity: qty,
                    unrealizedPnl,
                    markPrice,
                  },
                };
              }

              // 신규 포지션 감지
              return {
                ...prev,
                currentSymbol: symbol,
                currentPosition: {
                  symbol,
                  side,
                  entries: [],
                  avgPrice: entryPrice,
                  totalQuantity: qty,
                  filledQuantity: qty,
                  startTime: Date.now(),
                  entryPhase: 'active',
                  takeProfitOrders: [],
                  unrealizedPnl,
                  markPrice,
                },
                statusMessage: `✅ ${symbol} ${side === 'long' ? '롱' : '숏'} 포지션 감지!`,
              };
            });
          }

          // ===== 서버 TP 주문: 신규 감지 + (수량/평단 변경 시) 재설정 =====
          const positionSide =
            (openPosition.positionSide && openPosition.positionSide !== 'BOTH')
              ? (openPosition.positionSide as 'LONG' | 'SHORT')
              : undefined;

          const prevLocal = currentPositionRef.current;
          const isSameLocal = prevLocal && prevLocal.symbol === symbol && prevLocal.side === side;
          const qtyChanged = isSameLocal ? Math.abs((prevLocal?.filledQuantity ?? 0) - qty) > 0.0001 : false;
          const priceChanged = isSameLocal
            ? Math.abs((prevLocal?.avgPrice ?? 0) - entryPrice) / (entryPrice || 1) > 0.0005
            : false;

           const hasEverAttempted = serverSlTpLastAttemptRef.current.key !== null;
           const shouldEnsure = isBrandNewPosition || qtyChanged || priceChanged || !hasEverAttempted;

           if (shouldEnsure) {
             // 신규 포지션 감지 시 동기화 키 업데이트
             if (isBrandNewPosition && slTpSettingInProgressRef.current !== posKey && isMounted) {
               slTpSettingInProgressRef.current = posKey;
             }

             await ensureServerTpOrders({ symbol, side, qty, avgPrice: entryPrice, positionSide });
           }
        } else {
          // 포지션이 없으면 동기화 키 초기화 + 로컬 상태 정리
          const localPos = currentPositionRef.current;
          const hadPosition = lastSyncedPositionRef.current !== null || localPos !== null;
          
          if (hadPosition) {
            // ✅ 외부 청산 토스트는 "로컬 포지션이 active로 남아있는데" 실제 포지션이 없을 때만
            // (수동/정상 청산 과정에서는 localPos가 null/closing으로 바뀌므로 오탐 방지)
            if (localPos && localPos.entryPhase === 'active') {
              const timeSinceEntry = Date.now() - (localPos.startTime || 0);
              if (timeSinceEntry > 10_000) {
                toast.warning(`📢 ${localPos.symbol} 외부 청산 감지`, {
                  description: '바이낸스 앱 또는 다른 곳에서 포지션이 청산되었습니다.',
                  duration: 5000,
                });
              } else {
                console.log(`⏳ [외부 청산 후보] 진입 직후 ${(timeSinceEntry / 1000).toFixed(1)}초 - 토스트 무시`);
              }
            }

            console.log(`🔄 [포지션 동기화] 외부 청산 감지! 로컬 상태 초기화`);
            lastSyncedPositionRef.current = null;
            slTpSettingInProgressRef.current = null;
            serverSlTpLastAttemptRef.current = { key: null, at: 0 };
            
            // 로컬 포지션 상태도 초기화 (외부 청산 시 즉시 반영)
            if (isMounted) {
              setState(prev => {
                if (prev.currentPosition) {
                  return {
                    ...prev,
                    currentPosition: null,
                    currentSymbol: null,
                    entryOrderIds: [],
                    entryStartTime: null,
                    statusMessage: '🔍 다음 시그널 대기...',
                  };
                }
                return prev;
              });
            }
          }
        }
      } catch (error) {
        // 조용히 실패 (네트워크 일시 오류 등)
        console.warn('[포지션 동기화] 오류:', error);
      }
    };

    // 1.5초마다 실제 포지션 확인 (외부 청산 빠른 감지)
    const interval = setInterval(syncPositionFromExchange, 1500);
    // 초기 1회 실행
    syncPositionFromExchange();

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [user, getPositions]);

  // ===== 로그 추가 =====
  const addLog = useCallback((log: Omit<LimitOrderTradeLog, 'id' | 'timestamp'>) => {
    const newLog: LimitOrderTradeLog = {
      ...log,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };
    setState(prev => ({
      ...prev,
      tradeLogs: [newLog, ...prev.tradeLogs].slice(0, 50),
    }));
    return newLog;
  }, []);

  // ===== 자동매매 토글 =====
  const toggleAutoTrading = useCallback(() => {
    setState(prev => {
      const newEnabled = !prev.isEnabled;
      if (newEnabled) {
        initAudio();
      }
      return {
        ...prev,
        isEnabled: newEnabled,
        pendingSignal: null,
        statusMessage: newEnabled ? '🔍 시그널 스캔 중...' : '🔄 지정가 매매 비활성화',
      };
    });
  }, []);

  // ===== AI 분석 토글 =====
  const toggleAiAnalysis = useCallback(() => {
    const newEnabled = !state.aiEnabled;
    setState(prev => ({
      ...prev,
      aiEnabled: newEnabled,
      aiAnalysis: newEnabled ? prev.aiAnalysis : null,
    }));
    if (!newEnabled) {
      resetAnalysis();
    }
  }, [state.aiEnabled, resetAnalysis]);

  // ===== 미체결 주문 취소 =====
  const cancelPendingOrders = useCallback(async (symbol: string) => {
    try {
      await cancelAllOrders(symbol);
      console.log(`🚫 [cancelPendingOrders] ${symbol} 미체결 주문 전량 취소`);
    } catch (error) {
      console.error('주문 취소 실패:', error);
    }
  }, [cancelAllOrders]);

  // ===== 전량 시장가 청산 =====
  const closePositionMarket = useCallback(async (
    reason: 'tp' | 'sl' | 'timeout' | 'cancel',
    currentPrice: number,
    forceClose: boolean = false
  ) => {
    // forceClose가 true면 processingRef 체크 스킵 (수동 청산 시)
    if (!forceClose && processingRef.current) {
      console.log(`⚠️ [청산] processingRef가 true, 청산 스킵`);
      return;
    }

    // 현재 포지션 정보를 ref와 state 둘 다에서 가져오기
    const position = currentPositionRef.current || state.currentPosition;
    if (!position) {
      console.log(`⚠️ [청산] 포지션 없음, 직접 바이낸스 조회 시도`);
      // 바이낸스에서 직접 포지션 조회 시도
      try {
        const allPositions = await getPositions();
        const openPos = allPositions?.find((p: any) => Math.abs(parseFloat(p.positionAmt)) > 0);
        if (!openPos) {
          console.log(`⚠️ [청산] 바이낸스에도 포지션 없음`);
          return;
        }
        // 바이낸스 포지션으로 직접 청산 진행
        const symbol = openPos.symbol;
        const posAmt = parseFloat(openPos.positionAmt);
        const qty = Math.abs(posAmt);
        const side = posAmt > 0 ? 'long' : 'short';
        const orderSide = side === 'long' ? 'SELL' : 'BUY';
        const entryPrice = parseFloat(openPos.entryPrice);
        
        console.log(`🔴 [긴급 시장가 청산] ${symbol} ${orderSide} 수량=${qty}`);
        
        processingRef.current = true;
        setState(prev => ({ ...prev, isProcessing: true }));
        
        try {
          await cancelAllOrders(symbol);
          const closeResult = await placeMarketOrder(symbol, orderSide, qty, true, currentPrice);
          if (closeResult && !closeResult.error) {
            console.log(`✅ [긴급 청산] 성공`);
            playSlSound();
          }
        } finally {
          processingRef.current = false;
          setState(prev => ({ 
            ...prev, 
            isProcessing: false,
            currentPosition: null,
            currentSymbol: null,
            entryOrderIds: [],
            entryStartTime: null,
            statusMessage: '✅ 긴급 청산 완료',
          }));
          lastSyncedPositionRef.current = null;
          slTpSettingInProgressRef.current = null;
          onTradeComplete?.();
        }
        return;
      } catch (e) {
        console.error('긴급 청산 실패:', e);
        processingRef.current = false;
        setState(prev => ({ ...prev, isProcessing: false }));
        return;
      }
    }

    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));

    try {
      // 미체결 주문 모두 취소
      await cancelPendingOrders(position.symbol);

      // 실제 포지션 조회
      const positions = await getPositions(position.symbol);
      const actualPosition = positions?.find((p: any) =>
        p.symbol === position.symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );

      if (!actualPosition) {
        setState(prev => ({
          ...prev,
          currentPosition: null,
          currentSymbol: null,
          entryOrderIds: [],
          entryStartTime: null,
          statusMessage: '🔍 다음 시그널 대기...',
        }));
        lastSyncedPositionRef.current = null;
        slTpSettingInProgressRef.current = null;
        return;
      }

      const actualQty = Math.abs(parseFloat(actualPosition.positionAmt));
      const actualEntryPrice = parseFloat(actualPosition.entryPrice);
      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';

      console.log(`🔴 [시장가 청산] ${position.symbol} ${orderSide} 수량=${actualQty} 사유=${reason}`);

      const closeResult = await placeMarketOrder(position.symbol, orderSide, actualQty, true, currentPrice);
      if (!closeResult || closeResult.error) {
        throw new Error(closeResult?.error || '청산 실패');
      }

      // 실제 체결 가격 가져오기 (바이낸스 응답에서)
      const actualExitPrice = parseFloat(closeResult.avgPrice || closeResult.price || '0') || currentPrice;
      console.log(`📊 [청산 체결] 예상가=${currentPrice.toFixed(6)} → 실제체결가=${actualExitPrice.toFixed(6)}`);

      // 잔량 확인 및 추가 청산
      await new Promise(resolve => setTimeout(resolve, 500));
      const remainingPositions = await getPositions(position.symbol);
      const remainingPosition = remainingPositions?.find((p: any) =>
        p.symbol === position.symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );

      if (remainingPosition) {
        const remainingQty = Math.abs(parseFloat(remainingPosition.positionAmt));
        if (remainingQty > 0) {
          try {
            await placeMarketOrder(position.symbol, orderSide, remainingQty, true, currentPrice);
          } catch (e) {
            console.warn(`⚠️ 잔량 청산 실패:`, e);
          }
        }
      }

      // 손익 계산 (실제 체결가 기준)
      const feeRate = LIMIT_ORDER_CONFIG.TAKER_FEE / 100;
      const entryFeeRate = LIMIT_ORDER_CONFIG.MAKER_FEE / 100;
      const direction = position.side === 'long' ? 1 : -1;
      const priceDiff = (actualExitPrice - actualEntryPrice) * direction;
      const pnlGross = priceDiff * actualQty;
      const entryNotional = actualEntryPrice * actualQty;
      const exitNotional = actualExitPrice * actualQty;
      const feeUsd = (entryNotional * entryFeeRate) + (exitNotional * feeRate);
      const pnl = pnlGross - feeUsd;
      const isWin = pnl > 0;

      setState(prev => ({
        ...prev,
        currentPosition: null,
        currentSymbol: null,
        entryOrderIds: [],
        entryStartTime: null,
        todayStats: {
          trades: prev.todayStats.trades + 1,
          wins: prev.todayStats.wins + (isWin ? 1 : 0),
          losses: prev.todayStats.losses + (isWin ? 0 : 1),
          totalPnL: prev.todayStats.totalPnL + pnl,
        },
        statusMessage: `${isWin ? '✅' : '❌'} ${reason === 'tp' ? '익절' : reason === 'sl' ? '손절' : '청산'} 완료!`,
      }));
      
      // 동기화 ref 초기화
      lastSyncedPositionRef.current = null;
      slTpSettingInProgressRef.current = null;
      
      const reasonText: Record<string, string> = {
        tp: '익절',
        sl: '손절',
        timeout: '타임아웃',
        cancel: '취소',
      };

      addLog({
        symbol: position.symbol,
        action: reason === 'tp' ? 'tp' : reason === 'sl' ? 'sl' : 'timeout',
        side: position.side,
        price: actualExitPrice,  // 실제 체결가
        quantity: actualQty,
        pnl,
        reason: reasonText[reason],
      });

      const pnlKRW = Math.round(pnl * krwRate);

      if (isWin) {
        playTpSound();
      } else {
        playSlSound();
      }

      console.log(`${isWin ? '✅' : '❌'} ${reasonText[reason]} | ${pnl >= 0 ? '+' : ''}₩${pnlKRW.toLocaleString()}`);


      onTradeComplete?.();
    } catch (error: any) {
      console.error('Close error:', error);
      addLog({
        symbol: position.symbol,
        action: 'error',
        side: position.side,
        price: currentPrice,
        quantity: position.filledQuantity,
        reason: error.message || '청산 실패',
      });
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [state.currentPosition, placeMarketOrder, getPositions, cancelPendingOrders, cancelAllOrders, krwRate, leverage, addLog, onTradeComplete]);

  // ===== TP/SL 체크 =====
  const checkTpSl = useCallback(async (currentPrice: number) => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;
    if (state.currentPosition.entryPhase === 'waiting') return;
    if (state.currentPosition.entryPhase === 'closing') return; // 이미 익절 진행 중

    const position = state.currentPosition;
    const holdTimeSec = (Date.now() - position.startTime) / 1000;

    // 정확한 PnL 계산
    const direction = position.side === 'long' ? 1 : -1;
    const priceDiff = (currentPrice - position.avgPrice) * direction;
    const pnlUSD = priceDiff * position.filledQuantity;
    const pnlKRW = pnlUSD * krwRate;
    const pnlPercent = (priceDiff / position.avgPrice) * 100;

    // 저체결 손익분기 모드 체크
    const isLowFillBreakeven = (position as any).isLowFillBreakeven === true;
    const breakEvenBuffer = 0.1; // 손익분기 청산 시 수수료 버퍼 (%)

    // 상태 메시지 업데이트
    setState(prev => ({
      ...prev,
      statusMessage: isLowFillBreakeven
        ? `⚡ ${position.symbol.replace('USDT', '')} 손익분기 대기 | ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%`
        : `🔄 ${position.symbol.replace('USDT', '')} ${position.side === 'long' ? '롱' : '숏'} | ${pnlKRW >= 0 ? '+' : ''}₩${Math.round(pnlKRW).toLocaleString()}`,
    }));

    // 진입 직후 5초 보호
    if (holdTimeSec < 5) return;

    // ===== 저체결 손익분기 모드: 손익분기 도달 시 즉시 청산 =====
    if (isLowFillBreakeven) {
      if (pnlPercent >= -breakEvenBuffer) {
        console.log(`✅ [저체결 손익분기] ${position.symbol} PnL ${pnlPercent.toFixed(3)}% >= -${breakEvenBuffer}% → 청산`);
        await closePositionMarket('tp', currentPrice);
        return;
      }
      // 저체결 모드에서는 익절/타임스탑 무시, 손익분기만 대기
      return;
    }

    // ===== 일반 모드 =====
    // (손절 기능 완전 제거됨)

    // 익절 체크 (USDT 기반) → 전량 시장가 청산
    // 🚨 차트 TP 모드 활성화 시에는 바이낸스 서버 주문이 처리하므로 로컬 체크 건너뜀
    if (filterSettings?.chartTpEnabled) {
      // 차트 TP 모드: 서버 TAKE_PROFIT_MARKET 주문에 의존
      return;
    }
    
    const targetProfitUsdt = filterSettings?.takeProfitUsdt ?? 7;
    if (pnlUSD >= targetProfitUsdt) {
      console.log(`💰 익절! $${pnlUSD.toFixed(2)} >= $${targetProfitUsdt}`);
      await closePositionMarket('tp', currentPrice);
      return;
    }

  }, [state.currentPosition, closePositionMarket, krwRate, filterSettings]);

  // ===== 시그널 핸들러 (스캔 전용 - 진입은 수동) =====
  const handleTechnicalSignal = useCallback(async (
    symbol: string,
    direction: 'long' | 'short',
    price: number,
    strength: 'weak' | 'medium' | 'strong',
    reasons: string[],
    indicators: TechnicalIndicators
  ) => {
    if (!state.isEnabled) return;
    if (processingRef.current) return;
    if (!user) return;
    
    if (balanceUSD <= 0) {
      console.log(`[handleSignal] 잔고 미로드 - ${symbol} ${direction} 시그널 무시`);
      setState(prev => ({
        ...prev,
        statusMessage: '⏳ 잔고 조회 중... 시그널 대기',
      }));
      return;
    }
    
    if (state.currentPosition) return;
    if (state.pendingSignal) return;

    // 시그널 강도 체크
    if (strength === 'weak') return;

    // ===== 5봉 연속 진행 필터 (한 방향 과열 방지) =====
    try {
      const klines1m = await fetch1mKlines(symbol, 6); // 최근 6봉 (현재봉 제외하고 5봉 분석)
      if (klines1m && klines1m.length >= 6) {
        // 최신봉(현재 미완성봉) 제외하고 완성된 5봉 분석
        // klines는 최신순이므로 [0]이 현재봉, [1]~[5]가 완성된 최근 5봉
        const last5Candles = klines1m.slice(1, 6);
        
        // "연속" 양봉/음봉 카운트 - 끊기면 리셋
        let consecutiveBullish = 0;
        let consecutiveBearish = 0;
        
        // 가장 최근 완성봉부터 역순으로 연속 체크
        for (const candle of last5Candles) {
          const isBullish = candle.close > candle.open;
          const isBearish = candle.close < candle.open;
          
          if (isBullish) {
            if (consecutiveBearish > 0) break; // 음봉이 있었으면 연속 끊김
            consecutiveBullish++;
          } else if (isBearish) {
            if (consecutiveBullish > 0) break; // 양봉이 있었으면 연속 끊김
            consecutiveBearish++;
          } else {
            // 도지봉(시가=종가)은 연속 유지하지 않음
            break;
          }
        }
        
        // 5봉 연속 양봉 → 롱 진입 금지 (이미 많이 상승)
        if (consecutiveBullish >= 5 && direction === 'long') {
          console.log(`🚫 [5봉필터] ${symbol} 5봉 연속 양봉 → 롱 진입 금지 (과매수)`);
          return;
        }
        
        // 5봉 연속 음봉 → 숏 진입 금지 (이미 많이 하락)
        if (consecutiveBearish >= 5 && direction === 'short') {
          console.log(`🚫 [5봉필터] ${symbol} 5봉 연속 음봉 → 숏 진입 금지 (과매도)`);
          return;
        }
      }
    } catch (err) {
      console.warn('5봉 필터 확인 실패:', err);
    }

    // 🆕 필터 간소화: ADX, 거래량, RSI, MACD, 볼린저 필터 제거
    // 변동폭 + DTFX 조합만 사용

    console.log(`🎯 [시그널] ${symbol} ${direction} (${strength})`);
    
    // AI 분석은 useEffect에서 pendingSignal 변경 시 자동 실행됨
    
    // 시그널만 표시 (자동 진입 없음 - 수동 진입용)
    setState(prev => ({
      ...prev,
      pendingSignal: {
        symbol,
        direction,
        strength,
        reasons,
        signalTime: Date.now(),
        signalPrice: price,
        indicators,
      },
      statusMessage: `🎯 ${symbol.replace('USDT', '')} ${direction === 'long' ? '롱' : '숏'} 시그널 (${strength})`,
    }));

  }, [state.isEnabled, state.currentPosition, state.pendingSignal, user, balanceUSD]);

  // ===== 수동 청산 =====
  const manualClosePosition = useCallback(async () => {
    console.log(`🔴 [수동 청산] 버튼 클릭! processingRef=${processingRef.current}`);
    
    // processingRef가 stuck되어 있으면 강제 해제
    if (processingRef.current) {
      console.log(`⚠️ [수동 청산] processingRef가 true로 stuck! 강제 해제`);
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
    
    // state와 ref 둘 다 체크
    const position = currentPositionRef.current || state.currentPosition;
    
    if (!position) {
      console.log(`⚠️ [수동 청산] 로컬 포지션 없음, 바이낸스 직접 조회`);
      // 포지션이 없어도 바이낸스에서 직접 조회해서 청산 시도
      await closePositionMarket('cancel', 0, true);
      return;
    }

    try {
      console.log(`🔴 [수동 청산] ${position.symbol} 포지션 조회 중...`);
      const positions = await getPositions(position.symbol);
      const actualPosition = positions?.find((p: any) =>
        p.symbol === position.symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );

      const currentPrice = actualPosition
        ? parseFloat((actualPosition as any).markPrice || (actualPosition as any).entryPrice || '0')
        : position.avgPrice;

      console.log(`🔴 [수동 청산] ${position.symbol} 청산 실행, 가격=${currentPrice}`);
      await closePositionMarket('cancel', currentPrice, true);
    } catch (error) {
      console.error('수동 청산 실패:', error);
      // 에러 발생해도 processingRef 해제
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [state.currentPosition, closePositionMarket, getPositions]);

  // ===== 진입 대기 중 취소 =====
  const cancelEntry = useCallback(async () => {
    const currentPos = currentPositionRef.current;
    if (!currentPos || currentPos.entryPhase !== 'waiting') {
      console.log('취소할 주문이 없습니다');
      return;
    }

    try {
      console.log(`🚫 [수동취소] ${currentPos.symbol} 미체결 주문 취소`);

      // 미체결 주문 취소
      await cancelPendingOrders(currentPos.symbol);

      // 상태 초기화
      setState(prev => ({
        ...prev,
        currentPosition: null,
        currentSymbol: null,
        entryOrderIds: [],
        entryStartTime: null,
        statusMessage: '🔍 다음 시그널 대기...',
      }));

      addLog({
        symbol: currentPos.symbol,
        action: 'cancel',
        side: currentPos.side,
        price: 0,
        quantity: 0,
        reason: '수동 취소',
      });

      console.log(`🚫 ${currentPos.symbol.replace('USDT', '')} 진입 취소`);
    } catch (error) {
      console.error('진입 취소 실패:', error);
    }
  }, [cancelPendingOrders, addLog]);

  // ===== 수동 시장가 진입 (잔고 퍼센트 기반) =====
  const manualMarketEntry = useCallback(async (symbol: string, direction: 'long' | 'short', balancePercent: number = 98) => {
    console.log(`📌 [manualMarketEntry] 호출됨: ${symbol} ${direction} (${balancePercent}%)`);
    console.log(`📌 [manualMarketEntry] isEnabled: ${state.isEnabled}, currentPosition: ${!!state.currentPosition}, user: ${!!user}`);
    
    // 스캔 활성화 체크 제거 - 수동 진입은 언제든 가능해야 함
    if (state.currentPosition) {
      console.log('이미 포지션이 있습니다');
      return;
    }
    if (!user) {
      console.log('로그인이 필요합니다');
      return;
    }
    if (processingRef.current) {
      console.log('처리 중입니다');
      return;
    }
    
    // 잔고 부족 체크
    console.log(`💰 [잔고 체크] balanceUSD: ${balanceUSD}`);
    if (!balanceUSD || balanceUSD <= 0) {
      console.log('❌ [잔고 부족] 토스트 표시');
      toast.error('⚡ INSUFFICIENT_FUNDS', {
        description: 'Credits depleted. Deposit required to continue trading.',
        duration: 5000,
        position: 'bottom-right',
      });
      return;
    }
    
    console.log(`🚀 [manualMarketEntry] 주문 시작: ${symbol} ${direction} (${balancePercent}%)`);
    processingRef.current = true;
    // 🆕 수동 진입 시 대기 중인 DTFX 시그널 클리어
    setState(prev => ({ 
      ...prev, 
      isProcessing: true, 
      pendingDTFXSignal: null,
      statusMessage: `⏳ ${symbol} ${direction === 'long' ? '롱' : '숏'} 시장가 진입 중...` 
    }));

    try {
      initAudio();
      const precision = await fetchSymbolPrecision(symbol);
      
      // 레버리지 설정 (중요!)
      let appliedLeverage = leverage;
      const leverageCandidates = Array.from(
        new Set([leverage, 10, 5, 3, 2, 1].filter((v) => v <= leverage))
      );

      for (const lev of leverageCandidates) {
        try {
          const res = await setLeverage(symbol, lev);
          appliedLeverage = lev;
          if (!res?.alreadySet) {
            console.log(`🧲 [Leverage] ${symbol} 적용: ${lev}x`);
          }
          break;
        } catch (levError: any) {
          console.warn(`레버리지 설정 실패(${lev}x):`, levError?.message);
          continue;
        }
      }
      
      // 잔고 퍼센트 기반 수량 계산 (분할 없음 - 1회 진입)
      const positionSizeRatio = balancePercent / 100;
      const positionValueUSD = balanceUSD * positionSizeRatio * appliedLeverage;
      
      // 현재가 조회
      const tickerRes = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
      const tickerData = await tickerRes.json();
      const currentPrice = parseFloat(tickerData.price);
      
      if (!currentPrice || currentPrice <= 0) {
        throw new Error('현재가 조회 실패');
      }
      
      // 전체 수량 계산
      const rawTotalQuantity = positionValueUSD / currentPrice;
      const quantity = roundQuantity(rawTotalQuantity, precision);
      const actualTotalValue = quantity * currentPrice;
      
      console.log(`💰 [시장가 계산] balanceUSD=${balanceUSD.toFixed(2)} × ${balancePercent}% × ${appliedLeverage}x = ${positionValueUSD.toFixed(2)} USDT`);
      console.log(`📊 [시장가 수량] rawQty=${rawTotalQuantity.toFixed(4)} → ${quantity} (${actualTotalValue.toFixed(2)} USDT)`);
      
      // 최소 주문 검증
      const notional = quantity * currentPrice;
      if (notional < precision.minNotional) {
        toast.error('⚡ MIN_NOTIONAL_ERROR', {
          description: `Order value ${notional.toFixed(2)} USDT below minimum ${precision.minNotional} USDT`,
          duration: 4000,
          position: 'bottom-right',
        });
        throw new Error(`최소 주문 금액 부족: ${notional.toFixed(2)} USDT`);
      }
      
      if (quantity <= 0) {
        toast.error('⚡ ZERO_QUANTITY_ERROR', {
          description: 'Calculated quantity is zero. Check balance.',
          duration: 4000,
          position: 'bottom-right',
        });
        return;
      }
      
      const orderSide = direction === 'long' ? 'BUY' : 'SELL';
      
      console.log(`🚀 [수동 시장가] ${symbol} ${direction} ${quantity} (${balancePercent}%)`);
      
      // 1회 주문 실행 (분할 없음)
      let totalFilledQty = 0;
      let totalFilledValue = 0;
      let successCount = 0;
      
      try {
        const result = await placeMarketOrder(symbol, orderSide, quantity, false, currentPrice);
        
        if (result && !result.error) {
          const filledQty = parseFloat(result.executedQty || String(quantity));
          const filledPrice = parseFloat(result.avgPrice || String(currentPrice));
          totalFilledQty += filledQty;
          totalFilledValue += filledQty * filledPrice;
          successCount++;
          console.log(`  ✅ 체결: ${filledQty} @ ${filledPrice}`);
        } else {
          console.warn(`  ❌ 체결 실패:`, result?.error);
        }
      } catch (orderError: any) {
        console.error(`  ❌ 주문 오류:`, orderError.message);
      }
      
      if (successCount === 0 || totalFilledQty === 0) {
        throw new Error('모든 주문이 실패했습니다');
      }
      
      // 바이낸스 실제 포지션 조회하여 정확한 데이터 사용
      await new Promise(resolve => setTimeout(resolve, 500));
      const positions = await getPositions(symbol);
      const actualPosition = positions?.find((p: any) =>
        p.symbol === symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );
      
      let finalQty = totalFilledQty;
      let finalAvgPrice = totalFilledValue / totalFilledQty;
      let unrealizedPnl = 0;
      let markPrice = currentPrice;
      
      if (actualPosition) {
        finalQty = Math.abs(parseFloat(actualPosition.positionAmt));
        finalAvgPrice = parseFloat(actualPosition.entryPrice);
        unrealizedPnl = parseFloat(actualPosition.unRealizedProfit || '0');
        markPrice = parseFloat(actualPosition.markPrice || String(currentPrice));
        console.log(`📊 [바이낸스 포지션 확인] 수량=${finalQty} 평단=${finalAvgPrice} PnL=$${unrealizedPnl.toFixed(2)}`);
      }
      
      // 진입 사운드 삭제됨
      
      // ===== 바이낸스에 TAKE_PROFIT_MARKET 주문 설정 (손절 제거됨) =====
      const closeSide = direction === 'long' ? 'SELL' : 'BUY';
      const positionSide =
        (actualPosition?.positionSide && actualPosition.positionSide !== 'BOTH')
          ? (actualPosition.positionSide as 'LONG' | 'SHORT')
          : undefined;
      const positionValueUsd = finalAvgPrice * finalQty;
      
      const targetTakeProfitUsdt = filterSettings?.takeProfitUsdt ?? 7;
      const tpPercent = (targetTakeProfitUsdt / positionValueUsd) * 100;
      
      let tpPrice: number;
      if (direction === 'long') {
        tpPrice = finalAvgPrice * (1 + tpPercent / 100);
      } else {
        tpPrice = finalAvgPrice * (1 - tpPercent / 100);
      }
      
      console.log(`📊 [TP 설정] 포지션가치=$${positionValueUsd.toFixed(2)} | TP=$${targetTakeProfitUsdt}→${tpPrice.toFixed(4)}`);
      
      // TAKE_PROFIT_MARKET 주문
      try {
        const tpResult = await placeTakeProfitMarketOrder(symbol, closeSide, finalQty, tpPrice, positionSide);
        if (tpResult && !tpResult.error) {
          console.log(`✅ [TAKE_PROFIT_MARKET] 설정 완료! 익절가=${tpPrice.toFixed(4)}`);
        }
      } catch (tpError: any) {
        console.warn(`❌ TAKE_PROFIT_MARKET 실패:`, tpError?.message);
      }
      
      // 포지션 상태 저장 (바이낸스 실제 데이터 기준)
      const newPosition: LimitOrderPosition = {
        symbol,
        side: direction,
        entries: [{
          price: finalAvgPrice,
          quantity: finalQty,
          orderId: 'manual-market',
          status: 'FILLED',
          filled: finalQty,
          timestamp: Date.now(),
        }],
        filledQuantity: finalQty,
        totalQuantity: finalQty,
        avgPrice: finalAvgPrice,
        startTime: Date.now(),
        entryPhase: 'active',
        takeProfitOrders: [],
        unrealizedPnl,
        markPrice,
      };
      
      currentPositionRef.current = newPosition;
      lastSyncedPositionRef.current = `${symbol}-${direction}-${finalQty.toFixed(6)}`;
      
      setState(prev => ({
        ...prev,
        currentPosition: newPosition,
        currentSymbol: symbol,
        statusMessage: `✅ ${symbol} ${direction === 'long' ? '롱' : '숏'} 진입 완료 (TP 설정됨)`,
        isProcessing: false,
      }));
      
      addLog({
        symbol,
        action: 'fill',
        side: direction,
        price: finalAvgPrice,
        quantity: finalQty,
        reason: `수동 시장가 진입 (${balancePercent}%) + SL/TP`,
      });
      
      toast.success(`${symbol.replace('USDT', '')} ${direction === 'long' ? '롱' : '숏'} 체결`, {
        description: `${balancePercent}% 시장가 진입 완료 (SL/TP 설정됨)`,
      });
      console.log(`🚀 ${symbol.replace('USDT', '')} ${direction === 'long' ? '롱' : '숏'} 체결! SL/TP 자동 설정됨`);
      
    } catch (error: any) {
      console.error('수동 진입 실패:', error);
      const errorMsg = error?.message || '주문 처리 중 오류가 발생했습니다';
      toast.error('시장가 주문 실패', {
        description: errorMsg,
      });
      setState(prev => ({
        ...prev,
        isProcessing: false,
        statusMessage: '🔍 시그널 스캔 중...',
      }));
    } finally {
      processingRef.current = false;
    }
  }, [state.currentPosition, user, balanceUSD, leverage, placeMarketOrder, setLeverage, filterSettings, addLog, getPositions, placeStopMarketOrder, placeTakeProfitMarketOrder]);

  // ===== 수동 지정가 진입 (잔고 퍼센트 기반) =====
  const manualLimitEntry = useCallback(async (symbol: string, direction: 'long' | 'short', price: number, balancePercent: number = 98) => {
    console.log(`📌 [manualLimitEntry] 호출됨: ${symbol} ${direction} @ ${price} (${balancePercent}%)`);
    console.log(`📌 [manualLimitEntry] 상태 체크: user=${!!user}, balanceUSD=${balanceUSD}, processing=${processingRef.current}`);
    
    if (!user) {
      console.log('❌ [manualLimitEntry] 로그인이 필요합니다');
      toast.error('⚡ LOGIN_REQUIRED', {
        description: 'Please login to place orders.',
        duration: 3000,
        position: 'bottom-right',
      });
      return;
    }
    const existing = state.currentPosition;
    if (existing && (existing.symbol !== symbol || existing.side !== direction)) {
      console.log('❌ [manualLimitEntry] 다른 포지션이 있어 추가 진입 불가');
      toast.error('⚡ POSITION_EXISTS', {
        description: 'Close existing position first.',
        duration: 3000,
        position: 'bottom-right',
      });
      return;
    }
    if (processingRef.current) {
      console.log('❌ [manualLimitEntry] 이미 처리 중입니다');
      toast.warning('⚡ PROCESSING', {
        description: 'Order already in progress.',
        duration: 2000,
        position: 'bottom-right',
      });
      return;
    }
    
    // 잔고 부족 체크
    console.log(`💰 [잔고 체크] balanceUSD: ${balanceUSD}`);
    if (!balanceUSD || balanceUSD <= 0) {
      console.log('❌ [잔고 부족] 토스트 표시');
      toast.error('⚡ INSUFFICIENT_FUNDS', {
        description: 'Credits depleted. Deposit required to continue trading.',
        duration: 5000,
        position: 'bottom-right',
      });
      return;
    }
    
    processingRef.current = true;
    setState(prev => ({
      ...prev,
      isProcessing: true,
      statusMessage: `⏳ ${symbol} ${existing ? '추가 진입' : ''} 지정가 주문 중...`,
    }));

    try {
      initAudio();
      
      // 심볼 정밀도 조회
      const precision = await fetchSymbolPrecision(symbol);
      
      // 레버리지 설정 (중요!)
      let appliedLeverage = leverage;
      const leverageCandidates = Array.from(
        new Set([leverage, 10, 5, 3, 2, 1].filter((v) => v <= leverage))
      );

      for (const lev of leverageCandidates) {
        try {
          const res = await setLeverage(symbol, lev);
          appliedLeverage = lev;
          if (!res?.alreadySet) {
            console.log(`🧲 [Leverage] ${symbol} 적용: ${lev}x`);
          }
          break;
        } catch (levError: any) {
          const msg = levError?.message || String(levError);
          console.warn(`레버리지 설정 실패(${lev}x):`, msg);
          continue;
        }
      }

      if (appliedLeverage !== leverage) {
        console.warn(`⚠️ 레버리지 ${leverage}x → ${appliedLeverage}x로 적용됨`);
      }
      
      // 잔고 퍼센트 기반 포지션 사이즈 계산 (분할 없음)
      const positionSizeRatio = balancePercent / 100;
      const positionValueUSD = balanceUSD * positionSizeRatio * appliedLeverage;
      const rawTotalQuantity = positionValueUSD / price;

      const roundedPrice = roundPrice(price, precision);
      const quantity = roundQuantity(rawTotalQuantity, precision);
      const actualTotalValue = quantity * roundedPrice;

      console.log(`💰 [지정가 계산] balanceUSD=${balanceUSD.toFixed(2)} × ${balancePercent}% × ${appliedLeverage}x = ${positionValueUSD.toFixed(2)} USDT`);
      console.log(`📊 [지정가 수량] rawQty=${rawTotalQuantity.toFixed(4)} → ${quantity} (${actualTotalValue.toFixed(2)} USDT)`);

      const notional = quantity * roundedPrice;
      if (notional < precision.minNotional) {
        toast.error('⚡ MIN_NOTIONAL_ERROR', {
          description: `Order value ${notional.toFixed(2)} USDT below minimum ${precision.minNotional} USDT`,
          duration: 4000,
          position: 'bottom-right',
        });
        throw new Error(`최소 주문 금액 부족: ${notional.toFixed(2)} USDT`);
      }

      if (quantity <= 0) {
        toast.error('⚡ ZERO_QUANTITY_ERROR', {
          description: 'Calculated quantity is zero. Check balance.',
          duration: 4000,
          position: 'bottom-right',
        });
        return;
      }

      console.log(
        `📊 지정가 주문: ${symbol} ${direction} @ ${roundedPrice}, qty: ${quantity} (레버리지: ${appliedLeverage}x)`
      );

      // 1회 지정가 주문 실행 (분할 없음)
      const result = await placeLimitOrder(
        symbol,
        direction === 'long' ? 'BUY' : 'SELL',
        quantity,
        roundedPrice,
        false
      );

      if (!result) {
        throw new Error('주문 응답이 없습니다');
      }

      addLog({
        symbol,
        action: 'order',
        side: direction,
        price: roundedPrice,
        quantity: quantity,
        reason: `수동 지정가 주문 (${balancePercent}%) @ ${roundedPrice}`,
      });

      // 진입 사운드 삭제됨
      toast.success(`${symbol.replace('USDT', '')} 지정가 주문 완료`, {
        description: `${direction === 'long' ? '롱' : '숏'} ${balancePercent}% @ ${roundedPrice}`,
      });
      console.log(`📝 ${symbol.replace('USDT', '')} ${direction === 'long' ? '롱' : '숏'} 지정가 주문 완료! @ ${roundedPrice}`);

      setState(prev => ({
        ...prev,
        isProcessing: false,
        statusMessage: `📝 ${symbol} 지정가 대기 중...`,
      }));
    } catch (error: any) {
      console.error('지정가 주문 실패:', error);
      const errorMsg = error?.message || '주문 처리 중 오류가 발생했습니다';
      toast.error('지정가 주문 실패', {
        description: errorMsg,
      });
      setState(prev => ({
        ...prev,
        isProcessing: false,
        statusMessage: '🔍 시그널 스캔 중...',
      }));
    } finally {
      processingRef.current = false;
    }
  }, [state.currentPosition, user, balanceUSD, leverage, placeLimitOrder, addLog]);

  // ===== 익절 설정 변경 시 바이낸스 TP 주문 업데이트 (손절 제거됨) =====
  const prevTpRef = useRef<number | null>(null);
  
  useEffect(() => {
    let isMounted = true;
    
    const currentTp = filterSettings?.takeProfitUsdt ?? 7;
    
    // 초기 로드 시 값 저장만 하고 리턴
    if (prevTpRef.current === null) {
      prevTpRef.current = currentTp;
      return;
    }
    
    // 설정 변경 감지
    const tpChanged = prevTpRef.current !== currentTp;
    
    if (!tpChanged) return;
    
    // 활성 포지션이 있을 때만 업데이트
    const position = currentPositionRef.current;
    if (!position || position.entryPhase !== 'active') {
      prevTpRef.current = currentTp;
      return;
    }
    
    // 처리 중이면 스킵
    if (processingRef.current) return;
    
    // 비동기로 TP 업데이트 실행
    const updateTpOrders = async () => {
      console.log(`🔄 [TP 변경 감지] TP: $${prevTpRef.current} → $${currentTp}`);
      prevTpRef.current = currentTp;
      
      try {
        // 기존 TP 주문만 취소
        console.log(`🚫 [TP 업데이트] ${position.symbol} 기존 TP 주문 취소 중...`);
        const openOrders = await getOpenOrders(position.symbol);
        const tpTypes = new Set(['TAKE_PROFIT_MARKET', 'TAKE_PROFIT']);
        const tpOrders = (openOrders || []).filter((o: any) => {
          const t = String(o?.type || o?.origType || '').toUpperCase();
          return tpTypes.has(t);
        });

        for (const o of tpOrders) {
          const orderIdNum = Number(o.orderId);
          if (!Number.isFinite(orderIdNum)) continue;
          try {
            await cancelOrder(position.symbol, orderIdNum);
          } catch (e) {
            // 이미 취소된 경우 등은 무시
          }
        }

        if (!isMounted) return;

        // 잠시 대기 (취소 반영)
        await new Promise(resolve => setTimeout(resolve, 250));

        if (!isMounted) return;

        // 실제 포지션 조회
        const positions = await getPositions(position.symbol);

        if (!isMounted) return;

        const actualPosition = positions?.find((p: any) =>
          p.symbol === position.symbol && Math.abs(parseFloat(p.positionAmt)) > 0
        );

        if (!actualPosition) {
          console.log(`⚠️ [TP 업데이트] ${position.symbol} 포지션 없음, 스킵`);
          return;
        }

        const qty = Math.abs(parseFloat(actualPosition.positionAmt));
        const avgPrice = parseFloat(actualPosition.entryPrice);
        const closeSide = position.side === 'long' ? 'SELL' : 'BUY';
        const positionSide =
          (actualPosition.positionSide && actualPosition.positionSide !== 'BOTH')
            ? (actualPosition.positionSide as 'LONG' | 'SHORT')
            : undefined;
        const positionValueUsd = avgPrice * qty;

        // 새 익절가 계산
        const tpPercent = (currentTp / positionValueUsd) * 100;
        let tpPrice: number;

        if (position.side === 'long') {
          tpPrice = avgPrice * (1 + tpPercent / 100);
        } else {
          tpPrice = avgPrice * (1 - tpPercent / 100);
        }

        console.log(`📊 [새 TP] 포지션가치=$${positionValueUsd.toFixed(2)} | TP=$${currentTp}→${tpPrice.toFixed(4)}`);

        if (!isMounted) return;

        // 새 TAKE_PROFIT_MARKET 주문
        try {
          const tpResult = await placeTakeProfitMarketOrder(position.symbol, closeSide, qty, tpPrice, positionSide);
          if (isMounted && tpResult && !tpResult.error) {
            console.log(`✅ [TAKE_PROFIT_MARKET] 재설정 완료! 익절가=${tpPrice.toFixed(4)}`);
          }
        } catch (tpError: any) {
          const msg = tpError?.message || '익절 주문 재설정 실패';
          console.warn(`❌ TAKE_PROFIT_MARKET 재설정 실패:`, msg);
        }

        if (!isMounted) return;

        setState(prev => ({
          ...prev,
          statusMessage: `✅ TP 업데이트 완료!`,
        }));

      } catch (error: any) {
        console.error('[TP 업데이트 오류]', error);
      }
    };
    
    updateTpOrders();
    
    return () => {
      isMounted = false;
    };
  }, [filterSettings?.takeProfitUsdt, getPositions, placeTakeProfitMarketOrder, getOpenOrders, cancelOrder]);

  // ===== Cleanup =====
  // (레거시 타임아웃 로직 제거됨)

  // ===== DTFX OTE 구간 체크 및 확인 대기 (자동 진입 → 사용자 확인 방식으로 변경) =====
  const checkDTFXOTEAndEntry = useCallback(async (symbol: string, currentPrice: number) => {
    // DTFX 모드가 활성화되어 있지 않으면 스킵
    if (!filterSettings?.dtfxEnabled) return null;
    if (!state.isEnabled) return null;
    if (state.currentPosition) return null;
    if (state.pendingDTFXSignal) return null; // 이미 대기 중인 시그널이 있으면 스킵
    if (processingRef.current) return null;
    if (!user) return null;

    // 쿨다운 체크 (마지막 체크 후 5초)
    const now = Date.now();
    if (state.dtfxLastCheck && now - state.dtfxLastCheck < 5000) {
      return null;
    }

    try {
      // 1분봉 데이터 조회 (스캘핑용)
      const klines = await fetch1mKlinesForDTFX(symbol, 100);
      if (!klines || klines.length < 30) {
        console.log(`📊 [DTFX] ${symbol} - 캔들 데이터 부족 (${klines?.length || 0}개)`);
        return null;
      }

      // DTFX 분석 실행
      const dtfxData = analyzeDTFX(klines);
      
      // 존이 없으면 스킵
      if (dtfxData.zones.length === 0) {
        console.log(`📊 [DTFX] ${symbol} @ ${currentPrice} - 존 형성 안됨 (스윙: ${dtfxData.swingPoints.length}개, 구조: ${dtfxData.structureShifts.length}개)`);
        setState(prev => ({ ...prev, dtfxZones: [], dtfxLastCheck: now }));
        return null;
      }

      // OTE 구간 진입 시그널 체크
      const oteSignal = checkDTFXOTEEntry(currentPrice, dtfxData.zones);
      
      // 존 정보 로깅
      const activeZones = dtfxData.zones.map(z => 
        `${z.type}(${z.levels.find(f => f.value === 0.618)?.price.toFixed(2)}~${z.levels.find(f => f.value === 0.705)?.price.toFixed(2)})`
      ).join(', ');
      console.log(`📊 [DTFX] ${symbol} @ ${currentPrice} - 존 ${dtfxData.zones.length}개: ${activeZones}`);
      
      setState(prev => ({ 
        ...prev, 
        dtfxZones: dtfxData.zones, 
        dtfxLastCheck: now,
      }));

      if (oteSignal.direction && oteSignal.zone) {
        const zoneType = oteSignal.zone.type;
        const entryRatio = oteSignal.entryRatio || 0;
        
        console.log(`🎯 [DTFX OTE] ${symbol} ${oteSignal.direction} @ ${currentPrice} (${(entryRatio * 100).toFixed(1)}% 레벨, ${zoneType} Zone)`);

        setState(prev => ({
          ...prev,
          pendingDTFXSignal: {
            symbol,
            direction: oteSignal.direction!,
            entryRatio,
            zoneType,
            currentPrice,
            timestamp: now,
          },
        }));
        
        // 토스트로 알림
        toast.info(`DTFX 진입 시그널 감지!`, {
          description: `${symbol.replace('USDT', '')} ${oteSignal.direction === 'long' ? '롱' : '숏'} - 확인 버튼을 눌러 진입하세요`,
        });
        
        return oteSignal;
      } else {
        console.log(`📊 [DTFX] ${symbol} @ ${currentPrice} - OTE 구간 밖 (진입 대기중)`);
      }

      return null;
    } catch (error) {
      console.error('[DTFX OTE 체크 오류]', error);
      return null;
    }
  }, [filterSettings?.dtfxEnabled, state.isEnabled, state.currentPosition, state.pendingDTFXSignal, state.dtfxLastCheck, user]);

  // DTFX 시그널 확인 후 진입
  const confirmDTFXEntry = useCallback(async () => {
    if (!state.pendingDTFXSignal) return;
    
    const { symbol, direction } = state.pendingDTFXSignal;
    
    // 시그널 클리어
    setState(prev => ({ ...prev, pendingDTFXSignal: null }));
    
    // 1분할 시장가 진입 실행
    await manualMarketEntry(symbol, direction, 1);
  }, [state.pendingDTFXSignal, manualMarketEntry]);

  // DTFX 시그널 스킵
  const skipDTFXSignal = useCallback(() => {
    setState(prev => ({ ...prev, pendingDTFXSignal: null }));
    toast.info('DTFX 시그널 스킵', { description: '다음 시그널을 기다립니다' });
  }, []);

  // 수동 손절가 설정 (차트에서 드래그로 설정 시 호출)
  const setManualStopLoss = useCallback(async (slPrice: number | null) => {
    if (!user) return;
    if (!state.currentPosition) {
      console.log('[수동 손절] 포지션 없음 - 무시');
      return;
    }

    const { symbol, side, totalQuantity } = state.currentPosition;
    const closeSide = side === 'long' ? 'SELL' : 'BUY';
    const positionSide = side === 'long' ? 'LONG' : 'SHORT';

    try {
      // 기존 STOP_MARKET 주문 취소
      const openOrders = await getOpenOrders(symbol);
      const slTypes = new Set(['STOP_MARKET', 'STOP']);
      const slOrders = (openOrders || []).filter((o: any) => {
        const t = String(o?.type || o?.origType || '').toUpperCase();
        return slTypes.has(t);
      });

      for (const o of slOrders) {
        const orderIdNum = Number(o.orderId);
        if (!Number.isFinite(orderIdNum)) continue;
        try {
          await cancelOrder(symbol, orderIdNum);
          console.log(`[수동 손절] 기존 SL 주문 취소: ${orderIdNum}`);
        } catch {
          // ignore
        }
      }

      // 손절가가 null이면 취소만 하고 종료
      if (!slPrice) {
        console.log('[수동 손절] 손절가 제거됨');
        toast.info('⚡ SL_REMOVED', { 
          description: `${symbol.replace('USDT', '')} 손절 주문 취소됨`,
          className: 'font-mono uppercase',
        });
        return;
      }

      // 잠시 대기 (취소 반영)
      await new Promise(r => setTimeout(r, 150));

      // 새 STOP_MARKET 주문 배치
      await placeStopMarketOrder(symbol, closeSide, totalQuantity, slPrice, positionSide as 'LONG' | 'SHORT');
      console.log(`[수동 손절] SL 주문 배치: ${symbol} ${closeSide} @ ${slPrice}`);
      
      toast.success('⚡ SL_SET', {
        description: `${symbol.replace('USDT', '')} SL @ $${slPrice.toFixed(4)}`,
        className: 'font-mono uppercase',
      });
    } catch (error: any) {
      console.error('[수동 손절] 오류:', error);
      toast.error('⚡ SL_ERROR', {
        description: error?.message || '손절 주문 실패',
        className: 'font-mono uppercase',
      });
    }
  }, [user, state.currentPosition, getOpenOrders, cancelOrder, placeStopMarketOrder]);

  // 수동 익절 설정 (차트에서 드래그로 설정한 TP를 바이낸스에 TAKE_PROFIT_MARKET 주문으로 배치)
  const setManualTakeProfit = useCallback(async (tpPrice: number | null) => {
    if (!user) return;
    if (!state.currentPosition) return;

    const position = state.currentPosition;
    const { symbol, side, filledQuantity: totalQuantity } = position;
    const closeSide = side === 'long' ? 'SELL' : 'BUY';
    const positionSide = side === 'long' ? 'LONG' : 'SHORT';

    try {
      // 기존 TP 주문 취소
      const openOrders = await getOpenOrders(symbol);
      const tpTypes = new Set(['TAKE_PROFIT_MARKET', 'TAKE_PROFIT']);
      const tpOrders = (openOrders || []).filter((o: any) => {
        const t = String(o?.type || o?.origType || '').toUpperCase();
        return tpTypes.has(t);
      });

      for (const o of tpOrders) {
        const orderIdNum = Number(o.orderId);
        if (!Number.isFinite(orderIdNum)) continue;
        try {
          await cancelOrder(symbol, orderIdNum);
          console.log(`[수동 익절] 기존 TP 주문 취소: ${orderIdNum}`);
        } catch {
          // ignore
        }
      }

      // 익절가가 null이면 취소만 하고 종료
      if (!tpPrice) {
        console.log('[수동 익절] 익절가 제거됨');
        toast.info('⚡ TP_REMOVED', { 
          description: `${symbol.replace('USDT', '')} 익절 주문 취소됨`,
          className: 'font-mono uppercase',
        });
        return;
      }

      // 잠시 대기 (취소 반영)
      await new Promise(r => setTimeout(r, 150));

      // 새 TAKE_PROFIT_MARKET 주문 배치
      await placeTakeProfitMarketOrder(symbol, closeSide, totalQuantity, tpPrice, positionSide as 'LONG' | 'SHORT');
      console.log(`[수동 익절] TP 주문 배치: ${symbol} ${closeSide} @ ${tpPrice}`);
      
      toast.success('⚡ TP_SET', {
        description: `${symbol.replace('USDT', '')} TP @ $${tpPrice.toFixed(4)}`,
        className: 'font-mono uppercase',
      });
    } catch (error: any) {
      console.error('[수동 익절] 오류:', error);
      toast.error('⚡ TP_ERROR', {
        description: error?.message || '익절 주문 실패',
        className: 'font-mono uppercase',
      });
    }
  }, [user, state.currentPosition, getOpenOrders, cancelOrder, placeTakeProfitMarketOrder]);

  return {
    state,
    toggleAutoTrading,
    toggleAiAnalysis,
    handleTechnicalSignal,
    checkTpSl,
    closePosition: manualClosePosition,
    cancelEntry,
    manualMarketEntry,
    manualLimitEntry,
    manualAnalyzeMarket,
    addLog,
    checkDTFXOTEAndEntry,
    confirmDTFXEntry,
    skipDTFXSignal,
    setManualStopLoss,
    setManualTakeProfit,
  };
}
