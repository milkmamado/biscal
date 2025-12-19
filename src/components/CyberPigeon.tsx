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

interface Chaser {
  id: number;
  x: number;
  y: number;
  type: 'bikini' | 'michael' | 'jason';
  delay: number;
}

const CyberPigeon = () => {
  const [pigeons, setPigeons] = useState<Pigeon[]>([]);
  const [chasers, setChasers] = useState<Chaser[]>([]);
  const [glitchFrame, setGlitchFrame] = useState(0);
  const [runFrame, setRunFrame] = useState(0);

  // 비둘기 생성
  useEffect(() => {
    const createPigeon = () => {
      const newPigeon: Pigeon = {
        id: Date.now() + Math.random(),
        x: -50,
        y: Math.random() * 20 + 5,
        speed: Math.random() * 0.5 + 0.3, // 속도 줄임
        size: Math.random() * 0.4 + 0.8,
        glitchOffset: Math.random() * 10,
      };
      setPigeons(prev => [...prev.slice(-2), newPigeon]);

      // 추격자들 생성 (비둘기 뒤에서 따라감)
      const baseY = 70 + Math.random() * 15;
      const newChasers: Chaser[] = [
        { id: Date.now() + 1, x: -80, y: baseY, type: 'bikini', delay: 0 },
        { id: Date.now() + 2, x: -100, y: baseY + 2, type: 'michael', delay: 20 },
        { id: Date.now() + 3, x: -120, y: baseY + 4, type: 'jason', delay: 40 },
      ];
      setChasers(prev => [...prev.slice(-6), ...newChasers]);
    };

    createPigeon();
    const interval = setInterval(createPigeon, 12000 + Math.random() * 5000);
    return () => clearInterval(interval);
  }, []);

  // 비둘기 이동 (느리게)
  useEffect(() => {
    const moveInterval = setInterval(() => {
      setPigeons(prev => 
        prev
          .map(p => ({ ...p, x: p.x + p.speed }))
          .filter(p => p.x < 110)
      );
      setChasers(prev =>
        prev
          .map(c => ({ ...c, x: c.x + 0.4 })) // 추격자 속도
          .filter(c => c.x < 110)
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

  // 달리기 애니메이션
  useEffect(() => {
    const runInterval = setInterval(() => {
      setRunFrame(prev => (prev + 1) % 4);
    }, 100);
    return () => clearInterval(runInterval);
  }, []);

  const renderChaser = (chaser: Chaser) => {
    const legOffset = runFrame % 2 === 0 ? 0 : 2;
    const armOffset = runFrame % 2 === 0 ? -1 : 1;

    if (chaser.type === 'bikini') {
      return (
        <svg width="24" height="36" viewBox="0 0 24 36" className="drop-shadow-[0_0_4px_rgba(255,105,180,0.8)]">
          {/* 머리 */}
          <rect x="8" y="0" width="8" height="6" fill="#FFD5B4" />
          {/* 머리카락 */}
          <rect x="6" y="0" width="12" height="3" fill="#8B4513" />
          <rect x="5" y="3" width="2" height="8" fill="#8B4513" />
          <rect x="17" y="3" width="2" height="8" fill="#8B4513" />
          {/* 몸통 */}
          <rect x="8" y="6" width="8" height="10" fill="#FFD5B4" />
          {/* 비키니 상의 */}
          <rect x="9" y="7" width="3" height="3" fill="#FF1493" />
          <rect x="13" y="7" width="3" height="3" fill="#FF1493" />
          {/* 비키니 하의 */}
          <rect x="9" y="14" width="6" height="3" fill="#FF1493" />
          {/* 팔 */}
          <rect x={3 + armOffset} y="8" width="4" height="2" fill="#FFD5B4" />
          <rect x={17 - armOffset} y="8" width="4" height="2" fill="#FFD5B4" />
          {/* 다리 */}
          <rect x="9" y={17 + legOffset} width="2" height="10" fill="#FFD5B4" />
          <rect x="13" y={17 - legOffset + 2} width="2" height="10" fill="#FFD5B4" />
        </svg>
      );
    }

    if (chaser.type === 'michael') {
      return (
        <svg width="24" height="40" viewBox="0 0 24 40" className="drop-shadow-[0_0_4px_rgba(100,100,100,0.8)]">
          {/* 마이클 마이어스 - 하얀 마스크 */}
          <rect x="8" y="0" width="8" height="8" fill="#F5F5DC" />
          {/* 눈 구멍 */}
          <rect x="9" y="3" width="2" height="2" fill="#000" />
          <rect x="13" y="3" width="2" height="2" fill="#000" />
          {/* 머리카락 */}
          <rect x="7" y="0" width="10" height="2" fill="#2F1810" />
          {/* 점프수트 */}
          <rect x="6" y="8" width="12" height="14" fill="#1C3A5F" />
          {/* 팔 */}
          <rect x={2 + armOffset} y="10" width="4" height="8" fill="#1C3A5F" />
          <rect x={18 - armOffset} y="10" width="4" height="8" fill="#1C3A5F" />
          {/* 칼 */}
          <rect x={20 - armOffset} y="8" width="2" height="12" fill="#C0C0C0" />
          {/* 다리 */}
          <rect x="7" y={22 + legOffset} width="4" height="12" fill="#1C3A5F" />
          <rect x="13" y={22 - legOffset + 2} width="4" height="12" fill="#1C3A5F" />
          {/* 부츠 */}
          <rect x="6" y="32" width="5" height="4" fill="#000" />
          <rect x="13" y="32" width="5" height="4" fill="#000" />
        </svg>
      );
    }

    if (chaser.type === 'jason') {
      return (
        <svg width="28" height="44" viewBox="0 0 28 44" className="drop-shadow-[0_0_4px_rgba(255,0,0,0.6)]">
          {/* 제이슨 보히스 - 하키 마스크 */}
          <rect x="10" y="0" width="8" height="10" fill="#F0E68C" />
          {/* 마스크 표시 */}
          <rect x="11" y="2" width="2" height="3" fill="#8B0000" />
          <rect x="15" y="2" width="2" height="3" fill="#8B0000" />
          <rect x="13" y="6" width="2" height="2" fill="#8B0000" />
          {/* 빨간 마크 */}
          <rect x="12" y="4" width="4" height="1" fill="#8B0000" />
          {/* 몸통 (낡은 재킷) */}
          <rect x="6" y="10" width="16" height="14" fill="#556B2F" />
          {/* 팔 */}
          <rect x={1 + armOffset} y="12" width="5" height="10" fill="#556B2F" />
          <rect x={22 - armOffset} y="12" width="5" height="10" fill="#556B2F" />
          {/* 마체테 */}
          <rect x={24 - armOffset} y="10" width="3" height="16" fill="#A9A9A9" />
          <rect x={24 - armOffset} y="8" width="3" height="3" fill="#8B4513" />
          {/* 다리 */}
          <rect x="8" y={24 + legOffset} width="5" height="14" fill="#2F4F4F" />
          <rect x="15" y={24 - legOffset + 2} width="5" height="14" fill="#2F4F4F" />
          {/* 부츠 */}
          <rect x="7" y="36" width="6" height="5" fill="#000" />
          <rect x="15" y="36" width="6" height="5" fill="#000" />
        </svg>
      );
    }

    return null;
  };

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
              <rect x="14" y="4" width="4" height="2" fill="#00ffcc" />
              <rect x="18" y="5" width="2" height="1" fill="#ff00ff" />
              
              <rect x="12" y="6" width="8" height="4" fill="#00e5ff" />
              <rect x="8" y="8" width="16" height="6" fill="#00bcd4" />
              
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
              
              <rect x="4" y="10" width="4" height="2" fill="#e040fb" />
              <rect x="2" y="9" width="2" height="4" fill="#e040fb" />
              
              <rect x="20" y="6" width="3" height="2" fill="#ffab00" />
              
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

      {/* 추격자들 */}
      {chasers.map((chaser) => (
        <div
          key={chaser.id}
          className="absolute transition-transform"
          style={{
            left: `${chaser.x}%`,
            top: `${chaser.y}%`,
            transform: `scale(0.8)`,
            zIndex: chaser.type === 'jason' ? 3 : chaser.type === 'michael' ? 2 : 1,
          }}
        >
          {renderChaser(chaser)}
        </div>
      ))}
      
      {/* 하단 네온 라인 데코레이션 */}
      <div className="absolute bottom-1 left-4 right-4 h-px bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
    </div>
  );
};

export default CyberPigeon;
