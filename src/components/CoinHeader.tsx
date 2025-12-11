import { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { useTickerWebSocket } from '@/hooks/useTickerWebSocket';
import { cn } from '@/lib/utils';

interface CoinHeaderProps {
  symbol: string;
  onSelectSymbol?: (symbol: string) => void;
}

const CoinHeader = ({ symbol, onSelectSymbol }: CoinHeaderProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { tickers, isConnected } = useTickerWebSocket();
  
  // Get all available symbols from tickers
  const allSymbols = tickers.map(t => t.symbol).sort();
  
  // Filter symbols based on input - show top coins if no input, otherwise filter
  const filteredSymbols = inputValue.length > 0
    ? allSymbols.filter(s => 
        s.replace('USDT', '').toLowerCase().includes(inputValue.toLowerCase())
      ).slice(0, 15)
    : allSymbols.slice(0, 15); // Show first 15 coins when no input

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsEditing(false);
        setInputValue('');
        setShowSuggestions(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleClick = () => {
    if (onSelectSymbol) {
      setInputValue('');
      setIsEditing(true);
      setShowSuggestions(true);
    }
  };

  const handleSelectSymbol = (selectedSymbol: string) => {
    if (onSelectSymbol) {
      onSelectSymbol(selectedSymbol);
    }
    setIsEditing(false);
    setInputValue('');
    setShowSuggestions(false);
  };

  const handleSubmit = () => {
    if (inputValue.trim() && onSelectSymbol) {
      const formatted = inputValue.trim().toUpperCase();
      const finalSymbol = formatted.endsWith('USDT') ? formatted : `${formatted}USDT`;
      
      // Check if symbol exists
      if (allSymbols.includes(finalSymbol)) {
        onSelectSymbol(finalSymbol);
      } else if (filteredSymbols.length > 0) {
        // Select first matching symbol
        onSelectSymbol(filteredSymbols[0]);
      } else {
        // Try anyway
        onSelectSymbol(finalSymbol);
      }
    }
    setIsEditing(false);
    setInputValue('');
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setInputValue('');
      setShowSuggestions(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value.toUpperCase());
    setShowSuggestions(true);
  };

  if (isEditing) {
    return (
      <div ref={containerRef} className="relative">
        <div className="bg-card rounded border border-primary px-3 py-1.5 flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="종목 검색 (예: BTC, ETH)"
            className="flex-1 bg-transparent text-sm font-bold outline-none placeholder:text-muted-foreground placeholder:font-normal"
          />
          <button
            onClick={() => {
              setIsEditing(false);
              setInputValue('');
              setShowSuggestions(false);
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        
        {/* Suggestions dropdown */}
        {showSuggestions && filteredSymbols.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
            {filteredSymbols.map((s) => (
              <button
                key={s}
                onClick={() => handleSelectSymbol(s)}
                className={cn(
                  "w-full px-3 py-2 text-left text-sm hover:bg-secondary/50 flex items-center justify-between",
                  s === symbol && "bg-primary/10"
                )}
              >
                <span className="font-semibold">
                  {s.replace('USDT', '')}
                  <span className="text-muted-foreground font-normal text-xs">/USDT</span>
                </span>
                {s === symbol && (
                  <span className="text-[10px] text-primary">현재</span>
                )}
              </button>
            ))}
          </div>
        )}
        
        {/* Loading state */}
        {showSuggestions && !isConnected && filteredSymbols.length === 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 px-3 py-2 text-sm text-muted-foreground">
            종목 데이터 로딩중...
          </div>
        )}
        
        {/* No results message */}
        {showSuggestions && isConnected && inputValue.length > 0 && filteredSymbols.length === 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 px-3 py-2 text-sm text-muted-foreground">
            검색 결과 없음 - Enter로 직접 이동
          </div>
        )}
      </div>
    );
  }

  return (
    <div 
      onClick={handleClick}
      className="bg-card rounded border border-border px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:border-primary/50 transition-colors"
    >
      <h2 className="text-sm font-bold">
        {symbol.replace('USDT', '')}
        <span className="text-muted-foreground font-normal text-xs">/USDT</span>
      </h2>
      {onSelectSymbol && (
        <Search className="w-3 h-3 text-muted-foreground ml-auto" />
      )}
    </div>
  );
};

export default CoinHeader;
