import { useState, useEffect, useRef, useCallback } from 'react';

interface OrderBookLevel {
  price: number;
  quantity: number;
}

interface WallInfo {
  price: number;
  quantity: number;
  percentFromCurrent: number;
  strength: 'weak' | 'medium' | 'strong';
}

interface OrderBookAnalysis {
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadPercent: number;
  bidWalls: WallInfo[];
  askWalls: WallInfo[];
  bidDepth: number;
  askDepth: number;
  imbalance: number; // positive = more bids, negative = more asks
  hasSellWall: boolean;
  hasBuyWall: boolean;
  nearestSellWall: WallInfo | null;
  nearestBuyWall: WallInfo | null;
}

const CONFIG = {
  // 벽 감지 임계값 (평균 대비 배수)
  WALL_THRESHOLD_MULTIPLIER: 3,
  // 강한 벽 임계값
  STRONG_WALL_MULTIPLIER: 5,
  // 분석할 오더북 깊이 (레벨 수)
  DEPTH_LEVELS: 20,
  // 현재가 대비 벽 감지 범위 (%)
  WALL_DETECTION_RANGE_PERCENT: 2,
};

export const useOrderBookWall = (symbol: string | null, enabled: boolean = true) => {
  const [analysis, setAnalysis] = useState<OrderBookAnalysis | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const analyzeOrderBook = useCallback((
    bids: [string, string][],
    asks: [string, string][]
  ): OrderBookAnalysis | null => {
    if (!bids.length || !asks.length) return null;

    const bidLevels: OrderBookLevel[] = bids.slice(0, CONFIG.DEPTH_LEVELS).map(([p, q]) => ({
      price: parseFloat(p),
      quantity: parseFloat(q)
    }));

    const askLevels: OrderBookLevel[] = asks.slice(0, CONFIG.DEPTH_LEVELS).map(([p, q]) => ({
      price: parseFloat(p),
      quantity: parseFloat(q)
    }));

    const bestBid = bidLevels[0]?.price || 0;
    const bestAsk = askLevels[0]?.price || 0;
    const midPrice = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;
    const spreadPercent = (spread / midPrice) * 100;

    // 평균 수량 계산
    const avgBidQty = bidLevels.reduce((sum, l) => sum + l.quantity, 0) / bidLevels.length;
    const avgAskQty = askLevels.reduce((sum, l) => sum + l.quantity, 0) / askLevels.length;

    // 벽 감지 범위 계산
    const maxPriceRange = midPrice * (CONFIG.WALL_DETECTION_RANGE_PERCENT / 100);

    // 벽 강도 결정 함수
    const getWallStrength = (quantity: number, avgQty: number): 'weak' | 'medium' | 'strong' => {
      if (quantity >= avgQty * CONFIG.STRONG_WALL_MULTIPLIER) return 'strong';
      if (quantity >= avgQty * (CONFIG.WALL_THRESHOLD_MULTIPLIER + 1)) return 'medium';
      return 'weak';
    };

    // 매수벽 감지
    const bidWalls: WallInfo[] = bidLevels
      .filter(level => {
        const percentFromCurrent = ((midPrice - level.price) / midPrice) * 100;
        return percentFromCurrent <= CONFIG.WALL_DETECTION_RANGE_PERCENT &&
               level.quantity >= avgBidQty * CONFIG.WALL_THRESHOLD_MULTIPLIER;
      })
      .map(level => ({
        price: level.price,
        quantity: level.quantity,
        percentFromCurrent: ((midPrice - level.price) / midPrice) * 100,
        strength: getWallStrength(level.quantity, avgBidQty)
      }))
      .sort((a, b) => a.percentFromCurrent - b.percentFromCurrent);

    // 매도벽 감지
    const askWalls: WallInfo[] = askLevels
      .filter(level => {
        const percentFromCurrent = ((level.price - midPrice) / midPrice) * 100;
        return percentFromCurrent <= CONFIG.WALL_DETECTION_RANGE_PERCENT &&
               level.quantity >= avgAskQty * CONFIG.WALL_THRESHOLD_MULTIPLIER;
      })
      .map(level => ({
        price: level.price,
        quantity: level.quantity,
        percentFromCurrent: ((level.price - midPrice) / midPrice) * 100,
        strength: getWallStrength(level.quantity, avgAskQty)
      }))
      .sort((a, b) => a.percentFromCurrent - b.percentFromCurrent);

    // 총 깊이 계산
    const bidDepth = bidLevels.reduce((sum, l) => sum + l.quantity * l.price, 0);
    const askDepth = askLevels.reduce((sum, l) => sum + l.quantity * l.price, 0);
    const totalDepth = bidDepth + askDepth;
    const imbalance = totalDepth > 0 ? ((bidDepth - askDepth) / totalDepth) * 100 : 0;

    return {
      bestBid,
      bestAsk,
      spread,
      spreadPercent,
      bidWalls,
      askWalls,
      bidDepth,
      askDepth,
      imbalance,
      hasSellWall: askWalls.length > 0,
      hasBuyWall: bidWalls.length > 0,
      nearestSellWall: askWalls[0] || null,
      nearestBuyWall: bidWalls[0] || null,
    };
  }, []);

  const connect = useCallback(() => {
    if (!symbol || !enabled) return;

    const formattedSymbol = symbol.toLowerCase().replace('usdt', '') + 'usdt';
    const wsUrl = `wss://fstream.binance.com/ws/${formattedSymbol}@depth20@100ms`;

    console.log(`[OrderBook] Connecting to ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`[OrderBook] Connected for ${symbol}`);
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const result = analyzeOrderBook(data.b || data.bids, data.a || data.asks);
        if (result) {
          setAnalysis(result);
          setLastUpdate(Date.now());
        }
      } catch (error) {
        console.error('[OrderBook] Parse error:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[OrderBook] WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('[OrderBook] WebSocket closed');
      setIsConnected(false);
      
      // 재연결 시도
      if (enabled && symbol) {
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[OrderBook] Attempting reconnect...');
          connect();
        }, 3000);
      }
    };
  }, [symbol, enabled, analyzeOrderBook]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setIsConnected(false);
    setAnalysis(null);
  }, []);

  useEffect(() => {
    if (symbol && enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [symbol, enabled, connect, disconnect]);

  // 신호 필터링을 위한 헬퍼 함수
  const shouldBlockLongEntry = useCallback((): { blocked: boolean; reason: string } => {
    if (!analysis) return { blocked: false, reason: '' };

    // 강한 매도벽이 가까이 있으면 롱 진입 차단
    if (analysis.nearestSellWall && 
        analysis.nearestSellWall.strength !== 'weak' &&
        analysis.nearestSellWall.percentFromCurrent < 0.5) {
      return { 
        blocked: true, 
        reason: `Strong sell wall at ${analysis.nearestSellWall.price.toFixed(2)} (${analysis.nearestSellWall.percentFromCurrent.toFixed(2)}% away)` 
      };
    }

    // 매도 깊이가 매수 깊이보다 현저히 크면 롱 진입 주의
    if (analysis.imbalance < -30) {
      return { 
        blocked: true, 
        reason: `High sell pressure (imbalance: ${analysis.imbalance.toFixed(1)}%)` 
      };
    }

    return { blocked: false, reason: '' };
  }, [analysis]);

  const shouldBlockShortEntry = useCallback((): { blocked: boolean; reason: string } => {
    if (!analysis) return { blocked: false, reason: '' };

    // 강한 매수벽이 가까이 있으면 숏 진입 차단
    if (analysis.nearestBuyWall && 
        analysis.nearestBuyWall.strength !== 'weak' &&
        analysis.nearestBuyWall.percentFromCurrent < 0.5) {
      return { 
        blocked: true, 
        reason: `Strong buy wall at ${analysis.nearestBuyWall.price.toFixed(2)} (${analysis.nearestBuyWall.percentFromCurrent.toFixed(2)}% away)` 
      };
    }

    // 매수 깊이가 매도 깊이보다 현저히 크면 숏 진입 주의
    if (analysis.imbalance > 30) {
      return { 
        blocked: true, 
        reason: `High buy pressure (imbalance: ${analysis.imbalance.toFixed(1)}%)` 
      };
    }

    return { blocked: false, reason: '' };
  }, [analysis]);

  return {
    analysis,
    isConnected,
    lastUpdate,
    shouldBlockLongEntry,
    shouldBlockShortEntry,
  };
};
