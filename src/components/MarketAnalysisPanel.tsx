/**
 * 🤖 AI 시장 분석 패널
 * 현재 시장 상황과 AI 권장 전략을 시각적으로 표시
 */
import { Brain, TrendingUp, TrendingDown, Minus, AlertTriangle, Zap, Shield, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MarketAnalysisResult } from '@/hooks/useMarketAnalysis';
import { MarketCondition, AIRecommendation } from '@/lib/tradingConfig';

interface MarketAnalysisPanelProps {
  analysis: MarketAnalysisResult | null;
  isAnalyzing: boolean;
  enabled?: boolean;
}

const getConditionConfig = (condition: MarketCondition) => {
  switch (condition) {
    case 'TRENDING_UP':
      return {
        icon: TrendingUp,
        label: '상승 추세',
        color: '#00ff88',
        bg: 'rgba(0, 255, 136, 0.15)',
        border: 'rgba(0, 255, 136, 0.3)',
      };
    case 'TRENDING_DOWN':
      return {
        icon: TrendingDown,
        label: '하락 추세',
        color: '#ff0088',
        bg: 'rgba(255, 0, 136, 0.15)',
        border: 'rgba(255, 0, 136, 0.3)',
      };
    case 'RANGING':
      return {
        icon: Minus,
        label: '횡보장',
        color: '#ffff00',
        bg: 'rgba(255, 255, 0, 0.15)',
        border: 'rgba(255, 255, 0, 0.3)',
      };
    case 'VOLATILE':
      return {
        icon: Zap,
        label: '고변동성',
        color: '#ff8800',
        bg: 'rgba(255, 136, 0, 0.15)',
        border: 'rgba(255, 136, 0, 0.3)',
      };
    case 'QUIET':
      return {
        icon: Pause,
        label: '저변동성',
        color: '#888888',
        bg: 'rgba(136, 136, 136, 0.15)',
        border: 'rgba(136, 136, 136, 0.3)',
      };
    default:
      return {
        icon: Minus,
        label: '분석중',
        color: '#00ffff',
        bg: 'rgba(0, 255, 255, 0.15)',
        border: 'rgba(0, 255, 255, 0.3)',
      };
  }
};

const getRecommendationConfig = (recommendation: AIRecommendation) => {
  switch (recommendation) {
    case 'AGGRESSIVE':
      return {
        icon: Zap,
        label: '공격적',
        color: '#00ff88',
        description: 'TP 확대, 적극 진입',
      };
    case 'NORMAL':
      return {
        icon: TrendingUp,
        label: '정상',
        color: '#00ffff',
        description: '기본 전략 유지',
      };
    case 'CONSERVATIVE':
      return {
        icon: Shield,
        label: '보수적',
        color: '#ffff00',
        description: 'TP/SL 축소, 신중 진입',
      };
    case 'STOP':
      return {
        icon: Pause,
        label: '거래 중지',
        color: '#ff0088',
        description: '거래 권장 안함',
      };
    default:
      return {
        icon: Minus,
        label: '분석중',
        color: '#888888',
        description: '...',
      };
  }
};

const MarketAnalysisPanel = ({ analysis, isAnalyzing, enabled = true }: MarketAnalysisPanelProps) => {
  if (!enabled) return null;

  const conditionConfig = analysis 
    ? getConditionConfig(analysis.marketCondition)
    : getConditionConfig('RANGING');
  
  const recommendConfig = analysis
    ? getRecommendationConfig(analysis.recommendation)
    : getRecommendationConfig('NORMAL');

  const ConditionIcon = conditionConfig.icon;
  const RecommendIcon = recommendConfig.icon;

  const confidenceColor = analysis
    ? analysis.confidence >= 70 ? '#00ff88' 
      : analysis.confidence >= 50 ? '#ffff00' 
      : '#ff0088'
    : '#888888';

  return (
    <div className="relative z-10 mx-3 mb-2 rounded-md overflow-hidden" style={{
      background: 'linear-gradient(135deg, rgba(20, 20, 40, 0.9) 0%, rgba(10, 10, 25, 0.95) 100%)',
      border: '1px solid rgba(0, 255, 255, 0.2)',
    }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5" style={{
        background: 'linear-gradient(90deg, rgba(0, 255, 255, 0.1) 0%, transparent 100%)',
        borderBottom: '1px solid rgba(0, 255, 255, 0.1)',
      }}>
        <div className="flex items-center gap-1.5">
          <Brain className={cn(
            "w-3.5 h-3.5",
            isAnalyzing && "animate-pulse"
          )} style={{ 
            color: '#00ffff',
            filter: 'drop-shadow(0 0 4px rgba(0, 255, 255, 0.6))',
          }} />
          <span className="text-[10px] font-medium tracking-wide" style={{ color: '#00ffff' }}>
            AI 시장 분석
          </span>
          {isAnalyzing && (
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
          )}
        </div>
        {analysis && (
          <span className="text-[9px] text-gray-500">
            {new Date(analysis.timestamp).toLocaleTimeString('ko-KR', { 
              hour: '2-digit', 
              minute: '2-digit' 
            })}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        {!analysis ? (
          <div className="text-center py-2">
            <span className="text-[10px] text-gray-500">
              {isAnalyzing ? '시장 분석 중...' : '분석 대기 중'}
            </span>
          </div>
        ) : (
          <>
            {/* Main Stats Row */}
            <div className="grid grid-cols-3 gap-2 mb-2">
              {/* Market Condition */}
              <div className="flex flex-col items-center p-1.5 rounded" style={{
                background: conditionConfig.bg,
                border: `1px solid ${conditionConfig.border}`,
              }}>
                <ConditionIcon className="w-4 h-4 mb-0.5" style={{ 
                  color: conditionConfig.color,
                  filter: `drop-shadow(0 0 4px ${conditionConfig.color}80)`,
                }} />
                <span className="text-[9px] font-medium" style={{ color: conditionConfig.color }}>
                  {conditionConfig.label}
                </span>
              </div>

              {/* Recommendation */}
              <div className="flex flex-col items-center p-1.5 rounded" style={{
                background: 'rgba(0, 255, 255, 0.08)',
                border: '1px solid rgba(0, 255, 255, 0.2)',
              }}>
                <RecommendIcon className="w-4 h-4 mb-0.5" style={{ 
                  color: recommendConfig.color,
                  filter: `drop-shadow(0 0 4px ${recommendConfig.color}80)`,
                }} />
                <span className="text-[9px] font-medium" style={{ color: recommendConfig.color }}>
                  {recommendConfig.label}
                </span>
              </div>

              {/* Confidence */}
              <div className="flex flex-col items-center p-1.5 rounded" style={{
                background: 'rgba(0, 255, 255, 0.08)',
                border: '1px solid rgba(0, 255, 255, 0.2)',
              }}>
                <span className="text-sm font-bold font-mono" style={{ 
                  color: confidenceColor,
                  textShadow: `0 0 8px ${confidenceColor}80`,
                }}>
                  {analysis.confidence}%
                </span>
                <span className="text-[9px] text-gray-500">신뢰도</span>
              </div>
            </div>

            {/* Reasoning */}
            <div className="text-[10px] text-gray-400 mb-1.5 line-clamp-1">
              {analysis.reasoning}
            </div>

            {/* Warnings */}
            {analysis.warnings.length > 0 && (
              <div className="flex items-start gap-1 p-1.5 rounded" style={{
                background: 'rgba(255, 200, 0, 0.1)',
                border: '1px solid rgba(255, 200, 0, 0.2)',
              }}>
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" style={{ color: '#ffcc00' }} />
                <span className="text-[9px]" style={{ color: '#ffcc00' }}>
                  {analysis.warnings[0]}
                </span>
              </div>
            )}

            {/* Adjustments Preview */}
            <div className="flex items-center gap-2 mt-1.5 text-[9px]">
              <span className="text-gray-500">조정:</span>
              <span style={{ color: analysis.adjustments.tpMultiplier >= 1 ? '#00ff88' : '#ff8800' }}>
                TP {analysis.adjustments.tpMultiplier >= 1 ? '+' : ''}{((analysis.adjustments.tpMultiplier - 1) * 100).toFixed(0)}%
              </span>
              <span style={{ color: analysis.adjustments.slMultiplier >= 1 ? '#ff8800' : '#00ff88' }}>
                SL {analysis.adjustments.slMultiplier >= 1 ? '+' : ''}{((analysis.adjustments.slMultiplier - 1) * 100).toFixed(0)}%
              </span>
              <span style={{ color: '#00ffff' }}>
                신뢰도 {analysis.adjustments.minConfidence}%+
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default MarketAnalysisPanel;
