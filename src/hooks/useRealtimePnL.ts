/**
 * 🚀 실시간 PnL 훅 - markPrice WebSocket 기반 자체 계산
 * 
 * 바이낸스 markPrice 스트림(100ms)으로 로컬에서 직접 계산
 * → 외부 API 의존 없이 즉시 반영!
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
}

export const useRealtimePnL = (
  position: PositionData | null,
  _userDataPosition?: any // 호환성 유지 (사용 안함)
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

  // PnL 자체 계산 (바이낸스 미실현 손익과 동일 - 수수료 미포함)
  const calculatePnL = useCallback((markPrice: number, pos: PositionData) => {
    const direction = pos.side === 'long' ? 1 : -1;
    const priceDiff = (markPrice - pos.avgPrice) * direction;
    const unrealizedPnl = priceDiff * pos.quantity;
    
    // 진입 명목가치 기준 수익률 (레버리지 미반영)
    const entryNotional = pos.avgPrice * pos.quantity;
    const pnlPercent = entryNotional > 0 ? (unrealizedPnl / entryNotional) * 100 : 0;
    
    return { unrealizedPnl, pnlPercent };
  }, []);

  // WebSocket 연결 (markPrice 스트림 - 100ms 간격)
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
    const wsUrl = `wss://fstream.binance.com/ws/${streamSymbol}@markPrice@100ms`;
    
    console.log(`📡 [실시간PnL] markPrice WebSocket 연결: ${symbol}`);
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`✅ [실시간PnL] 연결됨: ${symbol}`);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const markPrice = parseFloat(data.p);
        
        const currentPos = positionRef.current;
        
        if (currentPos && currentPos.symbol === symbol && !isNaN(markPrice)) {
          const { unrealizedPnl, pnlPercent } = calculatePnL(markPrice, currentPos);
          
          setResult({
            markPrice,
            unrealizedPnl,
            pnlPercent,
            lastUpdate: Date.now(),
          });
        }
      } catch (err) {
        console.warn('[실시간PnL] 파싱 오류:', err);
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

    // WebSocket 상태 확인: 없거나, 닫혔거나, 심볼이 다르면 새로 연결
    const wsExists = wsRef.current !== null;
    const wsIsOpen = wsRef.current?.readyState === WebSocket.OPEN;
    const wsIsConnecting = wsRef.current?.readyState === WebSocket.CONNECTING;
    const symbolChanged = lastSymbolRef.current !== position.symbol;
    
    const needsConnection = !wsExists || (!wsIsOpen && !wsIsConnecting) || symbolChanged;
    
    if (needsConnection) {
      console.log(`[실시간PnL] 포지션 감지 → WebSocket 연결 시작: ${position.symbol} (wsExists=${wsExists}, wsIsOpen=${wsIsOpen}, symbolChanged=${symbolChanged})`);
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

  // 주기적 연결 상태 체크 (5초마다) - 연결이 끊겼으면 재연결
  useEffect(() => {
    if (!position || !position.symbol || position.quantity <= 0) return;
    
    const checkInterval = setInterval(() => {
      const ws = wsRef.current;
      const isConnected = ws && ws.readyState === WebSocket.OPEN;
      
      if (!isConnected && position.symbol) {
        console.log(`[실시간PnL] 연결 상태 체크: 끊김 감지 → 재연결 시도 (${position.symbol})`);
        connectWebSocket(position.symbol);
      }
    }, 5000);
    
    return () => clearInterval(checkInterval);
  }, [position?.symbol, position?.quantity, connectWebSocket]);

  // 포지션 정보 변경 시 즉시 재계산
  useEffect(() => {
    if (result && position && result.markPrice > 0) {
      const { unrealizedPnl, pnlPercent } = calculatePnL(result.markPrice, position);
      setResult(prev => prev ? {
        ...prev,
        unrealizedPnl,
        pnlPercent,
        lastUpdate: Date.now(),
      } : null);
    }
  }, [position?.avgPrice, position?.quantity, position?.side, calculatePnL]);

  return result;
};
