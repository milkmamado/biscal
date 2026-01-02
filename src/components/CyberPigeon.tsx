import { useEffect, useState } from 'react';

const CyberPigeon = () => {
  const [glitchFrame, setGlitchFrame] = useState(0);
  const [flicker, setFlicker] = useState(false);

  useEffect(() => {
    const glitchInterval = setInterval(() => {
      setGlitchFrame(prev => (prev + 1) % 10);
    }, 150);
    return () => clearInterval(glitchInterval);
  }, []);

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
      <div 
        className="relative px-6 py-3"
        style={{
          transform: `translateX(${glitchOffset}px)`,
          opacity: flicker ? 0.4 : 1,
          background: 'linear-gradient(135deg, rgba(10, 10, 20, 0.95) 0%, rgba(20, 20, 40, 0.95) 100%)',
          border: '1px solid rgba(255, 0, 136, 0.5)',
          boxShadow: `0 0 20px rgba(255, 0, 136, 0.3), inset 0 0 10px rgba(0, 0, 0, 0.5), ${glitchFrame % 3 === 0 ? '0 0 30px rgba(0, 255, 255, 0.2)' : ''}`,
        }}
      >
        <span 
          style={{
            color: '#ff0088',
            fontFamily: 'monospace',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontSize: '14px',
            fontWeight: 500,
          }}
        >
          ◆ BISCAL_SYSTEM :: PRECISION_SCALPING_PROTOCOL_ACTIVE :: EXECUTE_WITH_DISCIPLINE_OR_GET_LIQUIDATED ◆
        </span>
      </div>

      {/* 글리치 라인들 */}
      {glitchFrame % 5 === 0 && (
        <div 
          className="absolute h-[1px]"
          style={{
            top: `${30 + Math.random() * 40}%`,
            left: 0,
            right: 0,
            background: 'linear-gradient(90deg, transparent, #ff0088, transparent)',
          }}
        />
      )}

      {/* 스캔라인 오버레이 */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,0,136,0.1) 2px, rgba(255,0,136,0.1) 4px)',
        }}
      />
    </div>
  );
};

export default CyberPigeon;
