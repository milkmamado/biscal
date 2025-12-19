/**
 * 고급 스캘핑 자동매매 시스템
 * - 기술적 지표 기반 진입
 * - 3단계 익절 + 트레일링 스탑
 * - 적응형 손절
 * - 리스크 관리
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useBinanceApi } from './useBinanceApi';
import { useAuth } from './useAuth';
import { fetchSymbolPrecision, roundQuantity } from '@/lib/binance';
import { playEntrySound, playTpSound, playSlSound, initAudio } from '@/lib/sounds';
import { toast } from 'sonner';
import {
  calculateAllIndicators,
  checkLongSignal,
  checkShortSignal,
  fetch5mKlines,
  fetch1mKlines,
  TechnicalIndicators,
  Kline,
} from './useTechnicalIndicators';

export interface AutoTradeLog {
  id: string;
  timestamp: number;
  symbol: string;
  action: 'entry' | 'exit' | 'tp' | 'sl' | 'error' | 'pending' | 'cancel' | 'partial_tp';
  side: 'long' | 'short';
  price: number;
  quantity: number;
  pnl?: number;
  reason: string;
}

// 대기 중인 시그널
interface PendingSignal {
  symbol: string;
  direction: 'long' | 'short';
  strength: 'weak' | 'medium' | 'strong';
  reasons: string[];
  signalTime: number;
  signalPrice: number;
  indicators: TechnicalIndicators;
  confirmCount: number; // 확인 봉 횟수
}

// 익절 상태 (단순화)
interface TakeProfitState {
  tpHit: boolean; // 익절 완료 여부
  breakEvenActivated: boolean; // 브레이크이븐 활성화 여부
  breakEvenActivatedAt: number | null; // 브레이크이븐 활성화 시간
}

// 코인별 연속 손절 기록
interface CoinLossRecord {
  lastLossTime: number;
  consecutiveLosses: number;
  cooldownUntil: number;
}

// 포지션 정보
interface Position {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  initialQuantity: number;
  remainingQuantity: number;
  entryTime: number;
  atr: number;
  takeProfitState: TakeProfitState;
  indicators: TechnicalIndicators;
  maxPnlPercent: number; // 최고 수익률 기록 (브레이크이븐용)
  earlySLStage: number; // 조기 손절 단계 (0: 없음, 1: 1단계 발동, 2: 2단계 발동)
  trendStrength: TrendStrength; // 🆕 진입 시점 추세 강도
  trailingActivated: boolean; // 🆕 트레일링 활성화 여부
}

export interface AutoTradingState {
  isEnabled: boolean;
  isProcessing: boolean;
  currentSymbol: string | null;
  pendingSignal: PendingSignal | null;
  currentPosition: Position | null;
  todayStats: {
    trades: number;
    wins: number;
    losses: number;
    totalPnL: number;
  };
  tradeLogs: AutoTradeLog[];
  consecutiveLosses: number;
  cooldownUntil: number | null;
  lossProtectionEnabled: boolean; // 연속 손실 보호 기능 ON/OFF
  tpPercent: number;
  statusMessage: string;
  scanningProgress: string;
}

interface UseAutoTradingProps {
  balanceUSD: number;
  leverage: number;
  krwRate: number;
  onTradeComplete?: () => void;
  initialStats?: { trades: number; wins: number; losses: number; totalPnL: number };
  logTrade?: (trade: {
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    leverage: number;
    pnlUsd: number;
  }) => Promise<void>;
}

// ⚡ HFT 스캘핑 설정값 (ETH/SOL - BTC 제외)
const CONFIG = {
  // 🎯 타겟 코인들 (BTC 제외 - 시드 부족)
  TARGET_SYMBOLS: ['ETHUSDT', 'SOLUSDT'],
  
  // 🎚️ 코인별 레버리지 설정
  LEVERAGE_BY_COIN: {
    'ETHUSDT': { default: 12, options: [10, 12, 15, 20] },
    'SOLUSDT': { default: 8, options: [5, 8, 10, 15, 20] },
  } as Record<string, { default: number; options: number[] }>,
  
  // 💰 3단계 분할 익절 시스템
  TAKE_PROFIT_LEVELS: [
    { triggerPct: 0.08, closePct: 60, timeoutSec: 30 },   // +0.08% → 60% 청산
    { triggerPct: 0.15, closePct: 30, timeoutSec: 60 },   // +0.15% → 30% 청산  
    { triggerPct: 0.28, closePct: 10, timeoutSec: 120 },  // +0.28% → 10% 청산 (러너)
  ],
  
  // ⏱️ 시간 기반 익절 (HFT 핵심)
  TIME_BASED_TP: {
    PROFIT_30S: { timeSec: 30, minProfitPct: 0.06, closePct: 50 },  // 30초 후 +0.06%면 50% 청산
    PROFIT_60S: { timeSec: 60, minProfitPct: 0.04, closePct: 50 },  // 60초 후 +0.04%면 50% 청산  
    PROFIT_90S: { timeSec: 90, minProfitPct: 0.02, closePct: 100 }, // 90초 후 +0.02%면 전량 청산
  },
  
  // 🛡️ 손절 기준 (완화됨)
  SL_PERCENT: 0.20,          // -0.20% 전량 손절 (최종 방어선) - 기존 0.06%에서 완화
  
  // ⚡ 조기 손절 (완화됨 - 진입 직후 손절 방지)
  EARLY_SL: {
    STAGE1_SEC: 20,          // 1단계: 20초 이내 (기존 10초)
    STAGE1_PERCENT: 0.10,    // -0.10% 도달 시 (기존 0.03%)
    STAGE1_REDUCE: 0.5,      // 50% 청산
    
    STAGE2_SEC: 45,          // 2단계: 45초 이내 (기존 30초)
    STAGE2_PERCENT: 0.15,    // -0.15% 도달 시 (기존 0.04%)
    STAGE2_REDUCE: 1.0,      // 전량 청산
  },
  
  // 🛡️ 브레이크이븐 시스템 (완화됨)
  BREAKEVEN_TRIGGER: 0.10,   // +0.10% 도달 시 브레이크이븐 활성화 (기존 0.05%)
  BREAKEVEN_SL: 0.02,        // 브레이크이븐 시 손절을 +0.02%로 이동 (기존 0.01%)
  BREAKEVEN_TRAIL: 0.03,     // 0.03% 간격으로 추적 (기존 0.02%)
  BREAKEVEN_TIMEOUT_SEC: 120, // 브레이크이븐 후 120초 내 TP 미도달 시 수익 확정 (기존 90초)
  
  // 🚨 오더북 긴급 탈출
  ORDERBOOK_EMERGENCY: {
    IMBALANCE_THRESHOLD: 2.5,   // 불균형 2.5배 이상 시 경고 (기존 2.0)
    EXIT_THRESHOLD: 2.5,        // 불균형 2.5배 이상 + 손실 시 즉시 탈출 (기존 2.0)
    VOLUME_DROP_THRESHOLD: 0.3, // 거래량 70% 감소 시
    SPREAD_THRESHOLD: 0.002,    // 스프레드 0.2% 이상 시 (기존 0.15%)
  },
  
  // ⏱️ 체류시간 관리 (여유있게 조정)
  HOLD_TIME: {
    MIN_SEC: 15,             // 최소 15초 (기존 10초)
    TARGET_SEC: 60,          // 평균 60초 (기존 45초)
    MAX_SEC: 180,            // 최대 3분 (기존 2분)
    MAX_PROFITABLE_SEC: 240, // 수익 시 최대 4분 (기존 3분)
    MAX_UNPROFITABLE_SEC: 120, // 손실 시 최대 2분 (기존 1.5분)
  },
  
  // 진입 후 보호 시간 (신규 추가!)
  ENTRY_PROTECTION_SEC: 10,   // 진입 후 10초간 손절 보호
  
  // 거래당 최대 손실 제한
  MAX_LOSS_PER_TRADE_USD: 0.5,
  
  // 연속 손실 관리
  MAX_CONSECUTIVE_LOSSES: 5,
  LOSS_COOLDOWN_MINUTES: 30,  // 30분 휴식
  
  // 코인별 연속 손절 방지 (SOLUSDT 전용이므로 동일)
  COIN_MAX_CONSECUTIVE_LOSSES: 3,
  COIN_COOLDOWN_MINUTES: 15,
  
  // 진입 조건 (완화)
  MIN_SIGNAL_STRENGTH: 'weak' as const,  // 약한 시그널도 진입 허용
  ENTRY_COOLDOWN_MS: 15000,  // 진입 간 쿨다운 15초로 단축
  
  // 변동성 필터 (HFT 최적)
  MIN_ATR_PERCENT: 0.5,      // 최소 0.5%
  MAX_ATR_PERCENT: 3.0,      // 최대 3.0%
  
  // 시장 환경 필터 (완화)
  MIN_ADX_FOR_TREND: 15,     // ADX 15 이상이면 진입
  
  // 오더북 요구사항
  ORDERBOOK_REQUIREMENTS: {
    BID_ASK_IMBALANCE: 1.3,  // 1.3:1 이상 불균형
    SPREAD_MAX: 0.0008,      // 0.08% 이하 스프레드
    DEPTH_MIN: 100000,       // 최소 $100K 깊이
  },
  
  // 동적 포지션 사이징
  BASE_RISK_PERCENT: 2.0,    // 기본 리스크 2%
  ATR_POSITION_MULTIPLIER: {
    LOW: 1.3,                // 낮은 변동성 → 큰 포지션
    MEDIUM: 1.0,             // 보통 변동성 → 기본 포지션
    HIGH: 0.6,               // 높은 변동성 → 작은 포지션
  },
  
  // 🎯 동적 익절 조정 (ATR 기반)
  DYNAMIC_TP_ADJUSTMENT: {
    HIGH_VOLATILITY_MULT: 1.4,  // ATR > 1.5% → 목표가 40% 확대
    LOW_VOLATILITY_MULT: 0.7,   // ATR < 0.8% → 목표가 30% 축소
  },
  
  // 레거시 호환 (사용 안함)
  TP_PERCENT: 0.08,
  TIME_STOP_MINUTES: 2,
  DYNAMIC_TP: {
    WEAK: { TP_PERCENT: 0.08, USE_TRAILING: false, TRAILING_ACTIVATION: 0.05, TRAILING_DISTANCE: 0.03 },
    MEDIUM: { TP_PERCENT: 0.15, USE_TRAILING: true, TRAILING_ACTIVATION: 0.10, TRAILING_DISTANCE: 0.04 },
    STRONG: { TP_PERCENT: 0.28, USE_TRAILING: true, TRAILING_ACTIVATION: 0.15, TRAILING_DISTANCE: 0.05 },
  },
};

// 🆕 추세 강도 판단 함수
type TrendStrength = 'WEAK' | 'MEDIUM' | 'STRONG';

function calculateTrendStrength(indicators: TechnicalIndicators, klines?: Kline[]): TrendStrength {
  const adx = indicators.adx;
  
  // 연속 캔들 카운트 (최근 5개)
  let consecutiveBullish = 0;
  let consecutiveBearish = 0;
  
  if (klines && klines.length >= 5) {
    const recent5 = klines.slice(-5);
    for (const k of recent5) {
      if (k.close > k.open) {
        consecutiveBullish++;
        consecutiveBearish = 0;
      } else {
        consecutiveBearish++;
        consecutiveBullish = 0;
      }
    }
  }
  
  const consecutiveCandles = Math.max(consecutiveBullish, consecutiveBearish);
  
  // 강한 추세: ADX 40+ AND 연속 캔들 4개+
  if (adx >= 40 && consecutiveCandles >= 4) {
    return 'STRONG';
  }
  
  // 중간 추세: ADX 30+ OR 연속 캔들 3개+
  if (adx >= 30 || consecutiveCandles >= 3) {
    return 'MEDIUM';
  }
  
  // 약한 추세
  return 'WEAK';
}

// 분 타임스탬프
function getMinuteTimestamp() {
  return Math.floor(Date.now() / 60000);
}

export function useAutoTrading({
  balanceUSD,
  leverage,
  krwRate,
  onTradeComplete,
  initialStats,
  logTrade,
}: UseAutoTradingProps) {
  const { user } = useAuth();
  const {
    placeMarketOrder,
    placeLimitOrder,
    getPositions,
    cancelAllOrders,
    setLeverage,
  } = useBinanceApi();

  const [state, setState] = useState<AutoTradingState>({
    isEnabled: false,
    isProcessing: false,
    currentSymbol: null,
    pendingSignal: null,
    currentPosition: null,
    todayStats: initialStats || { trades: 0, wins: 0, losses: 0, totalPnL: 0 },
    tradeLogs: [],
    consecutiveLosses: 0,
    cooldownUntil: null,
    lossProtectionEnabled: false, // 기본값 OFF
    tpPercent: 0.3,
    statusMessage: '자동매매 비활성화',
    scanningProgress: '',
  });

  // 초기 통계 업데이트
  useEffect(() => {
    if (initialStats) {
      setState(prev => ({
        ...prev,
        todayStats: initialStats,
      }));
    }
  }, [initialStats?.trades, initialStats?.wins, initialStats?.losses, initialStats?.totalPnL]);

  const processingRef = useRef(false);
  const lastMinuteRef = useRef(getMinuteTimestamp());
  const lastEntryTimeRef = useRef(0);
  const pendingSignalRef = useRef<PendingSignal | null>(null);
  const positionSyncRef = useRef(false);
  
  // 🆕 코인별 연속 손절 기록
  const coinLossRecordRef = useRef<Map<string, CoinLossRecord>>(new Map());

  useEffect(() => {
    pendingSignalRef.current = state.pendingSignal;
  }, [state.pendingSignal]);

  // 로그 추가
  const addLog = useCallback((log: Omit<AutoTradeLog, 'id' | 'timestamp'>) => {
    const newLog: AutoTradeLog = {
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

  // 자동매매 토글
  const toggleAutoTrading = useCallback(() => {
    setState(prev => {
      const newEnabled = !prev.isEnabled;
      if (newEnabled) {
        initAudio();
        toast.success('🤖 고급 스캘핑 시스템 시작');
      } else {
        toast.info('자동매매 중지');
      }
      return {
        ...prev,
        isEnabled: newEnabled,
        pendingSignal: null,
        statusMessage: newEnabled ? '🔍 기술적 분석 기반 스캔 중...' : '자동매매 비활성화',
        scanningProgress: '',
      };
    });
  }, []);

  // 전량 청산
  const closePosition = useCallback(async (reason: 'tp' | 'sl' | 'exit' | 'time', currentPrice: number) => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;

    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));

    const position = state.currentPosition;

    try {
      const positions = await getPositions(position.symbol);
      const actualPosition = positions?.find((p: any) =>
        p.symbol === position.symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );

      if (!actualPosition) {
        setState(prev => ({
          ...prev,
          currentPosition: null,
          currentSymbol: null,
          statusMessage: '🔍 기술적 분석 기반 스캔 중...',
        }));
        return;
      }

      const actualQty = Math.abs(parseFloat(actualPosition.positionAmt));
      const actualEntryPrice = parseFloat(actualPosition.entryPrice);

      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';
      console.log(`🔴 [closePosition] 청산 요청: ${position.symbol} ${orderSide} 수량=${actualQty} 가격=${currentPrice} 사유=${reason}`);
      
      const closeResult = await placeMarketOrder(position.symbol, orderSide, actualQty, true, currentPrice);
      console.log(`📋 [closePosition] 청산 결과:`, JSON.stringify(closeResult));

      if (!closeResult || closeResult.error) {
        console.error(`❌ [closePosition] 청산 실패: ${closeResult?.error || '응답 없음'}`);
        throw new Error(closeResult?.error || '청산 실패');
      }

      const direction = position.side === 'long' ? 1 : -1;
      const priceDiff = (currentPrice - actualEntryPrice) * direction;
      const pnl = priceDiff * actualQty;
      const isWin = pnl > 0;

      const newTotalPnL = state.todayStats.totalPnL + pnl;

      setState(prev => ({
        ...prev,
        currentPosition: null,
        currentSymbol: null,
        todayStats: {
          trades: prev.todayStats.trades + 1,
          wins: prev.todayStats.wins + (isWin ? 1 : 0),
          losses: prev.todayStats.losses + (isWin ? 0 : 1),
          totalPnL: newTotalPnL,
        },
        consecutiveLosses: isWin ? 0 : prev.consecutiveLosses + 1,
        // 연속 5손실 + 보호 기능 켜져 있을 때만 휴식
        cooldownUntil: (prev.lossProtectionEnabled && !isWin && prev.consecutiveLosses + 1 >= CONFIG.MAX_CONSECUTIVE_LOSSES) 
          ? Date.now() + CONFIG.LOSS_COOLDOWN_MINUTES * 60 * 1000 
          : prev.cooldownUntil,
        statusMessage: (prev.lossProtectionEnabled && !isWin && prev.consecutiveLosses + 1 >= CONFIG.MAX_CONSECUTIVE_LOSSES)
          ? `⏸️ 연속 ${CONFIG.MAX_CONSECUTIVE_LOSSES}손실 - ${CONFIG.LOSS_COOLDOWN_MINUTES}분 휴식`
          : `${isWin ? '✅ 익절' : '❌ 손절'} 완료! 다음 시그널 대기...`,
      }));
      
      // 🆕 코인별 연속 손절 기록 업데이트
      if (!isWin) {
        const coinRecord = coinLossRecordRef.current.get(position.symbol) || {
          lastLossTime: 0,
          consecutiveLosses: 0,
          cooldownUntil: 0,
        };
        
        coinRecord.lastLossTime = Date.now();
        coinRecord.consecutiveLosses += 1;
        
        // 같은 코인 2연속 손절 시 30분 쿨다운
        if (coinRecord.consecutiveLosses >= CONFIG.COIN_MAX_CONSECUTIVE_LOSSES) {
          coinRecord.cooldownUntil = Date.now() + CONFIG.COIN_COOLDOWN_MINUTES * 60 * 1000;
          console.log(`⏸️ [closePosition] ${position.symbol} ${CONFIG.COIN_MAX_CONSECUTIVE_LOSSES}연속 손절 → ${CONFIG.COIN_COOLDOWN_MINUTES}분 쿨다운`);
          toast.warning(`⏸️ ${position.symbol.replace('USDT', '')} ${CONFIG.COIN_MAX_CONSECUTIVE_LOSSES}연속 손절! ${CONFIG.COIN_COOLDOWN_MINUTES}분간 해당 코인 거래 중지`);
        }
        
        coinLossRecordRef.current.set(position.symbol, coinRecord);
      } else {
        // 익절 시 해당 코인 연속 손절 카운트 리셋
        const coinRecord = coinLossRecordRef.current.get(position.symbol);
        if (coinRecord) {
          coinRecord.consecutiveLosses = 0;
          coinLossRecordRef.current.set(position.symbol, coinRecord);
        }
      }
      
      // 연속 손실 경고 (보호 기능 켜져 있을 때만)
      if (state.lossProtectionEnabled && !isWin && state.consecutiveLosses + 1 >= CONFIG.MAX_CONSECUTIVE_LOSSES) {
        toast.warning(`⏸️ 연속 ${CONFIG.MAX_CONSECUTIVE_LOSSES}손실! ${CONFIG.LOSS_COOLDOWN_MINUTES}분간 자동매매 일시 중지`);
      }

      const reasonText = {
        tp: '익절',
        sl: '손절',
        exit: '수동 청산',
        time: '타임 스탑',
      }[reason];

      addLog({
        symbol: position.symbol,
        action: isWin ? 'tp' : 'sl',  // 실제 손익 기준으로 판단
        side: position.side,
        price: currentPrice,
        quantity: actualQty,
        pnl,
        reason: reasonText,
      });

      const pnlKRW = Math.round(pnl * krwRate);

      if (isWin) {
        playTpSound();
      } else {
        playSlSound();
      }

      toast[isWin ? 'success' : 'error'](
        `${isWin ? '✅' : '❌'} ${reasonText} | ${pnl >= 0 ? '+' : ''}₩${pnlKRW.toLocaleString()}`
      );

      if (logTrade) {
        logTrade({
          symbol: position.symbol,
          side: position.side,
          entryPrice: actualEntryPrice,
          exitPrice: currentPrice,
          quantity: actualQty,
          leverage,
          pnlUsd: pnl,
        });
      }

      onTradeComplete?.();
    } catch (error: any) {
      console.error('Close error:', error);
      addLog({
        symbol: position.symbol,
        action: 'error',
        side: position.side,
        price: currentPrice,
        quantity: position.remainingQuantity,
        reason: error.message || '청산 실패',
      });
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [state.currentPosition, state.todayStats, placeMarketOrder, getPositions, krwRate, leverage, addLog, onTradeComplete, logTrade]);

  // ⚡ HFT 스타일 TP/SL 체크 (3단계 분할 익절 + 시간 기반 익절)
  const checkTpSl = useCallback(async (
    currentPrice: number, 
    _tpPercent: number = 0.3, 
    _slPercent: number = 0.5, 
    currentVolumeRatio?: number,
    orderbookImbalance?: number
  ) => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;

    const position = state.currentPosition;
    const direction = position.side === 'long' ? 1 : -1;
    const priceDiff = (currentPrice - position.entryPrice) * direction;
    const pnlPercent = (priceDiff / position.entryPrice) * 100;
    const tpState = position.takeProfitState;
    
    // 진입 후 경과 시간 (초)
    const holdTimeSec = (Date.now() - position.entryTime) / 1000;
    
    // 📊 실시간 손익 로그
    const pnlRounded = Math.round(pnlPercent * 100) / 100;
    const beStatus = tpState.breakEvenActivated ? ' [BE]' : '';
    const earlySlStatus = position.earlySLStage > 0 ? ` [ESL${position.earlySLStage}]` : '';
    console.log(`⚡ [HFT] ${position.symbol} ${position.side.toUpperCase()}${beStatus}${earlySlStatus} | ${holdTimeSec.toFixed(0)}s | PnL: ${pnlRounded >= 0 ? '+' : ''}${pnlRounded.toFixed(2)}%`);
    
    // 최고 수익률 업데이트
    if (pnlPercent > position.maxPnlPercent) {
      setState(prev => {
        if (!prev.currentPosition) return prev;
        return {
          ...prev,
          currentPosition: { ...prev.currentPosition, maxPnlPercent: pnlPercent },
        };
      });
    }
    
    // 상태 메시지 업데이트
    setState(prev => ({
      ...prev,
      statusMessage: `⚡ SOL ${position.side === 'long' ? '롱' : '숏'}${beStatus} | ${holdTimeSec.toFixed(0)}s | ${pnlRounded >= 0 ? '+' : ''}${pnlRounded.toFixed(2)}%`,
    }));

    // ============================================
    // 🚨 1. 강제 청산 시간 체크 (최우선)
    // ============================================
    const { HOLD_TIME } = CONFIG;
    
    // 어떤 경우든 최대 체류시간 초과 시 강제 청산
    if (holdTimeSec >= HOLD_TIME.MAX_SEC) {
      console.log(`⏱️ [HFT] 최대 체류시간 초과! ${holdTimeSec.toFixed(0)}s >= ${HOLD_TIME.MAX_SEC}s`);
      toast.warning(`⏱️ 최대 ${HOLD_TIME.MAX_SEC}초 도달! 강제 청산`);
      await closePosition(pnlPercent > 0 ? 'tp' : 'sl', currentPrice);
      return;
    }
    
    // 손실 시 90초 이상이면 강제 청산
    if (pnlPercent < 0 && holdTimeSec >= HOLD_TIME.MAX_UNPROFITABLE_SEC) {
      console.log(`⏱️ [HFT] 손실 상태 체류시간 초과! ${holdTimeSec.toFixed(0)}s`);
      toast.warning(`⏱️ 손실 ${HOLD_TIME.MAX_UNPROFITABLE_SEC}초! 손절`);
      await closePosition('sl', currentPrice);
      return;
    }

    // ============================================
    // 🚨 2. 오더북 긴급 탈출
    // ============================================
    if (orderbookImbalance !== undefined && pnlPercent < 0) {
      const isLong = position.side === 'long';
      const dangerousImbalance = isLong 
        ? orderbookImbalance < -CONFIG.ORDERBOOK_EMERGENCY.EXIT_THRESHOLD
        : orderbookImbalance > CONFIG.ORDERBOOK_EMERGENCY.EXIT_THRESHOLD;
      
      if (dangerousImbalance) {
        console.log(`🚨 [HFT] 오더북 긴급 탈출! 불균형: ${orderbookImbalance.toFixed(1)}x`);
        toast.warning(`🚨 오더북 압력! 긴급 탈출`);
        await closePosition('sl', currentPrice);
        return;
      }
    }

    // ============================================
    // ⚡ 3. 조기 손절 (진입 보호 시간 적용)
    // ============================================
    // 🛡️ 진입 보호: 처음 10초간은 손절하지 않음
    if (holdTimeSec < CONFIG.ENTRY_PROTECTION_SEC) {
      // 진입 보호 시간 - 손절 스킵
      return;
    }
    
    if (pnlPercent < 0 && !tpState.breakEvenActivated) {
      const { EARLY_SL } = CONFIG;
      
      // 1단계: 20초 내 -0.10% → 50% 청산
      if (holdTimeSec <= EARLY_SL.STAGE1_SEC && 
          pnlPercent <= -EARLY_SL.STAGE1_PERCENT && 
          position.earlySLStage < 1) {
        console.log(`⚡ [HFT] 조기손절 1단계! ${holdTimeSec.toFixed(0)}s, ${pnlPercent.toFixed(3)}%`);
        toast.warning(`⚡ ${EARLY_SL.STAGE1_SEC}초 내 -${EARLY_SL.STAGE1_PERCENT}%! 50% 청산`);
        
        const reduceQty = position.remainingQuantity * EARLY_SL.STAGE1_REDUCE;
        const orderSide = position.side === 'long' ? 'SELL' : 'BUY';
        
        try {
          await placeMarketOrder(position.symbol, orderSide, reduceQty, true, currentPrice);
          setState(prev => {
            if (!prev.currentPosition) return prev;
            return {
              ...prev,
              currentPosition: {
                ...prev.currentPosition,
                remainingQuantity: prev.currentPosition.remainingQuantity - reduceQty,
                earlySLStage: 1,
              },
            };
          });
        } catch (err) {
          console.error('조기 손절 1단계 실패:', err);
        }
        return;
      }
      
      // 2단계: 45초 내 -0.15% → 전량 청산
      if (holdTimeSec <= EARLY_SL.STAGE2_SEC && 
          pnlPercent <= -EARLY_SL.STAGE2_PERCENT) {
        console.log(`⚡ [HFT] 조기손절 2단계! ${holdTimeSec.toFixed(0)}s, ${pnlPercent.toFixed(3)}%`);
        toast.error(`⚡ ${EARLY_SL.STAGE2_SEC}초 내 -${EARLY_SL.STAGE2_PERCENT}%! 전량 청산`);
        await closePosition('sl', currentPrice);
        return;
      }
    }

    // ============================================
    // 🛡️ 4. 브레이크이븐 시스템 (+0.05% 도달 시)
    // ============================================
    if (!tpState.breakEvenActivated && pnlPercent >= CONFIG.BREAKEVEN_TRIGGER) {
      console.log(`🛡️ [HFT] 브레이크이븐 활성화: +${pnlPercent.toFixed(3)}%`);
      setState(prev => {
        if (!prev.currentPosition) return prev;
        return {
          ...prev,
          currentPosition: {
            ...prev.currentPosition,
            takeProfitState: {
              ...prev.currentPosition.takeProfitState,
              breakEvenActivated: true,
              breakEvenActivatedAt: Date.now(),
            },
          },
        };
      });
      toast.info(`🛡️ BE 활성화! 손절 → +${CONFIG.BREAKEVEN_SL}%`);
    }

    // 브레이크이븐 타임아웃 (90초 후 수익 확정)
    if (tpState.breakEvenActivated && tpState.breakEvenActivatedAt) {
      const beElapsedSec = (Date.now() - tpState.breakEvenActivatedAt) / 1000;
      if (beElapsedSec >= CONFIG.BREAKEVEN_TIMEOUT_SEC && pnlPercent > 0) {
        console.log(`⏱️ [HFT] BE 타임아웃! +${pnlPercent.toFixed(3)}% 확정`);
        toast.success(`⏱️ BE ${CONFIG.BREAKEVEN_TIMEOUT_SEC}초! +${pnlPercent.toFixed(2)}% 익절`);
        await closePosition('tp', currentPrice);
        return;
      }
    }

    // ============================================
    // 🛑 5. 최종 손절 (-0.06%)
    // ============================================
    const effectiveSL = tpState.breakEvenActivated ? CONFIG.BREAKEVEN_SL : -CONFIG.SL_PERCENT;
    if (pnlPercent <= effectiveSL) {
      if (tpState.breakEvenActivated) {
        console.log(`🛡️ [HFT] BE 청산: ${pnlPercent.toFixed(3)}%`);
        await closePosition('tp', currentPrice);
      } else {
        console.log(`🛑 [HFT] 최종 손절: ${pnlPercent.toFixed(3)}% <= -${CONFIG.SL_PERCENT}%`);
        await closePosition('sl', currentPrice);
      }
      return;
    }

    // ============================================
    // ⏱️ 6. 시간 기반 익절 (HFT 핵심)
    // ============================================
    const { TIME_BASED_TP } = CONFIG;
    
    // 30초 후 +0.06%면 50% 청산
    if (holdTimeSec >= TIME_BASED_TP.PROFIT_30S.timeSec && 
        pnlPercent >= TIME_BASED_TP.PROFIT_30S.minProfitPct &&
        position.remainingQuantity === position.initialQuantity) {
      console.log(`⏱️ [HFT] 30초 익절! +${pnlPercent.toFixed(3)}% (50% 청산)`);
      toast.success(`⏱️ 30초 +${pnlPercent.toFixed(2)}%! 50% 익절`);
      
      const reduceQty = position.remainingQuantity * 0.5;
      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';
      
      try {
        await placeMarketOrder(position.symbol, orderSide, reduceQty, true, currentPrice);
        setState(prev => {
          if (!prev.currentPosition) return prev;
          return {
            ...prev,
            currentPosition: {
              ...prev.currentPosition,
              remainingQuantity: prev.currentPosition.remainingQuantity - reduceQty,
            },
          };
        });
      } catch (err) {
        console.error('시간 기반 익절 실패:', err);
      }
      return;
    }
    
    // 60초 후 +0.04%면 50% 청산
    if (holdTimeSec >= TIME_BASED_TP.PROFIT_60S.timeSec && 
        pnlPercent >= TIME_BASED_TP.PROFIT_60S.minProfitPct &&
        position.remainingQuantity > position.initialQuantity * 0.4) {
      console.log(`⏱️ [HFT] 60초 익절! +${pnlPercent.toFixed(3)}%`);
      toast.success(`⏱️ 60초 +${pnlPercent.toFixed(2)}%! 익절`);
      
      const reduceQty = position.remainingQuantity * 0.5;
      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';
      
      try {
        await placeMarketOrder(position.symbol, orderSide, reduceQty, true, currentPrice);
        setState(prev => {
          if (!prev.currentPosition) return prev;
          return {
            ...prev,
            currentPosition: {
              ...prev.currentPosition,
              remainingQuantity: prev.currentPosition.remainingQuantity - reduceQty,
            },
          };
        });
      } catch (err) {
        console.error('시간 기반 익절 실패:', err);
      }
      return;
    }
    
    // 90초 후 +0.02%면 전량 청산
    if (holdTimeSec >= TIME_BASED_TP.PROFIT_90S.timeSec && 
        pnlPercent >= TIME_BASED_TP.PROFIT_90S.minProfitPct) {
      console.log(`⏱️ [HFT] 90초 익절! +${pnlPercent.toFixed(3)}% (전량)`);
      toast.success(`⏱️ 90초 +${pnlPercent.toFixed(2)}%! 전량 익절`);
      await closePosition('tp', currentPrice);
      return;
    }

    // ============================================
    // 💰 7. 3단계 분할 익절 (고정 TP)
    // ============================================
    const tpLevels = CONFIG.TAKE_PROFIT_LEVELS;
    
    // 1차 익절: +0.08% → 60% 청산
    if (pnlPercent >= tpLevels[0].triggerPct && 
        position.remainingQuantity >= position.initialQuantity * 0.9) {
      console.log(`💰 [HFT] 1차 익절! +${pnlPercent.toFixed(3)}% (60% 청산)`);
      toast.success(`💰 1차 익절! +${pnlPercent.toFixed(2)}%`);
      
      const reduceQty = position.initialQuantity * (tpLevels[0].closePct / 100);
      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';
      
      try {
        await placeMarketOrder(position.symbol, orderSide, reduceQty, true, currentPrice);
        setState(prev => {
          if (!prev.currentPosition) return prev;
          return {
            ...prev,
            currentPosition: {
              ...prev.currentPosition,
              remainingQuantity: prev.currentPosition.remainingQuantity - reduceQty,
              takeProfitState: { ...prev.currentPosition.takeProfitState, tpHit: true },
            },
          };
        });
      } catch (err) {
        console.error('1차 익절 실패:', err);
      }
      return;
    }
    
    // 2차 익절: +0.15% → 30% 청산
    if (pnlPercent >= tpLevels[1].triggerPct && 
        position.remainingQuantity > position.initialQuantity * 0.35 &&
        position.remainingQuantity < position.initialQuantity * 0.5) {
      console.log(`💰 [HFT] 2차 익절! +${pnlPercent.toFixed(3)}% (30% 청산)`);
      toast.success(`💰 2차 익절! +${pnlPercent.toFixed(2)}%`);
      
      const reduceQty = position.initialQuantity * (tpLevels[1].closePct / 100);
      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';
      
      try {
        await placeMarketOrder(position.symbol, orderSide, reduceQty, true, currentPrice);
        setState(prev => {
          if (!prev.currentPosition) return prev;
          return {
            ...prev,
            currentPosition: {
              ...prev.currentPosition,
              remainingQuantity: prev.currentPosition.remainingQuantity - reduceQty,
            },
          };
        });
      } catch (err) {
        console.error('2차 익절 실패:', err);
      }
      return;
    }
    
    // 3차 익절: +0.28% → 러너 10% 청산
    if (pnlPercent >= tpLevels[2].triggerPct && position.remainingQuantity > 0) {
      console.log(`💰 [HFT] 3차 익절! +${pnlPercent.toFixed(3)}% (러너 전량 청산)`);
      toast.success(`🎯 러너 익절! +${pnlPercent.toFixed(2)}%`);
      await closePosition('tp', currentPrice);
      return;
    }
  }, [state.currentPosition, closePosition, placeMarketOrder]);

  // 시그널 핸들러 (기술적 분석 기반)
  const handleSignal = useCallback(async (
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
    if (balanceUSD <= 0) return;
    if (state.currentPosition) return;
    if (state.pendingSignal) return;

    // 연속 손실 쿨다운 체크
    if (state.cooldownUntil && Date.now() < state.cooldownUntil) {
      const remainingMin = Math.ceil((state.cooldownUntil - Date.now()) / 60000);
      console.log(`[handleSignal] 연속 손실 휴식 중 (${remainingMin}분 남음)`);
      return;
    }
    
    // 연속 손실 쿨다운 해제
    if (state.cooldownUntil && Date.now() >= state.cooldownUntil) {
      setState(prev => ({
        ...prev,
        cooldownUntil: null,
        consecutiveLosses: 0,
        statusMessage: '✅ 휴식 완료! 자동매매 재개',
      }));
      toast.success('✅ 휴식 완료! 자동매매 재개');
    }

    // 쿨다운 체크
    if (Date.now() - lastEntryTimeRef.current < CONFIG.ENTRY_COOLDOWN_MS) return;

    // 🆕 코인별 연속 손절 쿨다운 체크
    const coinRecord = coinLossRecordRef.current.get(symbol);
    if (coinRecord && coinRecord.cooldownUntil > Date.now()) {
      const remainingMin = Math.ceil((coinRecord.cooldownUntil - Date.now()) / 60000);
      console.log(`[handleSignal] ${symbol} 연속 손절 쿨다운 중 (${remainingMin}분 남음)`);
      return;
    }
    // 쿨다운 해제 시 연속 손절 카운트 리셋
    if (coinRecord && coinRecord.cooldownUntil <= Date.now() && coinRecord.consecutiveLosses > 0) {
      coinRecord.consecutiveLosses = 0;
      coinRecord.cooldownUntil = 0;
      coinLossRecordRef.current.set(symbol, coinRecord);
    }

    // 시그널 강도 체크
    const strengthOrder = { weak: 1, medium: 2, strong: 3 };
    if (strengthOrder[strength] < strengthOrder[CONFIG.MIN_SIGNAL_STRENGTH]) return;

    // ADX 시장 환경 필터 - 횡보장 차단
    if (indicators.adx < CONFIG.MIN_ADX_FOR_TREND) {
      console.log(`[handleSignal] ${symbol} 횡보장 필터 (ADX: ${indicators.adx.toFixed(1)} < ${CONFIG.MIN_ADX_FOR_TREND})`);
      return;
    }

    console.log(`[handleSignal] ${symbol} ${direction} ${strength} (ADX: ${indicators.adx.toFixed(1)})`, reasons);

    // 즉시 진입 (확인대기 없음)
    setState(prev => ({
      ...prev,
      currentSymbol: symbol,
      statusMessage: `🚀 ${symbol.replace('USDT', '')} ${direction === 'long' ? '롱' : '숏'} 즉시 진입 중...`,
    }));

    addLog({
      symbol,
      action: 'pending',
      side: direction,
      price,
      quantity: 0,
      reason: `${strength} 시그널 - ${reasons.slice(0, 3).join(', ')}`,
    });

    toast.info(`🚀 ${symbol} ${direction === 'long' ? '롱' : '숏'} 즉시 진입`);

    // 바로 진입 실행
    await executeEntry(symbol, direction, price, indicators);
  }, [state.isEnabled, state.currentPosition, state.pendingSignal, user, balanceUSD, addLog]);

  // BB 시그널 핸들러 (레거시 호환)
  const handleBBSignal = useCallback(async (
    symbol: string,
    touchType: 'upper' | 'lower',
    currentPrice: number
  ) => {
    if (!state.isEnabled) return;
    if (processingRef.current) return;
    if (state.currentPosition) return;
    if (state.pendingSignal) return;

    // 5분봉 기술적 분석
    const klines = await fetch5mKlines(symbol, 50);
    if (!klines || klines.length < 30) return;

    const indicators = calculateAllIndicators(klines);
    if (!indicators) return;

    const direction = touchType === 'upper' ? 'short' : 'long';
    const signalCheck = direction === 'long'
      ? checkLongSignal(indicators, currentPrice)
      : checkShortSignal(indicators, currentPrice);

    if (signalCheck.valid) {
      await handleSignal(symbol, direction, currentPrice, signalCheck.strength, signalCheck.reasons, indicators);
    }
  }, [state.isEnabled, state.currentPosition, state.pendingSignal, handleSignal]);

  // 🆕 동적 포지션 사이징 계산
  const calculateDynamicPositionSize = useCallback((
    balance: number,
    lev: number,
    price: number,
    atrPercent: number
  ): number => {
    // ATR 기반 변동성 레벨 판단
    let positionMultiplier = CONFIG.ATR_POSITION_MULTIPLIER.MEDIUM;
    let volatilityLevel = 'MEDIUM';
    
    if (atrPercent < 0.3) {
      positionMultiplier = CONFIG.ATR_POSITION_MULTIPLIER.LOW;
      volatilityLevel = 'LOW';
    } else if (atrPercent > 0.8) {
      positionMultiplier = CONFIG.ATR_POSITION_MULTIPLIER.HIGH;
      volatilityLevel = 'HIGH';
    }
    
    console.log(`[PositionSizing] ATR: ${atrPercent.toFixed(3)}% → ${volatilityLevel} (x${positionMultiplier})`);
    
    // 안전 잔고 * 포지션 배수 적용
    const safeBalance = balance * 0.9 * positionMultiplier;
    const buyingPower = safeBalance * lev;
    return buyingPower / price;
  }, []);

  // 진입 실행
  const executeEntry = useCallback(async (
    symbol: string,
    side: 'long' | 'short',
    currentPrice: number,
    indicators: TechnicalIndicators
  ) => {
    if (processingRef.current) return;

    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));

    try {
      // 🆕 5분봉 데이터로 초기 손절가 설정
      const klines = await fetch5mKlines(symbol, 5);
      let initialStopLoss = currentPrice;
      let lastCandleTime = Date.now();
      
      if (klines && klines.length >= 2) {
        // 전봉 (마지막에서 두번째 봉) 기준
        const prevCandle = klines[klines.length - 2];
        lastCandleTime = prevCandle.closeTime;
        
        if (side === 'long') {
          // 롱: 전봉 저가가 손절 기준
          initialStopLoss = prevCandle.low;
        } else {
          // 숏: 전봉 고가가 손절 기준
          initialStopLoss = prevCandle.high;
        }
        console.log(`[executeEntry] 초기 손절가 설정: ${side === 'long' ? '전봉 저가' : '전봉 고가'} = ${initialStopLoss.toFixed(4)}`);
      }
      
      // 🆕 ATR 기반 동적 포지션 사이징
      const atrPercent = (indicators.atr / currentPrice) * 100;
      const rawQty = calculateDynamicPositionSize(balanceUSD, leverage, currentPrice, atrPercent);

      const precision = await fetchSymbolPrecision(symbol);
      const quantity = roundQuantity(rawQty, precision);

      if (quantity * currentPrice < 5.5) {
        throw new Error('최소 주문금액 미달');
      }

      // 레버리지 설정
      try {
        await setLeverage(symbol, leverage);
      } catch (levError: any) {
        if (!levError.message?.includes('-4046') && !levError.message?.includes('already')) {
          console.warn('레버리지 설정 실패:', levError.message);
        }
      }

      // 시장가 주문
      const orderSide = side === 'long' ? 'BUY' : 'SELL';
      console.log(`🚀 [executeEntry] 주문 요청: ${symbol} ${orderSide} 수량=${quantity} 가격=${currentPrice}`);
      
      const orderResult = await placeMarketOrder(symbol, orderSide, quantity, false, currentPrice);
      console.log(`📋 [executeEntry] 주문 결과:`, JSON.stringify(orderResult));

      // 🔥 바이낸스 API 에러 체크 (code가 있으면 에러)
      if (!orderResult || orderResult.error || orderResult.code) {
        const errorMsg = orderResult?.msg || orderResult?.error || '주문 실패';
        console.error(`❌ [executeEntry] 주문 실패: ${errorMsg} (code: ${orderResult?.code})`);
        throw new Error(errorMsg);
      }

      // 체결 수량 파싱
      let executedQty = parseFloat(orderResult.executedQty || '0');
      const origQty = parseFloat(orderResult.origQty || '0');
      const avgPrice = parseFloat(orderResult.avgPrice || orderResult.price || '0') || currentPrice;

      // executedQty가 0이면 origQty 사용 (시장가 주문은 즉시 체결)
      if (executedQty <= 0 && origQty > 0) {
        console.log(`[executeEntry] executedQty=0, origQty=${origQty} 사용`);
        executedQty = origQty;
      }

      // ⚠️ 체결 수량이 여전히 0이면 주문 실패로 처리
      if (executedQty <= 0) {
        throw new Error(`주문 체결 실패 - 체결 수량 0 (응답: ${JSON.stringify(orderResult)})`);
      }

      lastEntryTimeRef.current = Date.now();

      // 포지션 저장
      const newPosition: Position = {
        symbol,
        side,
        entryPrice: avgPrice > 0 ? avgPrice : currentPrice,
        initialQuantity: executedQty,
        remainingQuantity: executedQty,
        entryTime: Date.now(),
        atr: indicators.atr,
        takeProfitState: {
          tpHit: false,
          breakEvenActivated: false,
          breakEvenActivatedAt: null,
        },
        indicators,
        maxPnlPercent: 0,
        earlySLStage: 0,
        trendStrength: calculateTrendStrength(indicators), // 🆕 진입 시점 추세 강도
        trailingActivated: false, // 🆕 트레일링 초기화
      };

      setState(prev => ({
        ...prev,
        pendingSignal: null,
        currentPosition: newPosition,
        currentSymbol: symbol,
        tpPercent: CONFIG.TP_PERCENT,
        statusMessage: `🎯 ${symbol.replace('USDT', '')} ${side === 'long' ? '롱' : '숏'} 포지션 보유 중`,
      }));

      addLog({
        symbol,
        action: 'entry',
        side,
        price: avgPrice > 0 ? avgPrice : currentPrice,
        quantity: executedQty,
        reason: `진입 (익절: +${CONFIG.TP_PERCENT}%)`,
      });

      playEntrySound();
      const cuteEmojis = ['🚀', '💫', '✨', '🎯', '💰', '🔥', '⚡'];
      const randomEmoji = cuteEmojis[Math.floor(Math.random() * cuteEmojis.length)];
      toast.success(`${randomEmoji} ${side === 'long' ? '롱' : '숏'} 진입! ${symbol.replace('USDT', '')} @ $${(avgPrice > 0 ? avgPrice : currentPrice).toFixed(2)}`);

    } catch (error: any) {
      console.error('Entry error:', error);
      lastEntryTimeRef.current = Date.now();
      setState(prev => ({ ...prev, pendingSignal: null, statusMessage: '🔍 기술적 분석 기반 스캔 중...' }));
      addLog({
        symbol,
        action: 'error',
        side,
        price: currentPrice,
        quantity: 0,
        reason: error.message || '진입 실패',
      });
      toast.error(`진입 실패: ${error.message || '오류'}`);
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [balanceUSD, leverage, placeMarketOrder, setLeverage, addLog]);

  // 봉 완성 체크 (TP/SL 체크용으로만 사용)
  const checkCandleCompletion = useCallback(async () => {
    if (!state.isEnabled) return;
    if (processingRef.current) return;

    const currentMinute = getMinuteTimestamp();
    if (currentMinute === lastMinuteRef.current) return;
    lastMinuteRef.current = currentMinute;

    // 진입은 handleSignal에서 즉시 처리되므로 여기서는 별도 로직 없음
  }, [state.isEnabled]);

  // 포지션 동기화
  useEffect(() => {
    if (!user) return;

    let isMounted = true;

    const syncPositions = async () => {
      if (positionSyncRef.current) return;
      positionSyncRef.current = true;

      try {
        const positions = await getPositions();
        if (!isMounted) return;

        const activePosition = positions?.find((p: any) =>
          Math.abs(parseFloat(p.positionAmt)) > 0
        );

        // 🆕 외부 청산 감지: 앱에서 추적 중인 포지션이 바이낸스에 없으면 정리
        // ⚠️ 단, 진입 후 10초 이내는 API 지연으로 오탐 가능 → 무시
        if (state.currentPosition && !activePosition) {
          const timeSinceEntry = Date.now() - state.currentPosition.entryTime;
          
          // 진입 후 10초 이내면 sync 무시 (API 지연 대응)
          if (timeSinceEntry < 10000) {
            console.log(`⏳ [syncPositions] 진입 직후 ${(timeSinceEntry / 1000).toFixed(1)}초 - sync 무시`);
          } else {
            console.log(`⚠️ [syncPositions] 외부 청산 감지: ${state.currentPosition.symbol} 포지션이 바이낸스에 없음 (${(timeSinceEntry / 1000).toFixed(0)}초 경과)`);
            toast.warning(`⚠️ ${state.currentPosition.symbol.replace('USDT', '')} 포지션이 외부에서 청산됨`);
            setState(prev => ({
              ...prev,
              currentPosition: null,
              currentSymbol: null,
              statusMessage: '🔍 기술적 분석 기반 스캔 중...',
            }));
          }
        }
        
        // 🆕 심볼 불일치 감지: 다른 심볼 포지션이 열려있으면 전환
        if (state.currentPosition && activePosition && state.currentPosition.symbol !== activePosition.symbol) {
          console.log(`🔄 [syncPositions] 심볼 변경 감지: ${state.currentPosition.symbol} → ${activePosition.symbol}`);
          const positionAmt = parseFloat(activePosition.positionAmt);
          const side = positionAmt > 0 ? 'long' : 'short';
          const entryPrice = parseFloat(activePosition.entryPrice);
          
          const defaultIndicators: TechnicalIndicators = {
            rsi: 50, ema8: entryPrice, ema21: entryPrice, ema21Slope: 0,
            macd: 0, macdSignal: 0, macdHistogram: 0,
            upperBand: entryPrice * 1.02, lowerBand: entryPrice * 0.98, sma20: entryPrice,
            adx: 25, cci: 0, stochK: 50, stochD: 50, williamsR: -50,
            atr: entryPrice * 0.005, volumeRatio: 1,
            higherHighs: false, lowerLows: false, trendStrength: 'neutral',
          };
          
          toast.info(`🔄 포지션 전환: ${activePosition.symbol.replace('USDT', '')} ${side === 'long' ? '롱' : '숏'}`);
          setState(prev => ({
            ...prev,
            currentPosition: {
              symbol: activePosition.symbol,
              side,
              entryPrice,
              initialQuantity: Math.abs(positionAmt),
              remainingQuantity: Math.abs(positionAmt),
              entryTime: Date.now(),
              atr: entryPrice * 0.005,
              takeProfitState: {
                tpHit: false,
                breakEvenActivated: false,
                breakEvenActivatedAt: null,
              },
              indicators: defaultIndicators,
              maxPnlPercent: 0,
              earlySLStage: 0,
              trendStrength: 'MEDIUM', // 동기화된 포지션은 기본값
              trailingActivated: false,
            },
            currentSymbol: activePosition.symbol,
          }));
        }

        // 새 포지션 동기화 (앱에 없을 때)
        if (activePosition && !state.currentPosition) {
          const positionAmt = parseFloat(activePosition.positionAmt);
          const side = positionAmt > 0 ? 'long' : 'short';
          const entryPrice = parseFloat(activePosition.entryPrice);
          
          console.log(`📥 [syncPositions] 기존 포지션 동기화: ${activePosition.symbol} ${side}`);

          // 기본 인디케이터 (동기화용)
          const defaultIndicators: TechnicalIndicators = {
            rsi: 50, ema8: entryPrice, ema21: entryPrice, ema21Slope: 0,
            macd: 0, macdSignal: 0, macdHistogram: 0,
            upperBand: entryPrice * 1.02, lowerBand: entryPrice * 0.98, sma20: entryPrice,
            adx: 25, cci: 0, stochK: 50, stochD: 50, williamsR: -50,
            atr: entryPrice * 0.005, volumeRatio: 1,
            higherHighs: false, lowerLows: false, trendStrength: 'neutral',
          };

          setState(prev => ({
            ...prev,
            currentPosition: {
              symbol: activePosition.symbol,
              side,
              entryPrice,
              initialQuantity: Math.abs(positionAmt),
              remainingQuantity: Math.abs(positionAmt),
              entryTime: Date.now(),
              atr: entryPrice * 0.005,
              takeProfitState: {
                tpHit: false,
                breakEvenActivated: false,
                breakEvenActivatedAt: null,
              },
              indicators: defaultIndicators,
              maxPnlPercent: 0,
              earlySLStage: 0,
              trendStrength: 'MEDIUM', // 동기화된 포지션은 기본값
              trailingActivated: false,
            },
            currentSymbol: activePosition.symbol,
          }));
        }
      } catch (error) {
        console.error('Position sync error:', error);
      } finally {
        positionSyncRef.current = false;
      }
    };

    syncPositions();
    const interval = setInterval(syncPositions, 10000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [user, getPositions, state.currentPosition]);

  // 봉 완성 체크 interval
  useEffect(() => {
    if (!state.isEnabled) return;
    const interval = setInterval(checkCandleCompletion, 1000);
    return () => clearInterval(interval);
  }, [state.isEnabled, checkCandleCompletion]);

  // 자정 리셋
  useEffect(() => {
    const checkDayChange = () => {
      const now = new Date();
      const koreaTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const hours = koreaTime.getUTCHours();
      const minutes = koreaTime.getUTCMinutes();

      if (hours === 0 && minutes === 0) {
        setState(prev => ({
          ...prev,
          todayStats: { trades: 0, wins: 0, losses: 0, totalPnL: 0 },
          tradeLogs: [],
          consecutiveLosses: 0,
          cooldownUntil: null,
        }));
      }
    };

    const interval = setInterval(checkDayChange, 60000);
    return () => clearInterval(interval);
  }, []);

  // 시그널 패스
  const skipSignal = useCallback(() => {
    if (!state.pendingSignal) return;

    const { symbol, direction } = state.pendingSignal;

    addLog({
      symbol,
      action: 'cancel',
      side: direction,
      price: state.pendingSignal.signalPrice,
      quantity: 0,
      reason: '🚫 수동 패스',
    });

    setState(prev => ({
      ...prev,
      pendingSignal: null,
      statusMessage: '🔍 기술적 분석 기반 스캔 중...',
    }));

    toast.info(`⏭️ ${symbol} 패스됨`);
  }, [state.pendingSignal, addLog]);

  // 시그널 방향 스왑
  const swapSignalDirection = useCallback(() => {
    if (!state.pendingSignal) return;

    const { symbol, direction } = state.pendingSignal;
    const newDirection = direction === 'long' ? 'short' : 'long';

    setState(prev => ({
      ...prev,
      pendingSignal: prev.pendingSignal
        ? { ...prev.pendingSignal, direction: newDirection }
        : null,
    }));

    toast.info(`🔄 ${symbol} → ${newDirection === 'long' ? '롱' : '숏'}으로 변경`);
  }, [state.pendingSignal]);

  // 본절 청산
  const breakEvenClose = useCallback(async () => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;

    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));

    const position = state.currentPosition;

    try {
      const positions = await getPositions(position.symbol);
      const actualPosition = positions?.find((p: any) =>
        p.symbol === position.symbol && Math.abs(parseFloat(p.positionAmt)) > 0
      );

      if (!actualPosition) {
        setState(prev => ({
          ...prev,
          currentPosition: null,
          currentSymbol: null,
          statusMessage: '🔍 기술적 분석 기반 스캔 중...',
        }));
        toast.error('실제 포지션이 없습니다');
        return;
      }

      const actualQty = Math.abs(parseFloat(actualPosition.positionAmt));
      const entryPrice = parseFloat(actualPosition.entryPrice);

      const orderSide = position.side === 'long' ? 'SELL' : 'BUY';
      const result = await placeLimitOrder(position.symbol, orderSide, actualQty, entryPrice, true);

      if (!result || result.error) {
        throw new Error(result?.error || '본절 주문 실패');
      }

      addLog({
        symbol: position.symbol,
        action: 'pending',
        side: position.side,
        price: entryPrice,
        quantity: actualQty,
        reason: `📍 본절 주문 등록 @ $${entryPrice.toFixed(4)}`,
      });

      toast.success(`📍 ${position.symbol} 본절 주문 등록 @ $${entryPrice.toFixed(4)}`);
    } catch (error: any) {
      console.error('Break-even order error:', error);
      toast.error(`본절 주문 실패: ${error.message || '오류'}`);
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [state.currentPosition, getPositions, placeLimitOrder, addLog]);

  // 본절 주문 취소
  const cancelBreakEvenOrder = useCallback(async () => {
    if (!state.currentPosition) return;
    if (processingRef.current) return;

    processingRef.current = true;
    setState(prev => ({ ...prev, isProcessing: true }));

    const position = state.currentPosition;

    try {
      await cancelAllOrders(position.symbol);

      addLog({
        symbol: position.symbol,
        action: 'cancel',
        side: position.side,
        price: position.entryPrice,
        quantity: 0,
        reason: '🚫 본절 주문 취소됨',
      });

      toast.info(`🚫 ${position.symbol} 본절 주문 취소됨`);
    } catch (error: any) {
      console.error('Cancel break-even order error:', error);
      toast.error(`본절 취소 실패: ${error.message || '오류'}`);
    } finally {
      processingRef.current = false;
      setState(prev => ({ ...prev, isProcessing: false }));
    }
  }, [state.currentPosition, cancelAllOrders, addLog]);

  // 연속 손실 보호 기능 토글
  const toggleLossProtection = useCallback(() => {
    setState(prev => ({
      ...prev,
      lossProtectionEnabled: !prev.lossProtectionEnabled,
      // 보호 기능 끄면 현재 쿨다운도 해제
      cooldownUntil: !prev.lossProtectionEnabled ? prev.cooldownUntil : null,
    }));
  }, []);

  // 쿨다운 즉시 해제 (현재 휴식 해제)
  const clearCooldown = useCallback(() => {
    setState(prev => ({
      ...prev,
      cooldownUntil: null,
      consecutiveLosses: 0,
    }));
  }, []);

  return {
    state,
    toggleAutoTrading,
    handleSignal: handleBBSignal, // 레거시 호환
    handleTechnicalSignal: handleSignal,
    closePosition,
    checkTpSl,
    skipSignal,
    swapSignalDirection,
    breakEvenClose,
    cancelBreakEvenOrder,
    toggleLossProtection,
    clearCooldown,
    updatePrice: useCallback(() => {}, []),
  };
}
