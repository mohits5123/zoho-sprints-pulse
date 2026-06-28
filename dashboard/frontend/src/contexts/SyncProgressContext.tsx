import { createContext, useContext, useState, ReactNode } from 'react';

interface SyncProgressContextValue {
  syncActive: boolean;
  setSyncActive: (active: boolean) => void;
}

const SyncProgressContext = createContext<SyncProgressContextValue>({
  syncActive: false,
  setSyncActive: () => {},
});

export function SyncProgressProvider({ children }: { children: ReactNode }) {
  const [syncActive, setSyncActive] = useState(false);
  return (
    <SyncProgressContext.Provider value={{ syncActive, setSyncActive }}>
      {children}
    </SyncProgressContext.Provider>
  );
}

export function useSyncProgress() {
  return useContext(SyncProgressContext);
}
