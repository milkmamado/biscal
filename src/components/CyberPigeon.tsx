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
        speed: Math.random() * 0.5 + 0.3,
        size: Math.random() * 0.4 + 0.8,
        glitchOffset: Math.random() * 10,
      };
      setPigeons(prev => [...prev.slice(-2), newPigeon]);

      // 추격자들 생성 (비둘기 뒤에서 따라감)
      const baseY = 65 + Math.random() * 10;
      const newChasers: Chaser[] = [
        { id: Date.now() + 1, x: -70, y: baseY, type: 'bikini', delay: 0 },
        { id: Date.now() + 2, x: -95, y: baseY + 3, type: 'michael', delay: 20 },
        { id: Date.now() + 3, x: -120, y: baseY + 1, type: 'jason', delay: 40 },
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
          .map(c => ({ ...c, x: c.x + 0.35 }))
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
    }, 120);
    return () => clearInterval(runInterval);
  }, []);

  const renderChaser = (chaser: Chaser) => {
    const legOffset = runFrame % 2 === 0 ? 0 : 3;
    const armSwing = runFrame % 2 === 0 ? -2 : 2;

    if (chaser.type === 'bikini') {
      // 비키니 여성 - 금발 + 핑크 비키니
      return (
        <svg width="40" height="64" viewBox="0 0 40 64" className="drop-shadow-[0_0_6px_rgba(255,105,180,0.9)]">
          {/* 금발 머리카락 */}
          <rect x="12" y="0" width="16" height="4" fill="#FFD700" />
          <rect x="10" y="4" width="20" height="4" fill="#FFD700" />
          <rect x="8" y="8" width="6" height="16" fill="#FFD700" />
          <rect x="26" y="8" width="6" height="16" fill="#FFD700" />
          
          {/* 얼굴 */}
          <rect x="12" y="4" width="16" height="14" fill="#FFD5C2" />
          
          {/* 눈 */}
          <rect x="14" y="8" width="4" height="3" fill="#4169E1" />
          <rect x="22" y="8" width="4" height="3" fill="#4169E1" />
          <rect x="15" y="9" width="2" height="1" fill="#000" />
          <rect x="23" y="9" width="2" height="1" fill="#000" />
          
          {/* 입 (놀란 표정) */}
          <rect x="17" y="14" width="6" height="2" fill="#FF6B6B" />
          
          {/* 목 */}
          <rect x="16" y="18" width="8" height="4" fill="#FFD5C2" />
          
          {/* 비키니 상의 - 핫핑크 */}
          <rect x="10" y="22" width="8" height="6" fill="#FF1493" />
          <rect x="22" y="22" width="8" height="6" fill="#FF1493" />
          <rect x="18" y="23" width="4" height="2" fill="#FF1493" />
          
          {/* 몸통 (배) */}
          <rect x="12" y="28" width="16" height="8" fill="#FFD5C2" />
          
          {/* 비키니 하의 - 핫핑크 */}
          <rect x="12" y="36" width="16" height="6" fill="#FF1493" />
          
          {/* 팔 (달리는 동작) */}
          <rect x={4 + armSwing} y="22" width="6" height="14" fill="#FFD5C2" />
          <rect x={30 - armSwing} y="22" width="6" height="14" fill="#FFD5C2" />
          
          {/* 다리 (달리는 동작) */}
          <rect x="12" y={42 + legOffset} width="6" height="16" fill="#FFD5C2" />
          <rect x="22" y={42 - legOffset + 3} width="6" height="16" fill="#FFD5C2" />
          
          {/* 하이힐 */}
          <rect x="10" y={58 + legOffset} width="8" height="4" fill="#FF1493" />
          <rect x="8" y={60 + legOffset} width="4" height="3" fill="#FF1493" />
          <rect x="22" y={58 - legOffset + 3} width="8" height="4" fill="#FF1493" />
          <rect x="28" y={60 - legOffset + 3} width="4" height="3" fill="#FF1493" />
        </svg>
      );
    }

    if (chaser.type === 'michael') {
      // 마이클 마이어스 - 특징적인 하얀 마스크 + 검은 눈 + 칼
      return (
        <svg width="44" height="72" viewBox="0 0 44 72" className="drop-shadow-[0_0_6px_rgba(200,200,200,0.8)]">
          {/* 갈색 머리카락 */}
          <rect x="10" y="0" width="24" height="6" fill="#3D2314" />
          <rect x="8" y="4" width="6" height="10" fill="#3D2314" />
          <rect x="30" y="4" width="6" height="10" fill="#3D2314" />
          
          {/* 하얀 마스크 - 핵심 특징! */}
          <rect x="10" y="4" width="24" height="22" fill="#F5F5F0" />
          
          {/* 검은 눈구멍 - 무표정한 공포 */}
          <rect x="13" y="10" width="6" height="5" fill="#000000" />
          <rect x="25" y="10" width="6" height="5" fill="#000000" />
          
          {/* 코 그림자 */}
          <rect x="20" y="14" width="4" height="6" fill="#E5E5E0" />
          
          {/* 입 (무표정) */}
          <rect x="16" y="21" width="12" height="2" fill="#CCCCCC" />
          
          {/* 목 */}
          <rect x="16" y="26" width="12" height="4" fill="#F5F5F0" />
          
          {/* 네이비 점프수트 상체 */}
          <rect x="8" y="30" width="28" height="18" fill="#1C3A5F" />
          
          {/* 팔 (점프수트) */}
          <rect x={2 + armSwing} y="30" width="8" height="18" fill="#1C3A5F" />
          <rect x={34 - armSwing} y="30" width="8" height="18" fill="#1C3A5F" />
          
          {/* 손 */}
          <rect x={2 + armSwing} y="46" width="6" height="6" fill="#F5F5F0" />
          <rect x={36 - armSwing} y="46" width="6" height="6" fill="#F5F5F0" />
          
          {/* 큰 부엌칼! */}
          <rect x={38 - armSwing} y="38" width="4" height="20" fill="#C0C0C0" />
          <rect x={37 - armSwing} y="56" width="6" height="6" fill="#4A3728" />
          
          {/* 네이비 점프수트 하체 */}
          <rect x="10" y="48" width="10" height="16" fill="#1C3A5F" />
          <rect x="24" y="48" width="10" height="16" fill="#1C3A5F" />
          
          {/* 다리 (달리는 동작) */}
          <rect x="10" y={48 + legOffset} width="10" height="16" fill="#1C3A5F" />
          <rect x="24" y={48 - legOffset + 3} width="10" height="16" fill="#1C3A5F" />
          
          {/* 검은 부츠 */}
          <rect x="8" y={64 + legOffset} width="12" height="6" fill="#000000" />
          <rect x="24" y={64 - legOffset + 3} width="12" height="6" fill="#000000" />
        </svg>
      );
    }

    if (chaser.type === 'jason') {
      // 제이슨 보히스 - 하키마스크 + 빨간 삼각형 표시 + 마체테
      return (
        <svg width="48" height="76" viewBox="0 0 48 76" className="drop-shadow-[0_0_8px_rgba(139,0,0,0.8)]">
          {/* 대머리 (마스크 위) */}
          <rect x="14" y="0" width="20" height="6" fill="#8B7355" />
          
          {/* 하키 마스크 - 베이지/아이보리 */}
          <rect x="10" y="4" width="28" height="24" fill="#F5DEB3" />
          
          {/* 마스크 구멍들 */}
          <rect x="8" y="8" width="4" height="4" fill="#000" />
          <rect x="36" y="8" width="4" height="4" fill="#000" />
          <rect x="8" y="16" width="4" height="4" fill="#000" />
          <rect x="36" y="16" width="4" height="4" fill="#000" />
          
          {/* 눈구멍 - 삼각형 모양 */}
          <rect x="14" y="10" width="6" height="6" fill="#000" />
          <rect x="28" y="10" width="6" height="6" fill="#000" />
          
          {/* 빨간 삼각형 표시 - 제이슨의 상징! */}
          <rect x="21" y="6" width="6" height="2" fill="#8B0000" />
          <rect x="22" y="8" width="4" height="2" fill="#8B0000" />
          <rect x="23" y="10" width="2" height="2" fill="#8B0000" />
          
          {/* 코 구멍 */}
          <rect x="21" y="16" width="2" height="3" fill="#8B7355" />
          <rect x="25" y="16" width="2" height="3" fill="#8B7355" />
          
          {/* 입 통풍구 */}
          <rect x="18" y="22" width="12" height="4" fill="#4A3728" />
          <rect x="20" y="23" width="2" height="2" fill="#000" />
          <rect x="24" y="23" width="2" height="2" fill="#000" />
          
          {/* 목 */}
          <rect x="18" y="28" width="12" height="4" fill="#8B7355" />
          
          {/* 낡은 재킷 - 올리브/카키 */}
          <rect x="6" y="32" width="36" height="20" fill="#556B2F" />
          <rect x="20" y="32" width="8" height="20" fill="#4A5D23" />
          
          {/* 팔 */}
          <rect x={0 + armSwing} y="32" width="8" height="20" fill="#556B2F" />
          <rect x={40 - armSwing} y="32" width="8" height="20" fill="#556B2F" />
          
          {/* 손 */}
          <rect x={0 + armSwing} y="50" width="6" height="6" fill="#8B7355" />
          <rect x={42 - armSwing} y="50" width="6" height="6" fill="#8B7355" />
          
          {/* 마체테! - 더 크고 무서운 */}
          <rect x={44 - armSwing} y="32" width="4" height="30" fill="#A9A9A9" />
          <rect x={43 - armSwing} y="30" width="6" height="4" fill="#A9A9A9" />
          <rect x={44 - armSwing} y="60" width="4" height="8" fill="#4A3728" />
          
          {/* 피 묻은 얼룩 */}
          <rect x="12" y="38" width="4" height="4" fill="#8B0000" />
          <rect x="32" y="44" width="3" height="5" fill="#8B0000" />
          
          {/* 다리 */}
          <rect x="10" y={52 + legOffset} width="12" height="18" fill="#2F4F4F" />
          <rect x="26" y={52 - legOffset + 3} width="12" height="18" fill="#2F4F4F" />
          
          {/* 부츠 */}
          <rect x="8" y={68 + legOffset} width="14" height="6" fill="#000000" />
          <rect x="26" y={68 - legOffset + 3} width="14" height="6" fill="#000000" />
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
            transform: `scale(${chaser.type === 'jason' ? 0.7 : chaser.type === 'michael' ? 0.65 : 0.6})`,
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
