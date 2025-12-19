import { useEffect, useState } from 'react';

interface Chaser {
  id: number;
  x: number;
  y: number;
  type: 'bikini' | 'michael' | 'jason';
}

const CyberPigeon = () => {
  const [chasers, setChasers] = useState<Chaser[]>([]);
  const [runFrame, setRunFrame] = useState(0);

  // 캐릭터들 생성
  useEffect(() => {
    const createChasers = () => {
      const baseY = 55 + Math.random() * 10;
      const newChasers: Chaser[] = [
        { id: Date.now() + 1, x: -30, y: baseY, type: 'bikini' },
        { id: Date.now() + 2, x: -55, y: baseY + 5, type: 'michael' },
        { id: Date.now() + 3, x: -80, y: baseY + 2, type: 'jason' },
      ];
      setChasers(prev => [...prev.slice(-6), ...newChasers]);
    };

    createChasers();
    const interval = setInterval(createChasers, 15000 + Math.random() * 5000);
    return () => clearInterval(interval);
  }, []);

  // 캐릭터 이동
  useEffect(() => {
    const moveInterval = setInterval(() => {
      setChasers(prev =>
        prev
          .map(c => ({ ...c, x: c.x + 0.25 }))
          .filter(c => c.x < 110)
      );
    }, 50);
    return () => clearInterval(moveInterval);
  }, []);

  // 달리기 애니메이션
  useEffect(() => {
    const runInterval = setInterval(() => {
      setRunFrame(prev => (prev + 1) % 4);
    }, 120);
    return () => clearInterval(runInterval);
  }, []);

  const renderChaser = (chaser: Chaser) => {
    const legOffset = runFrame % 2 === 0 ? 0 : 4;
    const armSwing = runFrame % 2 === 0 ? -3 : 3;

    if (chaser.type === 'bikini') {
      // 비키니 여성 - 금발 + 핑크 비키니
      return (
        <svg width="60" height="100" viewBox="0 0 60 100" className="drop-shadow-[0_0_10px_rgba(255,105,180,0.9)]">
          {/* 금발 머리카락 */}
          <rect x="18" y="0" width="24" height="6" fill="#FFD700" />
          <rect x="15" y="6" width="30" height="6" fill="#FFD700" />
          <rect x="12" y="12" width="10" height="24" fill="#FFD700" />
          <rect x="38" y="12" width="10" height="24" fill="#FFD700" />
          
          {/* 얼굴 */}
          <rect x="18" y="6" width="24" height="22" fill="#FFD5C2" />
          
          {/* 눈 */}
          <rect x="21" y="12" width="6" height="5" fill="#4169E1" />
          <rect x="33" y="12" width="6" height="5" fill="#4169E1" />
          <rect x="23" y="14" width="3" height="2" fill="#000" />
          <rect x="35" y="14" width="3" height="2" fill="#000" />
          
          {/* 속눈썹 */}
          <rect x="21" y="11" width="6" height="1" fill="#000" />
          <rect x="33" y="11" width="6" height="1" fill="#000" />
          
          {/* 입 (놀란 표정) */}
          <rect x="26" y="22" width="8" height="4" fill="#FF6B6B" />
          
          {/* 목 */}
          <rect x="24" y="28" width="12" height="6" fill="#FFD5C2" />
          
          {/* 비키니 상의 - 핫핑크 */}
          <rect x="15" y="34" width="12" height="10" fill="#FF1493" />
          <rect x="33" y="34" width="12" height="10" fill="#FF1493" />
          <rect x="27" y="36" width="6" height="3" fill="#FF1493" />
          
          {/* 몸통 (배) */}
          <rect x="18" y="44" width="24" height="12" fill="#FFD5C2" />
          
          {/* 비키니 하의 - 핫핑크 */}
          <rect x="18" y="56" width="24" height="10" fill="#FF1493" />
          
          {/* 팔 (달리는 동작) */}
          <rect x={6 + armSwing} y="34" width="9" height="22" fill="#FFD5C2" />
          <rect x={45 - armSwing} y="34" width="9" height="22" fill="#FFD5C2" />
          
          {/* 다리 (달리는 동작) */}
          <rect x="18" y={66 + legOffset} width="9" height="24" fill="#FFD5C2" />
          <rect x="33" y={66 - legOffset + 4} width="9" height="24" fill="#FFD5C2" />
          
          {/* 하이힐 */}
          <rect x="15" y={90 + legOffset} width="12" height="6" fill="#FF1493" />
          <rect x="12" y={93 + legOffset} width="6" height="5" fill="#FF1493" />
          <rect x="33" y={90 - legOffset + 4} width="12" height="6" fill="#FF1493" />
          <rect x="42" y={93 - legOffset + 4} width="6" height="5" fill="#FF1493" />
        </svg>
      );
    }

    if (chaser.type === 'michael') {
      // 마이클 마이어스 - 특징적인 하얀 마스크 + 검은 눈 + 칼
      return (
        <svg width="66" height="110" viewBox="0 0 66 110" className="drop-shadow-[0_0_10px_rgba(200,200,200,0.8)]">
          {/* 갈색 머리카락 */}
          <rect x="15" y="0" width="36" height="9" fill="#3D2314" />
          <rect x="12" y="6" width="9" height="15" fill="#3D2314" />
          <rect x="45" y="6" width="9" height="15" fill="#3D2314" />
          
          {/* 하얀 마스크 - 핵심 특징! */}
          <rect x="15" y="6" width="36" height="33" fill="#F5F5F0" />
          
          {/* 검은 눈구멍 - 무표정한 공포 */}
          <rect x="20" y="15" width="9" height="8" fill="#000000" />
          <rect x="38" y="15" width="9" height="8" fill="#000000" />
          
          {/* 코 그림자 */}
          <rect x="30" y="21" width="6" height="9" fill="#E5E5E0" />
          
          {/* 입 (무표정) */}
          <rect x="24" y="32" width="18" height="3" fill="#CCCCCC" />
          
          {/* 목 */}
          <rect x="24" y="39" width="18" height="6" fill="#F5F5F0" />
          
          {/* 네이비 점프수트 상체 */}
          <rect x="12" y="45" width="42" height="27" fill="#1C3A5F" />
          
          {/* 팔 (점프수트) */}
          <rect x={3 + armSwing} y="45" width="12" height="27" fill="#1C3A5F" />
          <rect x={51 - armSwing} y="45" width="12" height="27" fill="#1C3A5F" />
          
          {/* 손 */}
          <rect x={3 + armSwing} y="69" width="9" height="9" fill="#F5F5F0" />
          <rect x={54 - armSwing} y="69" width="9" height="9" fill="#F5F5F0" />
          
          {/* 큰 부엌칼! */}
          <rect x={57 - armSwing} y="57" width="6" height="30" fill="#C0C0C0" />
          <rect x={55 - armSwing} y="84" width="9" height="9" fill="#4A3728" />
          
          {/* 네이비 점프수트 하체 */}
          <rect x="15" y={72 + legOffset} width="15" height="24" fill="#1C3A5F" />
          <rect x="36" y={72 - legOffset + 4} width="15" height="24" fill="#1C3A5F" />
          
          {/* 검은 부츠 */}
          <rect x="12" y={96 + legOffset} width="18" height="9" fill="#000000" />
          <rect x="36" y={96 - legOffset + 4} width="18" height="9" fill="#000000" />
        </svg>
      );
    }

    if (chaser.type === 'jason') {
      // 제이슨 보히스 - 하키마스크 + 빨간 삼각형 표시 + 마체테
      return (
        <svg width="72" height="118" viewBox="0 0 72 118" className="drop-shadow-[0_0_12px_rgba(139,0,0,0.8)]">
          {/* 대머리 (마스크 위) */}
          <rect x="21" y="0" width="30" height="9" fill="#8B7355" />
          
          {/* 하키 마스크 - 베이지/아이보리 */}
          <rect x="15" y="6" width="42" height="36" fill="#F5DEB3" />
          
          {/* 마스크 구멍들 */}
          <rect x="12" y="12" width="6" height="6" fill="#000" />
          <rect x="54" y="12" width="6" height="6" fill="#000" />
          <rect x="12" y="24" width="6" height="6" fill="#000" />
          <rect x="54" y="24" width="6" height="6" fill="#000" />
          
          {/* 눈구멍 - 삼각형 모양 */}
          <rect x="21" y="15" width="9" height="9" fill="#000" />
          <rect x="42" y="15" width="9" height="9" fill="#000" />
          
          {/* 빨간 삼각형 표시 - 제이슨의 상징! */}
          <rect x="32" y="9" width="9" height="3" fill="#8B0000" />
          <rect x="33" y="12" width="6" height="3" fill="#8B0000" />
          <rect x="35" y="15" width="3" height="3" fill="#8B0000" />
          
          {/* 코 구멍 */}
          <rect x="32" y="24" width="3" height="5" fill="#8B7355" />
          <rect x="38" y="24" width="3" height="5" fill="#8B7355" />
          
          {/* 입 통풍구 */}
          <rect x="27" y="33" width="18" height="6" fill="#4A3728" />
          <rect x="30" y="35" width="3" height="3" fill="#000" />
          <rect x="36" y="35" width="3" height="3" fill="#000" />
          
          {/* 목 */}
          <rect x="27" y="42" width="18" height="6" fill="#8B7355" />
          
          {/* 낡은 재킷 - 올리브/카키 */}
          <rect x="9" y="48" width="54" height="30" fill="#556B2F" />
          <rect x="30" y="48" width="12" height="30" fill="#4A5D23" />
          
          {/* 팔 */}
          <rect x={0 + armSwing} y="48" width="12" height="30" fill="#556B2F" />
          <rect x={60 - armSwing} y="48" width="12" height="30" fill="#556B2F" />
          
          {/* 손 */}
          <rect x={0 + armSwing} y="75" width="9" height="9" fill="#8B7355" />
          <rect x={63 - armSwing} y="75" width="9" height="9" fill="#8B7355" />
          
          {/* 마체테! - 더 크고 무서운 */}
          <rect x={66 - armSwing} y="48" width="6" height="45" fill="#A9A9A9" />
          <rect x={64 - armSwing} y="45" width="9" height="6" fill="#A9A9A9" />
          <rect x={66 - armSwing} y="90" width="6" height="12" fill="#4A3728" />
          
          {/* 피 묻은 얼룩 */}
          <rect x="18" y="57" width="6" height="6" fill="#8B0000" />
          <rect x="48" y="66" width="5" height="8" fill="#8B0000" />
          
          {/* 다리 */}
          <rect x="15" y={78 + legOffset} width="18" height="27" fill="#2F4F4F" />
          <rect x="39" y={78 - legOffset + 4} width="18" height="27" fill="#2F4F4F" />
          
          {/* 부츠 */}
          <rect x="12" y={102 + legOffset} width="21" height="9" fill="#000000" />
          <rect x="39" y={102 - legOffset + 4} width="21" height="9" fill="#000000" />
        </svg>
      );
    }

    return null;
  };

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* 캐릭터들 */}
      {chasers.map((chaser) => (
        <div
          key={chaser.id}
          className="absolute transition-transform"
          style={{
            left: `${chaser.x}%`,
            top: `${chaser.y}%`,
            transform: `scale(${chaser.type === 'jason' ? 1 : chaser.type === 'michael' ? 0.95 : 0.9})`,
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
