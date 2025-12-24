import { useState, useEffect } from 'react';
import { Star, Clock } from 'lucide-react';

// 스캘핑 시간대 적합도 데이터
const getScalpingRating = () => {
  const now = new Date();
  const koreaOffset = 9 * 60;
  const utcOffset = now.getTimezoneOffset();
  const koreaTime = new Date(now.getTime() + (koreaOffset + utcOffset) * 60 * 1000);
  const hour = koreaTime.getHours();
  
  if (hour >= 4 && hour < 8) {
    return { stars: 0, label: '데드존', color: '#6b7280', volume: '최저', volatility: '최저' };
  } else if (hour >= 8 && hour < 9) {
    return { stars: 1, label: '준비중', color: '#9ca3af', volume: '낮음', volatility: '낮음' };
  } else if (hour >= 9 && hour < 11) {
    return { stars: 3, label: '아시아장', color: '#eab308', volume: '보통', volatility: '보통' };
  } else if (hour >= 11 && hour < 16) {
    return { stars: 2, label: '점심휴식', color: '#f97316', volume: '낮음', volatility: '낮음' };
  } else if (hour >= 16 && hour < 18) {
    return { stars: 3, label: '유럽준비', color: '#eab308', volume: '보통', volatility: '상승' };
  } else if (hour >= 18 && hour < 21) {
    return { stars: 4, label: '유럽장', color: '#4ade80', volume: '높음', volatility: '높음' };
  } else if (hour >= 21 && hour < 24) {
    return { stars: 5, label: '골든타임', color: '#22c55e', volume: '최고', volatility: '최고' };
  } else if (hour >= 0 && hour < 2) {
    return { stars: 4, label: '미국장', color: '#4ade80', volume: '높음', volatility: '높음' };
  } else {
    return { stars: 1, label: '마감', color: '#9ca3af', volume: '낮음', volatility: '하락' };
  }
};

export function ScalpingRatingPanel() {
  const [rating, setRating] = useState(getScalpingRating());
  const [currentTime, setCurrentTime] = useState('');

  useEffect(() => {
    const updateRating = () => {
      setRating(getScalpingRating());
      const now = new Date();
      const koreaOffset = 9 * 60;
      const utcOffset = now.getTimezoneOffset();
      const koreaTime = new Date(now.getTime() + (koreaOffset + utcOffset) * 60 * 1000);
      setCurrentTime(koreaTime.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
    };

    updateRating();
    const interval = setInterval(updateRating, 60000); // 1분마다 업데이트
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="rounded-lg border border-border/50 overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-border/30"
        style={{
          background: 'linear-gradient(90deg, rgba(255, 200, 0, 0.1) 0%, rgba(200, 150, 0, 0.05) 100%)',
        }}
      >
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-yellow-400" />
          <span className="text-xs font-semibold text-foreground">스캘핑 적합도</span>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">{currentTime}</span>
      </div>

      {/* Content */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-bold"
              style={{ color: rating.color }}
            >
              {rating.label}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                className="w-3.5 h-3.5"
                style={{
                  color: i <= rating.stars ? '#fbbf24' : '#374151',
                  fill: i <= rating.stars ? '#fbbf24' : 'transparent',
                }}
              />
            ))}
          </div>
        </div>

        {/* 상세 정보 */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center justify-between px-2 py-1 rounded bg-background/50 border border-border/30">
            <span className="text-[9px] text-muted-foreground">거래량</span>
            <span className="text-[10px] font-semibold" style={{ color: rating.color }}>
              {rating.volume}
            </span>
          </div>
          <div className="flex items-center justify-between px-2 py-1 rounded bg-background/50 border border-border/30">
            <span className="text-[9px] text-muted-foreground">변동성</span>
            <span className="text-[10px] font-semibold" style={{ color: rating.color }}>
              {rating.volatility}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ScalpingRatingPanel;
