/**
 * 🤖 AI 시장 분석 훅
 * Lovable AI를 통한 실시간 시장 상황 분석
 */
import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

import { 
  TradingConfig, 
  AIAdjustments, 
  AIRecommendation,
  MarketCondition,
  getBaseConfig,
  applyAIAdjustments,
  TradingMode,
} from '@/lib/tradingConfig';
import { TechnicalIndicators } from './useTechnicalIndicators';

export interface MarketAnalysisResult {
  marketCondition: MarketCondition;
  confidence: number;
  recommendation: AIRecommendation;
  adjustments: AIAdjustments;
  reasoning: string;
  warnings: string[];
  timestamp: number;
}

interface UseMarketAnalysisProps {
  mode: TradingMode;
  enabled?: boolean;
  showToasts?: boolean; // 토스트 알림 표시 여부 (자동매매 켜진 경우에만 true)
}

interface MarketDataForAI {
  symbol: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  volatility: number;
  adx: number;
  rsi: number;
  bbWidth: number;
  ema8: number;
  ema21: number;
  macdHistogram: number;
  recentTrades?: { pnl: number; symbol: string; side: string }[];
}

export function useMarketAnalysis({ mode, enabled = true, showToasts = false }: UseMarketAnalysisProps) {
  const [analysis, setAnalysis] = useState<MarketAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [dynamicConfig, setDynamicConfig] = useState<TradingConfig>(getBaseConfig(mode));
  
  const lastAnalysisRef = useRef<number>(0);
  const analysisIntervalRef = useRef<number>(60000); // 기본 1분
  const failCountRef = useRef<number>(0);

  /**
   * AI 시장 분석 실행
   */
  const analyzeMarket = useCallback(async (
    symbol: string,
    indicators: TechnicalIndicators,
    price: number,
    priceChange24h: number,
    volume24h: number,
    recentTrades?: { pnl: number; symbol: string; side: string }[]
  ): Promise<MarketAnalysisResult | null> => {
    if (!enabled) return null;
    
    // 쿨다운 체크 (최소 30초)
    const now = Date.now();
    if (now - lastAnalysisRef.current < 30000) {
      return analysis;
    }
    
    setIsAnalyzing(true);
    lastAnalysisRef.current = now;

    try {
      // 볼린저밴드 폭 계산
      const bbWidth = indicators.sma20 > 0 
        ? ((indicators.upperBand - indicators.lowerBand) / indicators.sma20) * 100 
        : 0;

      const marketData: MarketDataForAI = {
        symbol,
        price,
        priceChange24h,
        volume24h,
        volatility: bbWidth,
        adx: indicators.adx,
        rsi: indicators.rsi,
        bbWidth,
        ema8: indicators.ema8,
        ema21: indicators.ema21,
        macdHistogram: indicators.macdHistogram,
        recentTrades,
      };

      console.log(`[MarketAnalysis] Calling AI for ${symbol}...`);

      const { data, error } = await supabase.functions.invoke('analyze-market', {
        body: { marketData },
      });

      if (error) {
        console.error('[MarketAnalysis] Edge function error:', error);
        throw error;
      }

      // 에러 응답 처리 (fallback 포함)
      if (data?.error) {
        console.warn('[MarketAnalysis] AI error with fallback:', data.error);
        if (data.fallback) {
          const fallbackResult: MarketAnalysisResult = {
            ...data.fallback,
            timestamp: now,
          };
          setAnalysis(fallbackResult);
          updateDynamicConfig(fallbackResult);
          return fallbackResult;
        }
        throw new Error(data.error);
      }

      const result: MarketAnalysisResult = {
        ...data.analysis,
        timestamp: now,
      };

      console.log(`[MarketAnalysis] Result: ${result.marketCondition} - ${result.recommendation}`);
      
      setAnalysis(result);
      updateDynamicConfig(result);
      failCountRef.current = 0;
      
      // 성공 시 분석 간격 정상화
      analysisIntervalRef.current = 60000;

      return result;

    } catch (error) {
      console.error('[MarketAnalysis] Error:', error);
      failCountRef.current++;
      
      // 연속 실패 시 간격 늘리기
      if (failCountRef.current >= 3) {
        analysisIntervalRef.current = Math.min(300000, analysisIntervalRef.current * 2);
        console.log(`[MarketAnalysis] Too many failures, increasing interval to ${analysisIntervalRef.current / 1000}s`);
      }
      
      // 폴백: 기본 규칙 기반 분석
      const fallbackResult = getFallbackAnalysis(
        indicators.adx,
        indicators.rsi,
        ((indicators.upperBand - indicators.lowerBand) / indicators.sma20) * 100,
        indicators.ema8,
        indicators.ema21
      );
      
      setAnalysis(fallbackResult);
      updateDynamicConfig(fallbackResult);
      
      return fallbackResult;
    } finally {
      setIsAnalyzing(false);
    }
  }, [enabled, mode, analysis]);

  /**
   * 분석 결과로 동적 설정 업데이트
   */
  const updateDynamicConfig = useCallback((result: MarketAnalysisResult) => {
    const baseConfig = getBaseConfig(mode);
    const newConfig = applyAIAdjustments(
      baseConfig,
      result.adjustments,
      result.recommendation
    );
    setDynamicConfig(newConfig);
    
    // 경고 표시 (자동매매 중일 때만)
    if (showToasts) {
      if (result.warnings.length > 0 && result.recommendation === 'STOP') {
        console.log('⚠️ AI 분석: 거래 중지 권장 -', result.warnings[0]);
      } else if (result.recommendation === 'CONSERVATIVE') {
        console.log('📉 AI 분석: 보수적 거래 권장 -', result.reasoning);
      }
    }
  }, [mode]);

  /**
   * 분석 결과 초기화
   */
  const resetAnalysis = useCallback(() => {
    setAnalysis(null);
    setDynamicConfig(getBaseConfig(mode));
    lastAnalysisRef.current = 0;
    failCountRef.current = 0;
    analysisIntervalRef.current = 60000;
  }, [mode]);

  /**
   * 분석이 필요한지 확인
   */
  const shouldAnalyze = useCallback((): boolean => {
    if (!enabled) return false;
    const now = Date.now();
    return now - lastAnalysisRef.current >= analysisIntervalRef.current;
  }, [enabled]);

  return {
    analysis,
    isAnalyzing,
    dynamicConfig,
    analyzeMarket,
    resetAnalysis,
    shouldAnalyze,
    analysisInterval: analysisIntervalRef.current,
  };
}

/**
 * 폴백 분석 (AI 실패 시 규칙 기반)
 */
function getFallbackAnalysis(
  adx: number,
  rsi: number,
  volatility: number,
  ema8: number,
  ema21: number
): MarketAnalysisResult {
  let marketCondition: MarketCondition = 'RANGING';
  let recommendation: AIRecommendation = 'NORMAL';
  let confidence = 60;
  const warnings: string[] = [];

  if (adx < 20) {
    marketCondition = volatility < 2 ? 'QUIET' : 'RANGING';
    recommendation = 'CONSERVATIVE';
    confidence = 40;
    warnings.push('낮은 ADX - 약한 추세');
  } else if (adx > 40) {
    marketCondition = ema8 > ema21 ? 'TRENDING_UP' : 'TRENDING_DOWN';
    recommendation = 'AGGRESSIVE';
    confidence = 80;
  } else {
    if (volatility > 5) {
      marketCondition = 'VOLATILE';
      recommendation = 'CONSERVATIVE';
      warnings.push('높은 변동성 - 손절 확대 필요');
    } else {
      marketCondition = ema8 > ema21 ? 'TRENDING_UP' : 'TRENDING_DOWN';
      recommendation = 'NORMAL';
      confidence = 65;
    }
  }

  if (rsi < 25 || rsi > 75) {
    warnings.push(`RSI ${rsi.toFixed(1)} - 반전 가능성`);
    confidence = Math.max(confidence - 15, 30);
  }

  const tpMultiplier = adx > 35 ? 1.3 : adx < 20 ? 0.7 : 1.0;
  const slMultiplier = volatility > 4 ? 1.3 : volatility < 2 ? 0.8 : 1.0;
  const minConfidence = adx < 25 ? 75 : 65;

  return {
    marketCondition,
    confidence,
    recommendation,
    adjustments: {
      tpMultiplier,
      slMultiplier,
      minConfidence,
      entryDelay: adx < 20 ? 10 : 0,
    },
    reasoning: `ADX ${adx.toFixed(1)}, RSI ${rsi.toFixed(1)}, Vol ${volatility.toFixed(2)}% (규칙 기반)`,
    warnings,
    timestamp: Date.now(),
  };
}
