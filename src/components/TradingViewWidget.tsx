import { useEffect, useRef, memo } from 'react';

interface TradingViewWidgetProps {
  symbol: string;
  interval?: string;
  height?: number;
}

const intervalMap: Record<string, string> = {
  '1': '1',
  '3': '3',
  '5': '5',
  '15': '15',
  '30': '30',
  '60': '60',
  '240': '240',
  'D': 'D',
};

const TradingViewWidget = memo(({ symbol, interval = '1', height = 500 }: TradingViewWidgetProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous widget
    containerRef.current.innerHTML = '';

    const tvInterval = intervalMap[interval] || '1';
    const tvSymbol = `BINANCE:${symbol}.P`;

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: tvInterval,
      timezone: 'Asia/Seoul',
      theme: 'dark',
      style: '1',
      locale: 'kr',
      backgroundColor: 'rgba(10, 10, 10, 1)',
      gridColor: 'rgba(31, 41, 55, 1)',
      hide_top_toolbar: true,
      hide_legend: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: 'https://www.tradingview.com',
      studies: ['BB@tv-basicstudies'],
    });

    containerRef.current.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [symbol, interval]);

  return (
    <div 
      ref={containerRef} 
      className="tradingview-widget-container"
      style={{ width: '100%', height }}
    />
  );
});

TradingViewWidget.displayName = 'TradingViewWidget';

export default TradingViewWidget;
