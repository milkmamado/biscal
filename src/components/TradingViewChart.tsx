import { useEffect, useRef, memo } from 'react';

interface TradingViewChartProps {
  symbol: string;
  interval?: string;
  height?: number;
}

const TradingViewChart = memo(({ symbol, interval = '1', height = 400 }: TradingViewChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up previous widget
    if (widgetRef.current) {
      containerRef.current.innerHTML = '';
    }

    // Convert symbol format: BTCUSDT -> BINANCE:BTCUSDT.P (perpetual futures)
    const tvSymbol = `BINANCE:${symbol}.P`;

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
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
      studies_overrides: {
        "volume.volume.color.0": "#ef535080",
        "volume.volume.color.1": "#26a69a80",
        "volume.volume ma.color": "#FF9800",
        "volume.volume ma.linewidth": 1,
        "volume.show ma": false,
        "volume.volume.transparency": 70
      },
      allow_symbol_change: false,
      details: false,
      hotlist: false,
      show_popup_button: false,
      withdateranges: false,
      hide_side_toolbar: true,
    });

    containerRef.current.appendChild(script);
    widgetRef.current = script;

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [symbol, interval]);

  return (
    <div 
      ref={containerRef} 
      className="tradingview-widget-container w-full"
      style={{ height: `${height}px` }}
    />
  );
});

TradingViewChart.displayName = 'TradingViewChart';

export default TradingViewChart;
