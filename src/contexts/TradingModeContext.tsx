import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export type TradingMode = 'real' | 'paper';

interface TradingModeContextType {
  mode: TradingMode;
  setMode: (mode: TradingMode) => void;
  isTestnet: boolean;
  isPaperTrading: boolean;
}

const TradingModeContext = createContext<TradingModeContextType | undefined>(undefined);

export const TradingModeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setModeState] = useState<TradingMode>('real');

  const setMode = useCallback((newMode: TradingMode) => {
    setModeState(newMode);
    console.log(`[TradingMode] Switched to ${newMode} mode`);
  }, []);

  const value = {
    mode,
    setMode,
    isTestnet: mode === 'paper',
    isPaperTrading: mode === 'paper',
  };

  return (
    <TradingModeContext.Provider value={value}>
      {children}
    </TradingModeContext.Provider>
  );
};

export const useTradingMode = () => {
  const context = useContext(TradingModeContext);
  if (!context) {
    throw new Error('useTradingMode must be used within a TradingModeProvider');
  }
  return context;
};
