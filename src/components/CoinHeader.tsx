interface CoinHeaderProps {
  symbol: string;
}

const CoinHeader = ({ symbol }: CoinHeaderProps) => {
  return (
    <div className="bg-card rounded border border-border px-3 py-1.5 flex items-center">
      <h2 className="text-sm font-bold">
        {symbol.replace('USDT', '')}
        <span className="text-muted-foreground font-normal text-xs">/USDT</span>
      </h2>
    </div>
  );
};

export default CoinHeader;
