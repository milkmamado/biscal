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
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { tickers } = useTickerWebSocket();
  
  // 기본 심볼 목록은 WebSocket에서, 없으면 REST API에서 한 번만 가져오기
  useEffect(() => {
    if (tickers.length > 0) {
      const symbols = Array.from(new Set(tickers.map(t => t.symbol))).sort();
      setAllSymbols(symbols);
    }
  }, [tickers]);
  
  useEffect(() => {
    if (allSymbols.length === 0) {
      // WebSocket이 아직 로딩 중일 때를 대비해서 한 번만 REST로 심볼 리스트 로딩
      fetch('https://fapi.binance.com/fapi/v1/exchangeInfo')
        .then(res => res.json())
        .then(data => {
          const symbols = (data.symbols || [])
            .filter((s: any) => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT')
            .map((s: any) => s.symbol)
            .sort();
          if (symbols.length > 0) {
            setAllSymbols(symbols);
          }
        })
        .catch((err) => {
          console.error('[CoinHeader] Failed to load symbols from REST:', err);
        });
    }
  }, [allSymbols.length]);
  
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
        setHighlightedIndex(0);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // Reset highlight when filtered list changes
  useEffect(() => {
    if (showSuggestions && filteredSymbols.length > 0) {
      setHighlightedIndex(0);
    }
  }, [showSuggestions, filteredSymbols.length]);

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
      if (showSuggestions && filteredSymbols.length > 0) {
        handleSelectSymbol(filteredSymbols[highlightedIndex] ?? filteredSymbols[0]);
      } else {
        handleSubmit();
      }
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setInputValue('');
      setShowSuggestions(false);
      setHighlightedIndex(0);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!showSuggestions && filteredSymbols.length > 0) {
        setShowSuggestions(true);
        setHighlightedIndex(0);
      } else if (filteredSymbols.length > 0) {
        setHighlightedIndex((prev) => (prev + 1) % filteredSymbols.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredSymbols.length > 0) {
        setHighlightedIndex((prev) => (prev - 1 + filteredSymbols.length) % filteredSymbols.length);
      }
    }
  };
 
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
     const nextValue = e.target.value.toUpperCase();
     setInputValue(nextValue);
     setShowSuggestions(true);
     setHighlightedIndex(0);
     console.log('[CoinHeader] input:', nextValue, 'allSymbols:', allSymbols.length, 'filtered:', filteredSymbols.length);
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
            {filteredSymbols.map((s, index) => (
              <button
                key={s}
                onClick={() => handleSelectSymbol(s)}
                className={cn(
                  "w-full px-3 py-2 text-left text-sm flex items-center justify-between",
                  s === symbol && "bg-primary/10",
                  index === highlightedIndex
                    ? "bg-secondary/70"
                    : "hover:bg-secondary/50"
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
        
        {/* No results message */}
        {showSuggestions && inputValue.length > 0 && filteredSymbols.length === 0 && allSymbols.length > 0 && (
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
