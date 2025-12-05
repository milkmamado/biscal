import { useState } from 'react';
import BollingerCoinList from '@/components/BollingerCoinList';
import OrderBook from '@/components/OrderBook';
import CoinHeader from '@/components/CoinHeader';
import BollingerChart from '@/components/BollingerChart';
import { Activity } from 'lucide-react';

const Index = () => {
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');

  return (
    <div className="min-h-screen bg-background">
      {/* Top Bar */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-[1920px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold">BB 트레이더</h1>
              <p className="text-xs text-muted-foreground">볼린저 밴드 상단 돌파 스캐너</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-positive animate-pulse" />
            <span className="text-xs text-muted-foreground">실시간 연결됨</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1920px] mx-auto p-4">
        <div className="grid grid-cols-12 gap-4">
          {/* Left Sidebar - BB Coin List */}
          <div className="col-span-12 lg:col-span-3 xl:col-span-2">
            <BollingerCoinList
              onSelectSymbol={setSelectedSymbol}
              selectedSymbol={selectedSymbol}
            />
          </div>

          {/* Main Area */}
          <div className="col-span-12 lg:col-span-9 xl:col-span-10">
            {/* Coin Header */}
            <CoinHeader symbol={selectedSymbol} />

            {/* Charts & Order Book */}
            <div className="grid grid-cols-12 gap-4 mt-4">
              {/* BB Chart */}
              <div className="col-span-12 xl:col-span-8">
                <BollingerChart symbol={selectedSymbol} />
              </div>

              {/* Order Book */}
              <div className="col-span-12 xl:col-span-4">
                <OrderBook symbol={selectedSymbol} />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/30 mt-8">
        <div className="max-w-[1920px] mx-auto px-4 py-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>바이낸스 선물 데이터 · 개인용</span>
          <span>5분봉 볼린저밴드 (20MA, 2σ)</span>
        </div>
      </footer>
    </div>
  );
};

export default Index;
