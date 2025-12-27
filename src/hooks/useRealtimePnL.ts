/**
 * 🚀 실시간 PnL 훅 - 바이낸스 markPrice WebSocket 기반
 * 
 * REST API 폴링 대신 WebSocket으로 markPrice를 실시간 수신하여
 * 로컬에서 즉시 PnL 계산 → 바이낸스 앱 수준의 반응 속도
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

export const useRealtimePnL = (position: PositionData | null) => {
  const [result, setResult] = useState<RealtimePnLResult | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSymbolRef = useRef<string | null>(null);
  
  // 🔧 최신 position을 참조하기 위한 ref (클로저 문제 해결)
  const positionRef = useRef<PositionData | null>(position);
  
  // position 변경 시 ref 업데이트
  useEffect(() => {
    positionRef.current = position;
    console.log(`[실시간PnL] position 업데이트: ${position?.side} ${position?.symbol}`);
  }, [position]);

  // PnL 계산 (수수료 포함)
  const calculatePnL = useCallback((markPrice: number, pos: PositionData) => {
    // 🔧 숏 포지션: 가격 하락 시 수익, 롱 포지션: 가격 상승 시 수익
    const direction = pos.side === 'long' ? 1 : -1;
    const priceDiff = (markPrice - pos.avgPrice) * direction;
    const grossPnl = priceDiff * pos.quantity;
    
    // 수수료 차감 (진입 0.02% maker + 청산 0.05% taker)
    const entryNotional = pos.avgPrice * pos.quantity;
    const exitNotional = markPrice * pos.quantity;
    const totalFee = (entryNotional * 0.0002) + (exitNotional * 0.0005);
    
    const netPnl = grossPnl - totalFee;
    const pnlPercent = (netPnl / entryNotional) * 100;
    
    console.log(`[PnL계산] side=${pos.side}, entry=${pos.avgPrice}, mark=${markPrice}, diff=${priceDiff.toFixed(4)}, gross=${grossPnl.toFixed(4)}, net=${netPnl.toFixed(4)}`);
    
    return { unrealizedPnl: netPnl, pnlPercent };
  }, []);

  // WebSocket 연결
  const connectWebSocket = useCallback((symbol: string) => {
    // 기존 연결 정리
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const streamSymbol = symbol.toLowerCase();
    const wsUrl = `wss://fstream.binance.com/ws/${streamSymbol}@markPrice@1s`;
    
    console.log(`📡 [실시간PnL] WebSocket 연결: ${symbol}`);
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`✅ [실시간PnL] WebSocket 연결됨: ${symbol}`);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const markPrice = parseFloat(data.p); // markPrice
        
        // 🔧 ref로 최신 position 참조 (클로저 문제 해결)
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
        console.warn('[실시간PnL] 메시지 파싱 오류:', err);
      }
    };

    ws.onerror = (err) => {
      console.warn('[실시간PnL] WebSocket 오류:', err);
    };

    ws.onclose = () => {
      console.log(`🔌 [실시간PnL] WebSocket 닫힘: ${symbol}`);
      wsRef.current = null;
      
      // 재연결 (포지션이 여전히 있으면)
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
      // 포지션 없음 → 연결 해제
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

    // 심볼 변경 시에만 재연결
    if (lastSymbolRef.current !== position.symbol) {
      lastSymbolRef.current = position.symbol;
      connectWebSocket(position.symbol);
    }

    return () => {
      // cleanup은 symbol 변경 시에만 수행
    };
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

  // 포지션 정보 변경 시 즉시 재계산 (avgPrice, quantity 변경)
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
  }, [position?.avgPrice, position?.quantity, position?.side]);

  return result;
};
