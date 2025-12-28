/**
 * 🚀 User Data Stream 훅 - 바이낸스 계정 WebSocket 기반
 * 
 * listenKey를 발급받아 User Data Stream에 연결하고,
 * ACCOUNT_UPDATE 이벤트로 포지션/잔고를 실시간으로 받습니다.
 * 바이낸스 앱과 동일한 ~100ms 수준의 반응 속도!
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';

const VPS_DIRECT_URL = 'https://api.biscal.me/api/direct';
const VPS_AUTH_TOKEN = 'biscal2024secure';

// Binance User Data Stream 이벤트 타입
interface AccountUpdateEvent {
  e: 'ACCOUNT_UPDATE';
  E: number; // Event time
  T: number; // Transaction time
  a: {
    m: string; // Event reason type
    B: Array<{
      a: string; // Asset
      wb: string; // Wallet balance
      cw: string; // Cross wallet balance
      bc: string; // Balance change
    }>;
    P: Array<{
      s: string; // Symbol
      pa: string; // Position amount
      ep: string; // Entry price
      bep: string; // Breakeven price
      cr: string; // Accumulated realized
      up: string; // Unrealized PnL
      mt: string; // Margin type
      iw: string; // Isolated wallet
      ps: string; // Position side
    }>;
  };
}

interface OrderTradeUpdateEvent {
  e: 'ORDER_TRADE_UPDATE';
  E: number;
  T: number;
  o: {
    s: string; // Symbol
    S: string; // Side
    o: string; // Order type
    q: string; // Original qty
    p: string; // Original price
    X: string; // Order status
    rp: string; // Realized profit
  };
}

export interface RealtimePosition {
  symbol: string;
  positionAmt: number;
  entryPrice: number;
  breakEvenPrice: number;
  unrealizedPnl: number;
  marginType: string;
  positionSide: string;
  lastUpdate: number;
}

export interface RealtimeBalance {
  asset: string;
  walletBalance: number;
  crossWalletBalance: number;
  balanceChange: number;
  lastUpdate: number;
}

interface UserDataStreamResult {
  positions: Map<string, RealtimePosition>;
  balances: Map<string, RealtimeBalance>;
  isConnected: boolean;
  lastEventTime: number;
}

export const useUserDataStream = () => {
  const { user } = useAuth();
  const [result, setResult] = useState<UserDataStreamResult>({
    positions: new Map(),
    balances: new Map(),
    isConnected: false,
    lastEventTime: 0,
  });
  
  const wsRef = useRef<WebSocket | null>(null);
  const listenKeyRef = useRef<string | null>(null);
  const keepaliveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectingRef = useRef(false);

  // VPS API 호출
  const callVps = useCallback(async (action: string, params: Record<string, any> = {}) => {
    const response = await fetch(VPS_DIRECT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VPS_AUTH_TOKEN}`,
      },
      body: JSON.stringify({ action, params }),
    });
    return response.json();
  }, []);

  // listenKey 발급
  const createListenKey = useCallback(async (): Promise<string | null> => {
    try {
      console.log('🔑 [UserDataStream] listenKey 발급 요청...');
      const data = await callVps('createListenKey');
      
      if (data.listenKey) {
        console.log('✅ [UserDataStream] listenKey 발급 성공:', data.listenKey.substring(0, 20) + '...');
        return data.listenKey;
      } else {
        console.error('❌ [UserDataStream] listenKey 발급 실패:', data);
        return null;
      }
    } catch (err) {
      console.error('❌ [UserDataStream] listenKey 발급 오류:', err);
      return null;
    }
  }, [callVps]);

  // listenKey 갱신 (30분마다 필요)
  const keepaliveListenKey = useCallback(async () => {
    if (!listenKeyRef.current) return;
    
    try {
      console.log('🔄 [UserDataStream] listenKey 갱신...');
      await callVps('keepaliveListenKey');
      console.log('✅ [UserDataStream] listenKey 갱신 완료');
    } catch (err) {
      console.warn('⚠️ [UserDataStream] listenKey 갱신 실패:', err);
    }
  }, [callVps]);

  // WebSocket 이벤트 핸들러
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(event.data);
      
      // ACCOUNT_UPDATE: 포지션/잔고 변경
      if (data.e === 'ACCOUNT_UPDATE') {
        const update = data as AccountUpdateEvent;
        console.log('📊 [UserDataStream] ACCOUNT_UPDATE 수신:', update.a.m);
        
        setResult(prev => {
          const newPositions = new Map(prev.positions);
          const newBalances = new Map(prev.balances);
          
          // 포지션 업데이트
          for (const pos of update.a.P) {
            const posAmt = parseFloat(pos.pa);
            
            if (posAmt !== 0) {
              newPositions.set(pos.s, {
                symbol: pos.s,
                positionAmt: posAmt,
                entryPrice: parseFloat(pos.ep),
                breakEvenPrice: parseFloat(pos.bep),
                unrealizedPnl: parseFloat(pos.up),
                marginType: pos.mt,
                positionSide: pos.ps,
                lastUpdate: update.E,
              });
              console.log(`📈 [UserDataStream] 포지션 업데이트: ${pos.s} amt=${posAmt} entry=${pos.ep} pnl=${pos.up}`);
            } else {
              // 포지션 청산됨
              newPositions.delete(pos.s);
              console.log(`📉 [UserDataStream] 포지션 청산: ${pos.s}`);
            }
          }
          
          // 잔고 업데이트
          for (const bal of update.a.B) {
            newBalances.set(bal.a, {
              asset: bal.a,
              walletBalance: parseFloat(bal.wb),
              crossWalletBalance: parseFloat(bal.cw),
              balanceChange: parseFloat(bal.bc),
              lastUpdate: update.E,
            });
          }
          
          return {
            ...prev,
            positions: newPositions,
            balances: newBalances,
            lastEventTime: update.E,
          };
        });
      }
      
      // ORDER_TRADE_UPDATE: 주문 체결
      else if (data.e === 'ORDER_TRADE_UPDATE') {
        const update = data as OrderTradeUpdateEvent;
        console.log(`📦 [UserDataStream] ORDER_TRADE_UPDATE: ${update.o.s} ${update.o.S} ${update.o.X}`);
      }
      
      // listenKey 만료 경고
      else if (data.e === 'listenKeyExpired') {
        console.warn('⚠️ [UserDataStream] listenKey 만료! 재연결 필요');
        reconnect();
      }
      
    } catch (err) {
      console.warn('[UserDataStream] 메시지 파싱 오류:', err);
    }
  }, []);

  // WebSocket 연결
  const connect = useCallback(async () => {
    if (isConnectingRef.current) {
      console.log('[UserDataStream] 이미 연결 중...');
      return;
    }
    
    isConnectingRef.current = true;
    
    try {
      // 기존 연결 정리
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      
      // listenKey 발급
      const listenKey = await createListenKey();
      if (!listenKey) {
        isConnectingRef.current = false;
        return;
      }
      
      listenKeyRef.current = listenKey;
      
      // WebSocket 연결
      const wsUrl = `wss://fstream.binance.com/ws/${listenKey}`;
      console.log('📡 [UserDataStream] WebSocket 연결 시도...');
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      
      ws.onopen = () => {
        console.log('✅ [UserDataStream] WebSocket 연결됨!');
        isConnectingRef.current = false;
        setResult(prev => ({ ...prev, isConnected: true }));
        
        // 25분마다 listenKey 갱신 (30분 전에 갱신)
        keepaliveIntervalRef.current = setInterval(() => {
          keepaliveListenKey();
        }, 25 * 60 * 1000);
      };
      
      ws.onmessage = handleMessage;
      
      ws.onerror = (err) => {
        console.error('❌ [UserDataStream] WebSocket 오류:', err);
        isConnectingRef.current = false;
      };
      
      ws.onclose = () => {
        console.log('🔌 [UserDataStream] WebSocket 닫힘');
        isConnectingRef.current = false;
        setResult(prev => ({ ...prev, isConnected: false }));
        
        // 5초 후 재연결
        reconnectTimeoutRef.current = setTimeout(() => {
          if (user) {
            console.log('[UserDataStream] 재연결 시도...');
            connect();
          }
        }, 5000);
      };
      
    } catch (err) {
      console.error('[UserDataStream] 연결 오류:', err);
      isConnectingRef.current = false;
    }
  }, [user, createListenKey, keepaliveListenKey, handleMessage]);

  // 재연결
  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    connect();
  }, [connect]);

  // 연결 해제
  const disconnect = useCallback(() => {
    console.log('[UserDataStream] 연결 해제');
    
    if (keepaliveIntervalRef.current) {
      clearInterval(keepaliveIntervalRef.current);
      keepaliveIntervalRef.current = null;
    }
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    listenKeyRef.current = null;
    isConnectingRef.current = false;
    
    setResult({
      positions: new Map(),
      balances: new Map(),
      isConnected: false,
      lastEventTime: 0,
    });
  }, []);

  // 로그인 시 자동 연결
  useEffect(() => {
    if (user) {
      connect();
    } else {
      disconnect();
    }
    
    return () => {
      disconnect();
    };
  }, [user]);

  // 특정 심볼의 포지션 조회
  const getPosition = useCallback((symbol: string): RealtimePosition | undefined => {
    return result.positions.get(symbol);
  }, [result.positions]);

  // USDT 잔고 조회
  const getUsdtBalance = useCallback((): RealtimeBalance | undefined => {
    return result.balances.get('USDT');
  }, [result.balances]);

  return {
    ...result,
    getPosition,
    getUsdtBalance,
    connect,
    disconnect,
    reconnect,
  };
};
