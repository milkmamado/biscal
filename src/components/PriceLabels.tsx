import { cn } from '@/lib/utils';

export interface OrderLabel {
  id: string;
  price: number;
  type: 'pending' | 'filled';
  side: 'long' | 'short';
  quantity: number;
}

interface PriceLabelsProps {
  orders: OrderLabel[];
  currentPrice: number;
  highPrice: number;
  lowPrice: number;
  chartHeight: number;
  entryPrice?: number;
}

const PriceLabels = ({ 
  orders, 
  currentPrice, 
  highPrice, 
  lowPrice, 
  chartHeight,
  entryPrice 
}: PriceLabelsProps) => {
  const priceRange = highPrice - lowPrice;
  if (priceRange <= 0) return null;

  const getYPosition = (price: number) => {
    const percent = (highPrice - price) / priceRange;
    return Math.max(0, Math.min(chartHeight - 20, percent * chartHeight));
  };

  return (
    <div className="absolute right-0 top-0 w-16 h-full pointer-events-none z-10">
      {/* Entry Price Label */}
      {entryPrice && entryPrice > 0 && (
        <div
          className="absolute right-0 flex items-center gap-0.5"
          style={{ top: getYPosition(entryPrice) }}
        >
          <div className="w-2 h-px bg-green-500" />
          <div className="bg-green-600 text-white text-[8px] px-1 py-0.5 rounded-sm font-mono whitespace-nowrap">
            진입 {entryPrice.toFixed(4)}
          </div>
        </div>
      )}

      {/* Pending Order Labels */}
      {orders.filter(o => o.type === 'pending').map((order) => (
        <div
          key={order.id}
          className="absolute right-0 flex items-center gap-0.5"
          style={{ top: getYPosition(order.price) }}
        >
          <div className={cn(
            "w-2 h-px",
            order.side === 'long' ? "bg-red-500" : "bg-blue-500"
          )} />
          <div className={cn(
            "text-white text-[8px] px-1 py-0.5 rounded-sm font-mono whitespace-nowrap",
            order.side === 'long' ? "bg-red-600" : "bg-blue-600"
          )}>
            {order.side === 'long' ? 'L' : 'S'} {order.price.toFixed(4)}
          </div>
        </div>
      ))}

      {/* Filled Order Labels */}
      {orders.filter(o => o.type === 'filled').map((order) => (
        <div
          key={order.id}
          className="absolute right-0 flex items-center gap-0.5"
          style={{ top: getYPosition(order.price) }}
        >
          <div className="w-2 h-px bg-yellow-500" />
          <div className="bg-yellow-600 text-black text-[8px] px-1 py-0.5 rounded-sm font-mono whitespace-nowrap">
            ✓ {order.price.toFixed(4)}
          </div>
        </div>
      ))}

      {/* Current Price Indicator */}
      <div
        className="absolute right-0 flex items-center gap-0.5"
        style={{ top: getYPosition(currentPrice) }}
      >
        <div className="w-3 h-px bg-yellow-400" />
        <div className="bg-yellow-400 text-black text-[8px] px-1 py-0.5 rounded-sm font-mono font-bold whitespace-nowrap">
          {currentPrice.toFixed(4)}
        </div>
      </div>
    </div>
  );
};

export default PriceLabels;
