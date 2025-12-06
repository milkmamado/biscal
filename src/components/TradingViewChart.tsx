import { useEffect, useRef, memo, useState } from 'react';

interface TradingViewChartProps {
  symbol: string;
  interval?: string;
  height?: number;
}

const TradingViewChart = memo(({ symbol, interval = '1', height = 400 }: TradingViewChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const widgetIdRef = useRef(`tradingview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);

  useEffect(() => {
    if (!containerRef.current) return;
    
    setIsLoading(true);
    
    // Generate new widget ID for clean reload
    widgetIdRef.current = `tradingview_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Clear container
    containerRef.current.innerHTML = '';
    
    // Create widget container div
    const widgetContainer = document.createElement('div');
    widgetContainer.id = widgetIdRef.current;
    widgetContainer.style.height = '100%';
    widgetContainer.style.width = '100%';
    containerRef.current.appendChild(widgetContainer);

    // Convert symbol format: BTCUSDT -> BINANCE:BTCUSDT.P (perpetual futures)
    const tvSymbol = `BINANCE:${symbol}.P`;

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      container_id: widgetIdRef.current,
      autosize: true,
      symbol: tvSymbol,
      interval: interval,
      timezone: "Asia/Seoul",
      theme: "dark",
      style: "1",
      locale: "kr",
      enable_publishing: false,
      hide_top_toolbar: true,
      hide_legend: true,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
      studies: ["STD;Bollinger_Bands"],
      allow_symbol_change: false,
      details: false,
      hotlist: false,
      show_popup_button: false,
      withdateranges: false,
      hide_side_toolbar: true,
    });
    
    script.onload = () => {
      // Give widget time to render
      setTimeout(() => setIsLoading(false), 500);
    };

    widgetContainer.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [symbol, interval]);

  return (
    <div className="relative w-full h-full" style={{ minHeight: `${height}px` }}>
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-card z-10">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-muted-foreground">차트 로딩중...</span>
          </div>
        </div>
      )}
      <div 
        ref={containerRef} 
        className="tradingview-widget-container w-full h-full"
        style={{ minHeight: `${height}px` }}
      />
    </div>
  );
});

TradingViewChart.displayName = 'TradingViewChart';

export default TradingViewChart;
