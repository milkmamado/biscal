/**
 * 관심종목 패널
 * - 사용자가 돌려봤던 종목들 저장
 * - 클릭 시 해당 종목으로 이동
 * - 스크롤 가능 + 접기/펼치기
 */
import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronUp, X, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WatchlistItem {
  symbol: string;
  addedAt: number;
}

interface WatchlistPanelProps {
  currentSymbol: string;
  onSelectSymbol: (symbol: string) => void;
}

const STORAGE_KEY = 'biscal_watchlist';
const MAX_ITEMS = 20;

export default function WatchlistPanel({ currentSymbol, onSelectSymbol }: WatchlistPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);

  // 로컬스토리지에서 로드
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setWatchlist(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load watchlist:', e);
    }
  }, []);

  // 로컬스토리지에 저장
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlist));
    } catch (e) {
      console.error('Failed to save watchlist:', e);
    }
  }, [watchlist]);

  // 현재 심볼이 변경되면 관심종목에 추가
  useEffect(() => {
    if (!currentSymbol) return;
    
    setWatchlist(prev => {
      // 이미 있으면 시간만 업데이트
      const exists = prev.find(item => item.symbol === currentSymbol);
      if (exists) {
        return prev.map(item => 
          item.symbol === currentSymbol 
            ? { ...item, addedAt: Date.now() }
            : item
        );
      }
      
      // 새로 추가 (최대 개수 제한)
      const newList = [
        { symbol: currentSymbol, addedAt: Date.now() },
        ...prev.slice(0, MAX_ITEMS - 1)
      ];
      return newList;
    });
  }, [currentSymbol]);

  // 종목 삭제
  const removeItem = useCallback((symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setWatchlist(prev => prev.filter(item => item.symbol !== symbol));
  }, []);

  // 전체 삭제
  const clearAll = useCallback(() => {
    setWatchlist([]);
  }, []);

  return (
    <div className="bg-card/50 border border-border/30 rounded-lg overflow-hidden">
      {/* 헤더 - 클릭으로 접기/펼치기 */}
      <button
        onClick={() => setIsCollapsed(prev => !prev)}
        className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Star className="w-3 h-3 text-cyan-400" style={{ filter: 'drop-shadow(0 0 4px rgba(0, 255, 255, 0.5))' }} />
          <span className="text-xs font-medium text-foreground">관심종목</span>
          <span className="text-[10px] text-cyan-400/60">({watchlist.length})</span>
        </div>
        {isCollapsed ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </button>

      {/* 관심종목 리스트 */}
      {!isCollapsed && (
        <div className="border-t border-border/20">
          {watchlist.length === 0 ? (
            <div className="px-2 py-3 text-center text-[10px] text-muted-foreground">
              종목을 보면 자동으로 추가됩니다
            </div>
          ) : (
            <>
              <div className="p-1 space-y-0.5 max-h-32 overflow-y-auto">
                  {watchlist.map((item) => (
                    <div
                      key={item.symbol}
                      onClick={() => onSelectSymbol(item.symbol)}
                      className={`
                        flex items-center justify-between px-2 py-1 rounded cursor-pointer
                        transition-colors text-[11px]
                        ${item.symbol === currentSymbol 
                          ? 'bg-primary/20 text-primary' 
                          : 'hover:bg-muted/50 text-foreground'
                        }
                      `}
                    >
                      <span className="font-medium">
                        {item.symbol.replace('USDT', '')}
                      </span>
                      <button
                        onClick={(e) => removeItem(item.symbol, e)}
                        className="p-0.5 hover:bg-destructive/20 rounded transition-colors"
                      >
                        <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              
              {/* 전체 삭제 버튼 */}
              {watchlist.length > 3 && (
                <div className="border-t border-border/20 px-2 py-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAll}
                    className="w-full h-5 text-[10px] text-muted-foreground hover:text-destructive"
                  >
                    전체 삭제
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
