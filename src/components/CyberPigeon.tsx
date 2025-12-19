import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface Pigeon {
  id: number;
  x: number;
  y: number;
  speed: number;
  size: number;
  glitchOffset: number;
}

const CyberPigeon = () => {
  const [pigeons, setPigeons] = useState<Pigeon[]>([]);
  const [glitchFrame, setGlitchFrame] = useState(0);

  // 비둘기 생성
  useEffect(() => {
    const createPigeon = () => {
      const newPigeon: Pigeon = {
        id: Date.now() + Math.random(),
        x: -50,
        y: Math.random() * 30 + 5,
        speed: Math.random() * 2 + 1,
        size: Math.random() * 0.4 + 0.8,
        glitchOffset: Math.random() * 10,
      };
      setPigeons(prev => [...prev.slice(-2), newPigeon]); // 최대 3마리
    };

    // 처음 하나 생성
    createPigeon();
    
    // 주기적으로 생성
    const interval = setInterval(createPigeon, 8000 + Math.random() * 5000);
    return () => clearInterval(interval);
  }, []);

  // 비둘기 이동
  useEffect(() => {
    const moveInterval = setInterval(() => {
      setPigeons(prev => 
        prev
          .map(p => ({ ...p, x: p.x + p.speed }))
          .filter(p => p.x < 110)
      );
    }, 50);
    return () => clearInterval(moveInterval);
  }, []);

  // 글리치 효과
  useEffect(() => {
    const glitchInterval = setInterval(() => {
      setGlitchFrame(prev => (prev + 1) % 4);
    }, 150);
    return () => clearInterval(glitchInterval);
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {pigeons.map((pigeon) => (
        <div
          key={pigeon.id}
          className="absolute transition-transform"
          style={{
            left: `${pigeon.x}%`,
            top: `${pigeon.y}%`,
            transform: `scale(${pigeon.size})`,
          }}
        >
          {/* 글리치 레이어 */}
          <div 
            className="relative"
            style={{
              filter: glitchFrame === Math.floor(pigeon.glitchOffset) % 4 
                ? 'hue-rotate(90deg) brightness(1.5)' 
                : 'none',
            }}
          >
            {/* 비둘기 픽셀 아트 (네온 사이버펑크) */}
            <svg 
              width="32" 
              height="24" 
              viewBox="0 0 32 24"
              className={cn(
                "drop-shadow-[0_0_4px_rgba(0,255,255,0.8)]",
                glitchFrame % 2 === 0 && "animate-pulse"
              )}
            >
              {/* 글리치 오프셋 레이어 (빨강) */}
              <g 
                style={{ 
                  transform: glitchFrame === 1 ? 'translateX(1px)' : 'none',
                  opacity: glitchFrame === 1 ? 0.7 : 0,
                }}
              >
                <rect x="14" y="4" width="4" height="2" fill="#ff0040" />
                <rect x="12" y="6" width="8" height="4" fill="#ff0040" />
                <rect x="8" y="8" width="16" height="6" fill="#ff0040" />
              </g>
              
              {/* 글리치 오프셋 레이어 (파랑) */}
              <g 
                style={{ 
                  transform: glitchFrame === 3 ? 'translateX(-1px)' : 'none',
                  opacity: glitchFrame === 3 ? 0.7 : 0,
                }}
              >
                <rect x="14" y="4" width="4" height="2" fill="#00ffff" />
                <rect x="12" y="6" width="8" height="4" fill="#00ffff" />
                <rect x="8" y="8" width="16" height="6" fill="#00ffff" />
              </g>
              
              {/* 메인 비둘기 바디 */}
              {/* 머리 */}
              <rect x="14" y="4" width="4" height="2" fill="#00ffcc" />
              <rect x="18" y="5" width="2" height="1" fill="#ff00ff" /> {/* 눈 */}
              
              {/* 몸통 */}
              <rect x="12" y="6" width="8" height="4" fill="#00e5ff" />
              <rect x="8" y="8" width="16" height="6" fill="#00bcd4" />
              
              {/* 날개 (위아래 움직임) */}
              <rect 
                x="10" 
                y={glitchFrame % 2 === 0 ? "4" : "6"} 
                width="6" 
                height="3" 
                fill="#7c4dff" 
              />
              <rect 
                x="10" 
                y={glitchFrame % 2 === 0 ? "15" : "13"} 
                width="6" 
                height="3" 
                fill="#7c4dff" 
              />
              
              {/* 꼬리 */}
              <rect x="4" y="10" width="4" height="2" fill="#e040fb" />
              <rect x="2" y="9" width="2" height="4" fill="#e040fb" />
              
              {/* 부리 */}
              <rect x="20" y="6" width="3" height="2" fill="#ffab00" />
              
              {/* 네온 하이라이트 */}
              <rect x="14" y="8" width="2" height="2" fill="rgba(255,255,255,0.6)" />
            </svg>
            
            {/* 스캔라인 오버레이 */}
            <div 
              className="absolute inset-0 opacity-30"
              style={{
                background: 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,0,0,0.3) 1px, rgba(0,0,0,0.3) 2px)',
              }}
            />
          </div>
          
          {/* 트레일 효과 */}
          <div 
            className="absolute top-1/2 right-full w-8 h-px"
            style={{
              background: 'linear-gradient(to left, rgba(0,255,255,0.5), transparent)',
              transform: 'translateY(-50%)',
            }}
          />
        </div>
      ))}
      
      {/* 하단 네온 라인 데코레이션 */}
      <div className="absolute bottom-1 left-4 right-4 h-px bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
    </div>
  );
};

export default CyberPigeon;
