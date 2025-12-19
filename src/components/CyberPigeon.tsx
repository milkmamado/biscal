import { useEffect, useState } from 'react';

const CyberPigeon = () => {
  const [glitchFrame, setGlitchFrame] = useState(0);
  const [flicker, setFlicker] = useState(false);
  const [mothVisible, setMothVisible] = useState(false);
  const [mothPhase, setMothPhase] = useState(0);

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

  // 나방 나타났다 사라지는 효과
  useEffect(() => {
    const mothInterval = setInterval(() => {
      setMothVisible(true);
      setMothPhase(0);
      
      // 페이드인 후 유지
      setTimeout(() => setMothPhase(1), 100);
      
      // 사라지기 시작
      setTimeout(() => setMothPhase(2), 4000);
      
      // 완전히 사라짐
      setTimeout(() => {
        setMothVisible(false);
        setMothPhase(0);
      }, 4500);
    }, 8000);

    // 초기 표시
    setTimeout(() => {
      setMothVisible(true);
      setMothPhase(1);
    }, 1000);

    return () => clearInterval(mothInterval);
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
          className="text-xs tracking-[0.4em] uppercase font-mono font-bold"
          style={{
            color: '#ff00ff',
            textShadow: `
              0 0 5px #ff00ff,
              0 0 10px #ff00ff,
              0 0 20px #ff00ff,
              0 0 40px #ff00ff
            `,
          }}
        >
          Do or Die
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

      {/* 우측 - 飛蛾赴火 나방 효과 */}
      {mothVisible && (
        <div 
          className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3"
          style={{
            opacity: mothPhase === 0 ? 0 : mothPhase === 1 ? 1 : 0,
            transform: `translateY(-50%) scale(${mothPhase === 1 ? 1 : 0.9})`,
            transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
          }}
        >
          {/* 나방 SVG */}
          <div 
            className="relative"
            style={{
              animation: 'float 2s ease-in-out infinite',
            }}
          >
            <svg 
              width="40" 
              height="40" 
              viewBox="0 0 100 100" 
              className="drop-shadow-lg"
              style={{
                filter: 'drop-shadow(0 0 10px #ff6600) drop-shadow(0 0 20px #ff4400)',
              }}
            >
              {/* 나방 몸통 */}
              <ellipse cx="50" cy="50" rx="6" ry="15" fill="#ff8844" />
              
              {/* 왼쪽 날개 */}
              <path 
                d="M44 40 Q20 25 15 50 Q20 75 44 60 Q40 50 44 40" 
                fill="url(#wingGradient)"
                style={{
                  transformOrigin: '44px 50px',
                  animation: 'wingFlap 0.15s ease-in-out infinite alternate',
                }}
              />
              
              {/* 오른쪽 날개 */}
              <path 
                d="M56 40 Q80 25 85 50 Q80 75 56 60 Q60 50 56 40" 
                fill="url(#wingGradient)"
                style={{
                  transformOrigin: '56px 50px',
                  animation: 'wingFlap 0.15s ease-in-out infinite alternate-reverse',
                }}
              />
              
              {/* 날개 무늬 */}
              <circle cx="30" cy="45" r="5" fill="#ffcc00" opacity="0.7" />
              <circle cx="70" cy="45" r="5" fill="#ffcc00" opacity="0.7" />
              <circle cx="25" cy="55" r="3" fill="#ff00ff" opacity="0.6" />
              <circle cx="75" cy="55" r="3" fill="#ff00ff" opacity="0.6" />
              
              {/* 더듬이 */}
              <path d="M47 35 Q43 25 40 20" stroke="#ff8844" strokeWidth="2" fill="none" />
              <path d="M53 35 Q57 25 60 20" stroke="#ff8844" strokeWidth="2" fill="none" />
              <circle cx="40" cy="20" r="2" fill="#ffcc00" />
              <circle cx="60" cy="20" r="2" fill="#ffcc00" />
              
              {/* 그라디언트 정의 */}
              <defs>
                <linearGradient id="wingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ff6600" />
                  <stop offset="50%" stopColor="#ff4400" />
                  <stop offset="100%" stopColor="#cc2200" />
                </linearGradient>
              </defs>
            </svg>
            
            {/* 불꽃 파티클 */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
              {[0, 1, 2].map((i) => (
                <div 
                  key={i}
                  className="w-1 h-2 rounded-full"
                  style={{
                    background: 'linear-gradient(to top, #ff6600, #ffcc00)',
                    animation: `flameFlicker ${0.3 + i * 0.1}s ease-in-out infinite alternate`,
                    opacity: 0.8,
                  }}
                />
              ))}
            </div>
          </div>

          {/* 한자 문구 - 세로 배열 */}
          <div className="flex flex-col items-center gap-1">
            {['飛', '蛾', '赴', '火'].map((char, index) => (
              <span 
                key={char}
                className="text-xl font-bold"
                style={{
                  color: index === 3 ? '#ff4400' : '#ff8844',
                  textShadow: `
                    0 0 5px ${index === 3 ? '#ff4400' : '#ff6600'},
                    0 0 15px ${index === 3 ? '#ff2200' : '#ff4400'},
                    0 0 30px ${index === 3 ? '#ff0000' : '#ff2200'},
                    0 0 50px ${index === 3 ? '#cc0000' : '#cc2200'}
                  `,
                  animationDelay: `${index * 0.1}s`,
                }}
              >
                {char}
              </span>
            ))}
          </div>

          {/* 부제 */}
          <span 
            className="text-[10px] tracking-widest font-mono"
            style={{
              color: '#ffaa44',
              textShadow: '0 0 5px #ff6600, 0 0 10px #ff4400',
            }}
          >
            INTO THE FLAME
          </span>
        </div>
      )}

      {/* 기존 우측 아이콘들 - 위치 조정 */}
      <div className="absolute right-4 bottom-8 flex gap-4">
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
