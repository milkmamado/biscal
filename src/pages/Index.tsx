import { useState } from 'react';
import HotCoinList from '@/components/HotCoinList';
import OrderPanel8282 from '@/components/OrderPanel8282';
import CoinHeader from '@/components/CoinHeader';
import { Activity } from 'lucide-react';

const Index = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');

  return (
    <div className="min-h-screen bg-background">
      {/* Top Bar */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1920px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
              <Activity className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <h1 className="text-lg font-bold">선물 트레이더</h1>
              <p className="text-xs text-muted-foreground">바이낸스 선물 HOT 코인</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-positive animate-pulse" />
            <span className="text-xs text-muted-foreground">실시간</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1920px] mx-auto p-4">
        <div className="grid grid-cols-12 gap-4">
          {/* Left - Hot Coin List */}
          <div className="col-span-12 lg:col-span-3 xl:col-span-2">
            <HotCoinList
              onSelectSymbol={setSelectedSymbol}
              selectedSymbol={selectedSymbol}
            />
          </div>

          {/* Center - Coin Info */}
          <div className="col-span-12 lg:col-span-5 xl:col-span-6">
            <CoinHeader symbol={selectedSymbol} />
            
            {/* Additional info area - can add chart here later */}
            <div className="mt-4 bg-card rounded-lg border border-border p-6 min-h-[400px] flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">차트 영역</p>
                <p className="text-xs mt-1">TradingView 차트 연동 가능</p>
              </div>
            </div>
          </div>

          {/* Right - Order Panel 8282 Style */}
          <div className="col-span-12 lg:col-span-4 xl:col-span-4">
            <OrderPanel8282 symbol={selectedSymbol} />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/30 mt-8">
        <div className="max-w-[1920px] mx-auto px-4 py-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>바이낸스 선물 데이터 · 개인용</span>
          <span>키움증권 8282 스타일</span>
        </div>
      </footer>
    </div>
  );
};

export default Index;
