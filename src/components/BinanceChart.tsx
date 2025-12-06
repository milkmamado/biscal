import { memo } from 'react';

interface BinanceChartProps {
  symbol: string;
  interval?: string;
  height?: number;
}

const intervalMap: Record<string, string> = {
  '1': '1m',
  '3': '3m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '60': '1h',
  '240': '4h',
  'D': '1d',
};

const BinanceChart = memo(({ symbol, interval = '1', height = 500 }: BinanceChartProps) => {
  const binanceInterval = intervalMap[interval] || '1m';
  
  // Binance futures chart embed URL
  const chartUrl = `https://www.binance.com/en/futures/${symbol}?theme=dark`;

  return (
    <div style={{ width: '100%', height }} className="bg-[#0a0a0a]">
      <iframe
        src={chartUrl}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
        }}
        title={`${symbol} Chart`}
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
});

BinanceChart.displayName = 'BinanceChart';

export default BinanceChart;
