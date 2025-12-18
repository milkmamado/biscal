/**
 * 백테스트 훅
 * 과거 데이터 기반 전략 성과 검증
 */
import { useState, useCallback } from 'react';
import { 
  calculateAllIndicators, 
  checkLongSignal, 
  checkShortSignal,
  Kline,
  TechnicalIndicators
} from './useTechnicalIndicators';

interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  side: 'long' | 'short';
  entryPrice: number;
  exitPrice: number;
  pnlPercent: number;
  reason: string;
  strength: 'weak' | 'medium' | 'strong';
}

interface BacktestResult {
  symbol: string;
  period: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnLPercent: number;
  avgPnLPercent: number;
  maxDrawdown: number;
  profitFactor: number;
  trades: BacktestTrade[];
  indicatorStats: {
    avgRSI: number;
    avgADX: number;
    avgATR: number;
  };
}

// 설정
const BACKTEST_CONFIG = {
  TP_PERCENT: 0.8,      // 익절 퍼센트
  SL_PERCENT: 0.5,      // 손절 퍼센트
  MIN_ADX: 20,          // 최소 ADX (시장 환경 필터)
  MIN_SIGNAL_STRENGTH: 'medium' as const,
};

// 과거 캔들 데이터 가져오기
async function fetchHistoricalKlines(
  symbol: string, 
  interval: string, 
  limit: number
): Promise<Kline[] | null> {
  try {
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data.map((k: any[]) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
    }));
  } catch {
    return null;
  }
}

// 시뮬레이션된 거래 결과 계산
function simulateTrade(
  side: 'long' | 'short',
  entryPrice: number,
  klines: Kline[],
  startIndex: number
): { exitPrice: number; pnlPercent: number; reason: string; exitIndex: number } {
  for (let i = startIndex; i < klines.length; i++) {
    const candle = klines[i];
    const direction = side === 'long' ? 1 : -1;
    
    // 고가/저가로 TP/SL 체크
    const highPnL = ((candle.high - entryPrice) / entryPrice) * 100 * direction;
    const lowPnL = ((candle.low - entryPrice) / entryPrice) * 100 * direction;
    
    // 롱: 고가에서 TP, 저가에서 SL
    // 숏: 저가에서 TP, 고가에서 SL
    const tpHit = side === 'long' ? highPnL >= BACKTEST_CONFIG.TP_PERCENT : lowPnL >= BACKTEST_CONFIG.TP_PERCENT;
    const slHit = side === 'long' ? lowPnL <= -BACKTEST_CONFIG.SL_PERCENT : highPnL <= -BACKTEST_CONFIG.SL_PERCENT;
    
    if (tpHit) {
      const exitPrice = side === 'long' 
        ? entryPrice * (1 + BACKTEST_CONFIG.TP_PERCENT / 100)
        : entryPrice * (1 - BACKTEST_CONFIG.TP_PERCENT / 100);
      return { exitPrice, pnlPercent: BACKTEST_CONFIG.TP_PERCENT, reason: '익절', exitIndex: i };
    }
    
    if (slHit) {
      const exitPrice = side === 'long'
        ? entryPrice * (1 - BACKTEST_CONFIG.SL_PERCENT / 100)
        : entryPrice * (1 + BACKTEST_CONFIG.SL_PERCENT / 100);
      return { exitPrice, pnlPercent: -BACKTEST_CONFIG.SL_PERCENT, reason: '손절', exitIndex: i };
    }
  }
  
  // 마지막 캔들에서 청산
  const lastCandle = klines[klines.length - 1];
  const direction = side === 'long' ? 1 : -1;
  const pnlPercent = ((lastCandle.close - entryPrice) / entryPrice) * 100 * direction;
  return { exitPrice: lastCandle.close, pnlPercent, reason: '타임아웃', exitIndex: klines.length - 1 };
}

export function useBacktest() {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<BacktestResult | null>(null);
  
  const runBacktest = useCallback(async (
    symbol: string,
    period: '1d' | '3d' | '7d' = '1d'
  ): Promise<BacktestResult | null> => {
    setIsRunning(true);
    setProgress(0);
    setResult(null);
    
    try {
      // 기간별 캔들 수 (5분봉 기준)
      const candleCount = {
        '1d': 288,   // 24시간 * 12
        '3d': 864,   // 3일
        '7d': 1000,  // 최대 1000개
      }[period];
      
      const klines = await fetchHistoricalKlines(symbol, '5m', candleCount);
      if (!klines || klines.length < 50) {
        throw new Error('데이터 부족');
      }
      
      const trades: BacktestTrade[] = [];
      let rsiSum = 0, adxSum = 0, atrSum = 0, indicatorCount = 0;
      
      // 슬라이딩 윈도우로 시그널 검사
      for (let i = 50; i < klines.length - 10; i++) {
        setProgress(Math.round((i / klines.length) * 100));
        
        const windowKlines = klines.slice(i - 50, i);
        const indicators = calculateAllIndicators(windowKlines);
        if (!indicators) continue;
        
        rsiSum += indicators.rsi;
        adxSum += indicators.adx;
        atrSum += indicators.atr;
        indicatorCount++;
        
        // ADX 필터 (시장 환경 필터)
        if (indicators.adx < BACKTEST_CONFIG.MIN_ADX) continue;
        
        const currentPrice = klines[i].close;
        
        // 시그널 체크
        const longSignal = checkLongSignal(indicators, currentPrice);
        const shortSignal = checkShortSignal(indicators, currentPrice);
        
        const strengthOrder = { weak: 1, medium: 2, strong: 3 };
        
        if (longSignal.valid && strengthOrder[longSignal.strength] >= strengthOrder[BACKTEST_CONFIG.MIN_SIGNAL_STRENGTH]) {
          const tradeResult = simulateTrade('long', currentPrice, klines, i + 1);
          trades.push({
            entryTime: klines[i].openTime,
            exitTime: klines[tradeResult.exitIndex]?.openTime || klines[i].openTime,
            side: 'long',
            entryPrice: currentPrice,
            exitPrice: tradeResult.exitPrice,
            pnlPercent: tradeResult.pnlPercent,
            reason: tradeResult.reason,
            strength: longSignal.strength,
          });
          i = tradeResult.exitIndex + 1; // 청산 후 다음 캔들부터
        } else if (shortSignal.valid && strengthOrder[shortSignal.strength] >= strengthOrder[BACKTEST_CONFIG.MIN_SIGNAL_STRENGTH]) {
          const tradeResult = simulateTrade('short', currentPrice, klines, i + 1);
          trades.push({
            entryTime: klines[i].openTime,
            exitTime: klines[tradeResult.exitIndex]?.openTime || klines[i].openTime,
            side: 'short',
            entryPrice: currentPrice,
            exitPrice: tradeResult.exitPrice,
            pnlPercent: tradeResult.pnlPercent,
            reason: tradeResult.reason,
            strength: shortSignal.strength,
          });
          i = tradeResult.exitIndex + 1;
        }
      }
      
      // 결과 계산
      const wins = trades.filter(t => t.pnlPercent > 0).length;
      const losses = trades.filter(t => t.pnlPercent <= 0).length;
      const totalPnL = trades.reduce((sum, t) => sum + t.pnlPercent, 0);
      const avgPnL = trades.length > 0 ? totalPnL / trades.length : 0;
      
      // 최대 낙폭 계산
      let peak = 0;
      let maxDrawdown = 0;
      let cumPnL = 0;
      for (const trade of trades) {
        cumPnL += trade.pnlPercent;
        if (cumPnL > peak) peak = cumPnL;
        const dd = peak - cumPnL;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }
      
      // Profit Factor
      const grossProfit = trades.filter(t => t.pnlPercent > 0).reduce((s, t) => s + t.pnlPercent, 0);
      const grossLoss = Math.abs(trades.filter(t => t.pnlPercent < 0).reduce((s, t) => s + t.pnlPercent, 0));
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
      
      const backtestResult: BacktestResult = {
        symbol,
        period,
        totalTrades: trades.length,
        wins,
        losses,
        winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
        totalPnLPercent: totalPnL,
        avgPnLPercent: avgPnL,
        maxDrawdown,
        profitFactor,
        trades,
        indicatorStats: {
          avgRSI: indicatorCount > 0 ? rsiSum / indicatorCount : 50,
          avgADX: indicatorCount > 0 ? adxSum / indicatorCount : 25,
          avgATR: indicatorCount > 0 ? atrSum / indicatorCount : 0,
        },
      };
      
      setResult(backtestResult);
      setProgress(100);
      return backtestResult;
      
    } catch (error) {
      console.error('Backtest error:', error);
      return null;
    } finally {
      setIsRunning(false);
    }
  }, []);
  
  const clearResult = useCallback(() => {
    setResult(null);
    setProgress(0);
  }, []);
  
  return {
    isRunning,
    progress,
    result,
    runBacktest,
    clearResult,
  };
}
