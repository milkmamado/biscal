import { useState, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';

interface CoinHeaderProps {
  symbol: string;
  onSelectSymbol?: (symbol: string) => void;
}

const CoinHeader = ({ symbol, onSelectSymbol }: CoinHeaderProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleClick = () => {
    if (onSelectSymbol) {
      setInputValue('');
      setIsEditing(true);
    }
  };

  const handleSubmit = () => {
    if (inputValue.trim() && onSelectSymbol) {
      const formatted = inputValue.trim().toUpperCase();
      // Add USDT suffix if not present
      const finalSymbol = formatted.endsWith('USDT') ? formatted : `${formatted}USDT`;
      onSelectSymbol(finalSymbol);
    }
    setIsEditing(false);
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setInputValue('');
    }
  };

  const handleBlur = () => {
    setIsEditing(false);
    setInputValue('');
  };

  if (isEditing) {
    return (
      <div className="bg-card rounded border border-primary px-3 py-1.5 flex items-center gap-2">
        <Search className="w-3.5 h-3.5 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value.toUpperCase())}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder="종목 입력 (예: BTC)"
          className="flex-1 bg-transparent text-sm font-bold outline-none placeholder:text-muted-foreground placeholder:font-normal"
        />
        <span className="text-[10px] text-muted-foreground">Enter로 이동</span>
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
