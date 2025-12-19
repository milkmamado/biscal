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
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* 메인 네온 문구 */}
      <div 
        className="absolute top-[15%] left-1/2 -translate-x-1/2"
        style={{
          transform: `translateX(-50%) translateX(${glitchOffset}px)`,
          opacity: flicker ? 0.3 : 1,
        }}
      >
        {/* 일본어 메인 텍스트 */}
        <div className="relative">
          {/* 글로우 레이어들 */}
          <div className="absolute inset-0 blur-xl text-cyan-400 text-5xl md:text-7xl font-bold tracking-wider opacity-60">
            未来は今
          </div>
          <div className="absolute inset-0 blur-md text-cyan-300 text-5xl md:text-7xl font-bold tracking-wider opacity-80">
            未来は今
          </div>
          
          {/* 메인 텍스트 */}
          <h1 
            className="relative text-5xl md:text-7xl font-bold tracking-wider"
            style={{
              color: '#00f5ff',
              textShadow: `
                0 0 5px #00f5ff,
                0 0 10px #00f5ff,
                0 0 20px #00f5ff,
                0 0 40px #0ff,
                0 0 80px #0ff,
                ${glitchFrame % 3 === 0 ? '3px 0 #ff00ff, -3px 0 #00ffff' : '0 0 transparent'}
              `,
            }}
          >
            未来は今
          </h1>
          
          {/* 서브 텍스트 */}
          <p 
            className="text-center text-lg md:text-xl mt-3 tracking-[0.5em] uppercase"
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
      </div>

      {/* 부가 한자 문구들 - 왼쪽 */}
      <div 
        className="absolute top-[40%] left-[5%] writing-mode-vertical"
        style={{
          writingMode: 'vertical-rl',
          opacity: flicker ? 0.5 : 0.7,
        }}
      >
        <span 
          className="text-2xl md:text-3xl font-bold tracking-[0.3em]"
          style={{
            color: '#ff6b9d',
            textShadow: `
              0 0 5px #ff6b9d,
              0 0 15px #ff6b9d,
              0 0 30px #ff1493
            `,
          }}
        >
          電脳都市
        </span>
      </div>

      {/* 부가 한자 문구들 - 오른쪽 */}
      <div 
        className="absolute top-[35%] right-[5%]"
        style={{
          writingMode: 'vertical-rl',
          opacity: flicker ? 0.5 : 0.7,
        }}
      >
        <span 
          className="text-2xl md:text-3xl font-bold tracking-[0.3em]"
          style={{
            color: '#7b68ee',
            textShadow: `
              0 0 5px #7b68ee,
              0 0 15px #7b68ee,
              0 0 30px #9370db
            `,
          }}
        >
          無限大
        </span>
      </div>

      {/* 하단 네온 슬로건 */}
      <div 
        className="absolute bottom-[15%] left-1/2 -translate-x-1/2"
        style={{
          transform: `translateX(-50%) translateX(${-glitchOffset}px)`,
        }}
      >
        <div className="flex gap-6 md:gap-12 items-center">
          <span 
            className="text-xl md:text-2xl"
            style={{
              color: '#00ff88',
              textShadow: '0 0 10px #00ff88, 0 0 20px #00ff88',
            }}
          >
            夢
          </span>
          <span className="text-cyan-500/50">●</span>
          <span 
            className="text-xl md:text-2xl"
            style={{
              color: '#ffff00',
              textShadow: '0 0 10px #ffff00, 0 0 20px #ffff00',
            }}
          >
            希望
          </span>
          <span className="text-cyan-500/50">●</span>
          <span 
            className="text-xl md:text-2xl"
            style={{
              color: '#ff6600',
              textShadow: '0 0 10px #ff6600, 0 0 20px #ff6600',
            }}
          >
            革命
          </span>
        </div>
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
            className="absolute h-[1px] bg-magenta-400/60"
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
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,255,0.1) 2px, rgba(0,255,255,0.1) 4px)',
        }}
      />

      {/* 하단 네온 라인 데코레이션 */}
      <div className="absolute bottom-1 left-4 right-4 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
    </div>
  );
};

export default CyberPigeon;
