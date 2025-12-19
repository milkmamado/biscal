import { useEffect, useState } from 'react';

const CyberPigeon = () => {
  const [glitchFrame, setGlitchFrame] = useState(0);
  const [flicker, setFlicker] = useState(false);

  // 글리치 애니메이션
  useEffect(() => {
    const glitchInterval = setInterval(() => {
      setGlitchFrame(prev => (prev + 1) % 10);
    }, 150);
    return () => clearInterval(glitchInterval);
  }, []);

  // 깜빡임 효과
  useEffect(() => {
    const flickerInterval = setInterval(() => {
      if (Math.random() > 0.7) {
        setFlicker(true);
        setTimeout(() => setFlicker(false), 50 + Math.random() * 100);
      }
    }, 2000);
    return () => clearInterval(flickerInterval);
  }, []);

  const glitchOffset = glitchFrame % 2 === 0 ? 0 : (Math.random() - 0.5) * 2;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none flex items-center justify-center">
      {/* 메인 네온 문구 - 중앙 */}
      <div 
        className="relative flex items-center gap-8"
        style={{
          transform: `translateX(${glitchOffset}px)`,
          opacity: flicker ? 0.4 : 1,
        }}
      >
        {/* 왼쪽 한자 */}
        <span 
          className="text-lg font-bold tracking-wider neon-pulse"
          style={{
            color: '#ff6b9d',
            textShadow: `
              0 0 5px #ff6b9d,
              0 0 15px #ff6b9d,
              0 0 30px #ff1493,
              0 0 50px #ff1493
            `,
          }}
        >
          電脳都市
        </span>

        {/* 구분자 */}
        <span 
          className="text-cyan-400/60 text-2xl"
          style={{
            textShadow: '0 0 10px #00ffff',
          }}
        >
          ◆
        </span>

        {/* 메인 일본어 텍스트 */}
        <div className="relative">
          {/* 외부 글로우 */}
          <div className="absolute inset-0 blur-lg text-cyan-400 text-2xl font-bold tracking-wider opacity-70">
            未来は今
          </div>
          
          {/* 메인 텍스트 */}
          <h1 
            className="relative text-2xl font-bold tracking-wider"
            style={{
              color: '#00f5ff',
              textShadow: `
                0 0 5px #00f5ff,
                0 0 10px #00f5ff,
                0 0 20px #00f5ff,
                0 0 40px #0ff,
                0 0 60px #0ff,
                ${glitchFrame % 3 === 0 ? '2px 0 #ff00ff, -2px 0 #00ffff' : '0 0 transparent'}
              `,
            }}
          >
            未来は今
          </h1>
        </div>

        {/* 구분자 */}
        <span 
          className="text-pink-400/60 text-2xl"
          style={{
            textShadow: '0 0 10px #ff00ff',
          }}
        >
          ◆
        </span>

        {/* 오른쪽 한자 */}
        <span 
          className="text-lg font-bold tracking-wider neon-pulse"
          style={{
            color: '#7b68ee',
            textShadow: `
              0 0 5px #7b68ee,
              0 0 15px #7b68ee,
              0 0 30px #9370db,
              0 0 50px #9370db
            `,
          }}
        >
          無限大
        </span>
      </div>

      {/* 서브 텍스트 - 하단 */}
      <div 
        className="absolute bottom-2 left-1/2 -translate-x-1/2"
        style={{
          transform: `translateX(-50%) translateX(${-glitchOffset}px)`,
        }}
      >
        <p 
          className="text-xs tracking-[0.4em] uppercase font-mono"
          style={{
            color: '#ff00ff',
            textShadow: `
              0 0 5px #ff00ff,
              0 0 10px #ff00ff,
              0 0 20px #ff00ff
            `,
          }}
        >
          The Future is Now
        </p>
      </div>

      {/* 좌측 아이콘들 */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 flex gap-4">
        <span 
          className="text-lg"
          style={{
            color: '#00ff88',
            textShadow: '0 0 10px #00ff88, 0 0 20px #00ff88, 0 0 30px #00ff88',
          }}
        >
          夢
        </span>
        <span 
          className="text-lg"
          style={{
            color: '#ffff00',
            textShadow: '0 0 10px #ffff00, 0 0 20px #ffff00, 0 0 30px #ffff00',
          }}
        >
          希望
        </span>
      </div>

      {/* 우측 아이콘들 */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-4">
        <span 
          className="text-lg"
          style={{
            color: '#ff6600',
            textShadow: '0 0 10px #ff6600, 0 0 20px #ff6600, 0 0 30px #ff6600',
          }}
        >
          革命
        </span>
        <span 
          className="text-lg"
          style={{
            color: '#00ffff',
            textShadow: '0 0 10px #00ffff, 0 0 20px #00ffff, 0 0 30px #00ffff',
          }}
        >
          進化
        </span>
      </div>

      {/* 글리치 라인들 */}
      {glitchFrame % 5 === 0 && (
        <>
          <div 
            className="absolute h-[2px] bg-cyan-400/80 blur-[1px]"
            style={{
              top: `${20 + Math.random() * 60}%`,
              left: 0,
              right: 0,
              opacity: 0.6,
            }}
          />
          <div 
            className="absolute h-[1px]"
            style={{
              top: `${30 + Math.random() * 40}%`,
              left: 0,
              right: 0,
              background: 'linear-gradient(90deg, transparent, #ff00ff, transparent)',
            }}
          />
        </>
      )}

      {/* 스캔라인 오버레이 */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,255,0.1) 2px, rgba(0,255,255,0.1) 4px)',
        }}
      />
    </div>
  );
};

export default CyberPigeon;
