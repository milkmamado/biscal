import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { HelpCircle, TrendingUp, TrendingDown, Target, AlertTriangle, CheckCircle } from 'lucide-react';

export const DTFXGuideModal = () => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="w-4 h-4 rounded-full bg-purple-500/20 hover:bg-purple-500/40 flex items-center justify-center transition-colors">
          <HelpCircle className="w-3 h-3 text-purple-400" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto bg-background/95 backdrop-blur-sm border-purple-500/30">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-purple-400">
            <Target className="w-5 h-5" />
            DTFX 피보나치 진입 가이드
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 text-sm">
          {/* 롱 포지션 가이드 */}
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-green-400" />
              <span className="font-bold text-green-400">롱 (Long) 포지션</span>
            </div>
            
            <div className="space-y-2 text-muted-foreground">
              <div>
                <span className="text-green-400 font-semibold">최적 진입 구간 (OTE Zone)</span>
                <ul className="mt-1 ml-4 space-y-0.5 list-disc">
                  <li><span className="text-green-300">61.8% ~ 70.5%</span>: 가장 추천하는 구간</li>
                  <li><span className="text-green-300 font-bold">70.5%</span>: "Sweet Spot" - 최적 진입점</li>
                  <li><span className="text-yellow-400">78.6%</span>: 공격적 진입 (리스크 높음)</li>
                </ul>
              </div>
              
              <div>
                <span className="text-green-400 font-semibold">진입 조건</span>
                <ul className="mt-1 ml-4 space-y-0.5 list-disc">
                  <li>CHoCH/BOS로 <span className="text-green-300">상승 구조 전환</span> 확인</li>
                  <li>가격이 <span className="text-green-300">Demand Zone</span>으로 되돌림</li>
                  <li><span className="text-green-300">61.8%~70.5%</span> 구간에서 지지 확인 후 진입</li>
                </ul>
              </div>
              
              <div className="pt-1 border-t border-green-500/20">
                <span className="text-green-400 font-semibold">손익 설정</span>
                <ul className="mt-1 ml-4 space-y-0.5 list-disc">
                  <li><span className="text-red-400">손절</span>: Zone 하단 약간 아래</li>
                  <li><span className="text-cyan-400">익절</span>: 이전 고점 또는 1:1.5 이상</li>
                </ul>
              </div>
            </div>
          </div>
          
          {/* 숏 포지션 가이드 */}
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="w-4 h-4 text-red-400" />
              <span className="font-bold text-red-400">숏 (Short) 포지션</span>
            </div>
            
            <div className="space-y-2 text-muted-foreground">
              <div>
                <span className="text-red-400 font-semibold">최적 진입 구간 (OTE Zone)</span>
                <ul className="mt-1 ml-4 space-y-0.5 list-disc">
                  <li><span className="text-red-300">61.8% ~ 70.5%</span>: 가장 추천하는 구간</li>
                  <li><span className="text-red-300 font-bold">70.5%</span>: "Sweet Spot" - 최적 진입점</li>
                  <li><span className="text-yellow-400">78.6%</span>: 공격적 진입 (리스크 높음)</li>
                </ul>
              </div>
              
              <div>
                <span className="text-red-400 font-semibold">진입 조건</span>
                <ul className="mt-1 ml-4 space-y-0.5 list-disc">
                  <li>CHoCH/BOS로 <span className="text-red-300">하락 구조 전환</span> 확인</li>
                  <li>가격이 <span className="text-red-300">Supply Zone</span>으로 되돌림</li>
                  <li><span className="text-red-300">61.8%~70.5%</span> 구간에서 저항 확인 후 진입</li>
                </ul>
              </div>
              
              <div className="pt-1 border-t border-red-500/20">
                <span className="text-red-400 font-semibold">손익 설정</span>
                <ul className="mt-1 ml-4 space-y-0.5 list-disc">
                  <li><span className="text-red-400">손절</span>: Zone 상단 약간 위</li>
                  <li><span className="text-cyan-400">익절</span>: 이전 저점 또는 1:1.5 이상</li>
                </ul>
              </div>
            </div>
          </div>
          
          {/* 타임프레임 가이드 */}
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-blue-400" />
              <span className="font-bold text-blue-400">타임프레임별 특성</span>
            </div>
            
            <div className="space-y-1 text-muted-foreground text-xs">
              <div className="flex justify-between">
                <span>1분봉</span>
                <span className="text-yellow-400">신호 많음, 노이즈 많음 (스캘핑)</span>
              </div>
              <div className="flex justify-between">
                <span>3분봉</span>
                <span className="text-blue-300">1분보다 안정적, 빠른 매매</span>
              </div>
              <div className="flex justify-between">
                <span>5분봉</span>
                <span className="text-green-300">균형 잡힌 선택</span>
              </div>
              <div className="flex justify-between">
                <span>15분봉</span>
                <span className="text-purple-300">신뢰도 높음, 스윙 트레이딩</span>
              </div>
            </div>
          </div>
          
          {/* 핵심 요약 */}
          <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-cyan-400" />
              <span className="font-bold text-cyan-400">핵심 요약</span>
            </div>
            
            <ul className="space-y-1 text-xs text-muted-foreground list-disc ml-4">
              <li><span className="text-cyan-300 font-bold">70.5%</span> 레벨이 최적의 진입점</li>
              <li>구조 전환(CHoCH/BOS) <span className="text-cyan-300">확인 필수</span></li>
              <li>익손비 <span className="text-cyan-300">최소 1.5:1</span> 유지</li>
              <li>소액 예수금은 <span className="text-cyan-300">15분봉</span> 권장</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
