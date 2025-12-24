import { Zap } from 'lucide-react';

export function BiscalLogo() {
  return (
    <div
      className="rounded-lg border overflow-hidden relative"
      style={{
        background: 'linear-gradient(135deg, rgba(10, 10, 20, 0.95) 0%, rgba(20, 10, 30, 0.95) 50%, rgba(10, 15, 25, 0.95) 100%)',
        borderColor: 'rgba(0, 255, 255, 0.3)',
        boxShadow: '0 0 20px rgba(0, 255, 255, 0.15), inset 0 0 30px rgba(0, 0, 0, 0.5)',
      }}
    >
      {/* 배경 그리드 효과 */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0, 255, 255, 0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0, 255, 255, 0.5) 1px, transparent 1px)
          `,
          backgroundSize: '15px 15px',
        }}
      />
      
      {/* 글로우 효과 */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(0, 255, 255, 0.1) 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10 px-4 py-3 flex items-center justify-center gap-2">
        {/* 로고 아이콘 */}
        <div
          className="relative"
          style={{
            filter: 'drop-shadow(0 0 10px rgba(0, 255, 255, 0.8))',
          }}
        >
          <Zap
            className="w-5 h-5"
            style={{
              color: '#00ffff',
              fill: 'rgba(0, 255, 255, 0.3)',
            }}
          />
        </div>

        {/* BISCAL 텍스트 */}
        <div className="flex items-baseline gap-1">
          <span
            className="text-lg font-black tracking-[0.2em] uppercase"
            style={{
              color: '#00ffff',
              textShadow: `
                0 0 10px rgba(0, 255, 255, 0.8),
                0 0 20px rgba(0, 255, 255, 0.6),
                0 0 30px rgba(0, 255, 255, 0.4),
                0 0 40px rgba(0, 255, 255, 0.2)
              `,
              fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
              letterSpacing: '0.25em',
            }}
          >
            BISCAL
          </span>
          <span
            className="text-[8px] font-bold tracking-widest uppercase"
            style={{
              color: 'rgba(255, 0, 136, 0.9)',
              textShadow: '0 0 8px rgba(255, 0, 136, 0.6)',
            }}
          >
            v2
          </span>
        </div>

        {/* 우측 장식 */}
        <div
          className="relative"
          style={{
            filter: 'drop-shadow(0 0 10px rgba(255, 0, 136, 0.8))',
          }}
        >
          <Zap
            className="w-5 h-5"
            style={{
              color: '#ff0088',
              fill: 'rgba(255, 0, 136, 0.3)',
              transform: 'scaleX(-1)',
            }}
          />
        </div>
      </div>

      {/* 하단 태그라인 */}
      <div
        className="relative z-10 px-4 pb-2 flex justify-center"
      >
        <span
          className="text-[8px] tracking-[0.3em] uppercase"
          style={{
            color: 'rgba(150, 150, 180, 0.7)',
            letterSpacing: '0.35em',
          }}
        >
          Binary Signal Calculator
        </span>
      </div>

      {/* 하단 네온 라인 */}
      <div
        className="h-[2px] w-full"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, #00ffff 20%, #ff0088 80%, transparent 100%)',
          boxShadow: '0 0 10px rgba(0, 255, 255, 0.5)',
        }}
      />
    </div>
  );
}

export default BiscalLogo;
