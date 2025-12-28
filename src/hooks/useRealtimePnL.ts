/**
 * 🚀 실시간 PnL 훅 - 바이낸스 markPrice WebSocket + User Data Stream 조합
 * 
 * User Data Stream에서 포지션 PnL을 직접 받으면 그것을 우선 사용하고,
 * 없거나 오래된 경우 markPrice WebSocket으로 로컬 계산합니다.
 * → 바이낸스 앱 수준의 ~100ms 반응 속도!
 */

import { useState, useEffect, useCallback, useRef } from 'react';

interface PositionData {
  symbol: string;
  side: 'long' | 'short';
  avgPrice: number;
  quantity: number;
}

interface RealtimePnLResult {
  markPrice: number;
  unrealizedPnl: number;
  pnlPercent: number;
  lastUpdate: number;
  source: 'userDataStream' | 'markPriceWs' | 'calculated'; // 데이터 출처
}

// User Data Stream에서 받은 포지션 데이터 (외부에서 주입)
interface UserDataPosition {
  unrealizedPnl: number;
  lastUpdate: number;
}

export const useRealtimePnL = (
  position: PositionData | null,
  userDataPosition?: UserDataPosition | null // User Data Stream에서 받은 데이터
) => {
  const [result, setResult] = useState<RealtimePnLResult | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSymbolRef = useRef<string | null>(null);
  
  // 최신 position을 참조하기 위한 ref
  const positionRef = useRef<PositionData | null>(position);
  
  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  // PnL 계산 (수수료 포함)
  const calculatePnL = useCallback((markPrice: number, pos: PositionData) => {
    const direction = pos.side === 'long' ? 1 : -1;
    const priceDiff = (markPrice - pos.avgPrice) * direction;
    const grossPnl = priceDiff * pos.quantity;
    
    // 수수료 차감 (진입 0.02% maker + 청산 0.05% taker)
    const entryNotional = pos.avgPrice * pos.quantity;
    const exitNotional = markPrice * pos.quantity;
    const totalFee = (entryNotional * 0.0002) + (exitNotional * 0.0005);
    
    const netPnl = grossPnl - totalFee;
    const pnlPercent = entryNotional > 0 ? (netPnl / entryNotional) * 100 : 0;
    
    return { unrealizedPnl: netPnl, pnlPercent };
  }, []);

  // User Data Stream 데이터가 있으면 즉시 반영
  useEffect(() => {
    if (userDataPosition && position) {
      const entryNotional = position.avgPrice * position.quantity;
      const pnlPercent = entryNotional > 0 
        ? (userDataPosition.unrealizedPnl / entryNotional) * 100 
        : 0;
      
      setResult(prev => ({
        markPrice: prev?.markPrice || 0,
        unrealizedPnl: userDataPosition.unrealizedPnl,
        pnlPercent,
        lastUpdate: userDataPosition.lastUpdate,
        source: 'userDataStream',
      }));
      
      console.log(`⚡ [실시간PnL] User Data Stream: PnL=${userDataPosition.unrealizedPnl.toFixed(4)}`);
    }
  }, [userDataPosition?.unrealizedPnl, userDataPosition?.lastUpdate, position]);

  // WebSocket 연결 (markPrice 스트림)
  const connectWebSocket = useCallback((symbol: string) => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const streamSymbol = symbol.toLowerCase();
    // 100ms 간격으로 받기 (더 빠른 업데이트)
    const wsUrl = `wss://fstream.binance.com/ws/${streamSymbol}@markPrice@100ms`;
    
    console.log(`📡 [실시간PnL] markPrice WebSocket 연결: ${symbol} (@100ms)`);
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`✅ [실시간PnL] markPrice WebSocket 연결됨: ${symbol}`);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const markPrice = parseFloat(data.p);
        
        const currentPos = positionRef.current;
        
        if (currentPos && currentPos.symbol === symbol && !isNaN(markPrice)) {
          setResult(prev => {
            // User Data Stream 데이터가 최근 2초 이내면 그것을 유지
            if (prev?.source === 'userDataStream' && Date.now() - prev.lastUpdate < 2000) {
              // markPrice만 업데이트
              return {
                ...prev,
                markPrice,
              };
            }
            
            // 그 외에는 로컬에서 계산
            const { unrealizedPnl, pnlPercent } = calculatePnL(markPrice, currentPos);
            
            return {
              markPrice,
              unrealizedPnl,
              pnlPercent,
              lastUpdate: Date.now(),
              source: 'markPriceWs' as const,
            };
          });
        }
      } catch (err) {
        console.warn('[실시간PnL] 메시지 파싱 오류:', err);
      }
    };

    ws.onerror = (err) => {
      console.warn('[실시간PnL] WebSocket 오류:', err);
    };

    ws.onclose = () => {
      console.log(`🔌 [실시간PnL] WebSocket 닫힘: ${symbol}`);
      wsRef.current = null;
      
      const currentPos = positionRef.current;
      if (currentPos && currentPos.symbol === symbol) {
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[실시간PnL] 재연결 시도...');
          connectWebSocket(symbol);
        }, 3000);
      }
    };
  }, [calculatePnL]);

  // 포지션 변경 시 WebSocket 관리
  useEffect(() => {
    if (!position || !position.symbol || position.quantity <= 0) {
      if (wsRef.current) {
        console.log('[실시간PnL] 포지션 없음 → 연결 해제');
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      lastSymbolRef.current = null;
      setResult(null);
      return;
    }

    // 포지션이 생겼을 때: WebSocket이 없거나 심볼이 바뀌었으면 연결
    const needsConnection = !wsRef.current || lastSymbolRef.current !== position.symbol;
    
    if (needsConnection) {
      console.log(`[실시간PnL] 포지션 감지 → WebSocket 연결 시작: ${position.symbol}`);
      lastSymbolRef.current = position.symbol;
      connectWebSocket(position.symbol);
    }
  }, [position?.symbol, position?.quantity, connectWebSocket]);

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, []);

  // 포지션 정보 변경 시 즉시 재계산
  useEffect(() => {
    if (result && position && result.markPrice > 0 && result.source !== 'userDataStream') {
      const { unrealizedPnl, pnlPercent } = calculatePnL(result.markPrice, position);
      setResult(prev => prev ? {
        ...prev,
        unrealizedPnl,
        pnlPercent,
        lastUpdate: Date.now(),
        source: 'calculated' as const,
      } : null);
    }
  }, [position?.avgPrice, position?.quantity, position?.side, calculatePnL]);

  return result;
};
