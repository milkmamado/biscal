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
      {/* 메인 히브리어 명언 - 중앙 */}
      <div 
        className="relative flex items-center gap-6"
        style={{
          transform: `translateX(${glitchOffset}px)`,
          opacity: flicker ? 0.4 : 1,
        }}
      >
        {/* 왼쪽 히브리어 - 삶 */}
        <span 
          className="text-xl font-bold tracking-wider"
          style={{
            color: '#00f5ff',
            textShadow: `
              0 0 5px #00f5ff,
              0 0 15px #00f5ff,
              0 0 30px #0ff,
              0 0 50px #0ff
            `,
            animation: 'pulse 2s ease-in-out infinite',
          }}
        >
          חַיִּים
        </span>

        {/* 구분자 - 다윗의 별 */}
        <span 
          className="text-cyan-400/70 text-xl"
          style={{
            textShadow: '0 0 10px #00ffff, 0 0 20px #00ffff',
            animation: 'spin 8s linear infinite',
          }}
        >
          ✡
        </span>

        {/* 메인 히브리어 명언 */}
        <div className="relative">
          {/* 외부 글로우 */}
          <div className="absolute inset-0 blur-lg text-cyan-400 text-lg font-bold tracking-wider opacity-70">
            בחר בחיים
          </div>
          
          {/* 메인 텍스트 - "Choose Life" (신명기 30:19) */}
          <h1 
            className="relative text-xl font-bold tracking-wider"
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
            בחר בחיים
          </h1>
        </div>

        {/* 구분자 - 다윗의 별 */}
        <span 
          className="text-pink-400/70 text-xl"
          style={{
            textShadow: '0 0 10px #ff00ff, 0 0 20px #ff00ff',
            animation: 'spin 8s linear infinite reverse',
          }}
        >
          ✡
        </span>

        {/* 오른쪽 히브리어 - 죽음 */}
        <span 
          className="text-xl font-bold tracking-wider"
          style={{
            color: '#ff6b9d',
            textShadow: `
              0 0 5px #ff6b9d,
              0 0 15px #ff6b9d,
              0 0 30px #ff1493,
              0 0 50px #ff1493
            `,
            animation: 'pulse 2s ease-in-out infinite 0.5s',
          }}
        >
          מָוֶת
        </span>
      </div>

      {/* 좌측 히브리어 */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 flex gap-4">
        <span 
          className="text-base"
          style={{
            color: '#00ff88',
            textShadow: '0 0 10px #00ff88, 0 0 20px #00ff88, 0 0 30px #00ff88',
          }}
        >
          תקווה
        </span>
        <span 
          className="text-base"
          style={{
            color: '#ffff00',
            textShadow: '0 0 10px #ffff00, 0 0 20px #ffff00, 0 0 30px #ffff00',
          }}
        >
          אמונה
        </span>
      </div>

      {/* 우측 히브리어 */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-4">
        <span 
          className="text-base"
          style={{
            color: '#ff6600',
            textShadow: '0 0 10px #ff6600, 0 0 20px #ff6600, 0 0 30px #ff6600',
          }}
        >
          גורל
        </span>
        <span 
          className="text-base"
          style={{
            color: '#00ffff',
            textShadow: '0 0 10px #00ffff, 0 0 20px #00ffff, 0 0 30px #00ffff',
          }}
        >
          נצח
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
