import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Terminal, Loader2, Check, X, Search, Zap } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface ScreeningLog {
  id: string;
  timestamp: Date;
  type: 'start' | 'filter' | 'analyze' | 'reject' | 'signal' | 'approve' | 'complete';
  message: string;
  symbol?: string;
}

interface ScreeningLogPanelProps {
  isScanning: boolean;
  signalsCount: number;
}

// 전역 로그 저장소 (hook 외부에서 접근 가능)
let globalLogs: ScreeningLog[] = [];
let globalSetLogs: ((logs: ScreeningLog[]) => void) | null = null;

// 외부에서 로그 추가하는 함수
export const addScreeningLog = (type: ScreeningLog['type'], message: string, symbol?: string) => {
  const log: ScreeningLog = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date(),
    type,
    message,
    symbol,
  };
  
  globalLogs = [...globalLogs.slice(-49), log]; // 최근 50개만 유지
  globalSetLogs?.(globalLogs);
};

// 로그 초기화
export const clearScreeningLogs = () => {
  globalLogs = [];
  globalSetLogs?.([]);
};

const ScreeningLogPanel = ({ isScanning, signalsCount }: ScreeningLogPanelProps) => {
  const [logs, setLogs] = useState<ScreeningLog[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // 전역 setter 등록
  useEffect(() => {
    globalSetLogs = setLogs;
    setLogs(globalLogs);
    return () => {
      globalSetLogs = null;
    };
  }, []);
  
  // 자동 스크롤
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);
  
  const getLogIcon = (type: ScreeningLog['type']) => {
    switch (type) {
      case 'start':
        return <Search className="w-3 h-3 text-cyan-400" />;
      case 'filter':
        return <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />;
      case 'analyze':
        return <Search className="w-3 h-3 text-yellow-400" />;
      case 'reject':
        return <X className="w-3 h-3 text-red-400" />;
      case 'signal':
        return <Zap className="w-3 h-3 text-yellow-400" />;
      case 'approve':
        return <Check className="w-3 h-3 text-green-400" />;
      case 'complete':
        return <Terminal className="w-3 h-3 text-purple-400" />;
      default:
        return <Terminal className="w-3 h-3 text-muted-foreground" />;
    }
  };
  
  const getLogColor = (type: ScreeningLog['type']) => {
    switch (type) {
      case 'start':
        return 'text-cyan-400';
      case 'filter':
        return 'text-blue-400';
      case 'analyze':
        return 'text-yellow-400';
      case 'reject':
        return 'text-red-400/80';
      case 'signal':
        return 'text-yellow-400';
      case 'approve':
        return 'text-green-400 font-semibold';
      case 'complete':
        return 'text-purple-400';
      default:
        return 'text-muted-foreground';
    }
  };
  
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="bg-background/80 backdrop-blur border border-cyan-500/30 rounded-lg overflow-hidden">
      {/* 헤더 */}
      <div className="px-3 py-2 border-b border-cyan-500/30 bg-gradient-to-r from-cyan-950/50 to-transparent flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-mono text-cyan-400 tracking-wider">SCREENING LOG</span>
        </div>
        <div className="flex items-center gap-2">
          {isScanning && (
            <div className="flex items-center gap-1">
              <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />
              <span className="text-[10px] text-cyan-400 font-mono">SCANNING</span>
            </div>
          )}
          {signalsCount > 0 && (
            <div className="px-2 py-0.5 bg-green-500/20 border border-green-500/50 rounded text-[10px] text-green-400 font-mono">
              {signalsCount} SIGNAL
            </div>
          )}
        </div>
      </div>
      
      {/* 로그 영역 */}
      <div 
        ref={scrollRef}
        className="h-32 overflow-y-auto p-2 font-mono text-[10px] space-y-0.5 scrollbar-thin scrollbar-thumb-cyan-500/30 scrollbar-track-transparent"
      >
        {logs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground/50">
            <span>대기 중...</span>
          </div>
        ) : (
          logs.map((log) => (
            <div 
              key={log.id}
              className={cn(
                "flex items-start gap-1.5 py-0.5 leading-tight",
                log.type === 'approve' && "bg-green-500/10 -mx-2 px-2 rounded"
              )}
            >
              {getLogIcon(log.type)}
              <span className="text-muted-foreground/60">[{formatTime(log.timestamp)}]</span>
              {log.symbol && (
                <span className="text-cyan-400 font-semibold">{log.symbol.replace('USDT', '')}</span>
              )}
              <span className={getLogColor(log.type)}>{log.message}</span>
            </div>
          ))
        )}
        
        {/* 스캔 중 인디케이터 */}
        {isScanning && logs.length > 0 && (
          <div className="flex items-center gap-1.5 py-0.5 text-cyan-400/60">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>분석 진행중...</span>
          </div>
        )}
      </div>
      
      {/* 스캔라인 효과 */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-500/5 to-transparent animate-pulse" />
      </div>
    </div>
  );
};

export default ScreeningLogPanel;
