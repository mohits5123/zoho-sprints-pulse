import { createContext, useContext, useState, ReactNode } from 'react';

/**
 * Shape of the sync progress context value.
 *
 * `syncActive` indicates whether a sync operation is currently in progress
 * across the application. Components can consume this flag to show loading
 * indicators, disable conflicting actions, or display status banners.
 */
interface SyncProgressContextValue {
  /** Whether a sync operation is currently active. */
  syncActive: boolean;
  /** Setter to toggle the active sync state. */
  setSyncActive: (active: boolean) => void;
}

/**
 * Internal context instance with a no-op default so consumers never
 * receive `undefined` when used outside the provider (defensive fallback).
 */
const SyncProgressContext = createContext<SyncProgressContextValue>({
  syncActive: false,
  setSyncActive: () => {},
});

/**
 * Provider that wraps the application (or a subtree) with sync progress
 * state.
 *
 * Place this component near the root of your React tree — typically inside
 * your app's main entry point or layout — so every descendant can read or
 * update the sync flag via `useSyncProgress()`.
 *
 * @param children – Child elements that will have access to the sync state.
 */
export function SyncProgressProvider({ children }: { children: ReactNode }) {
  const [syncActive, setSyncActive] = useState(false);
  return (
    <SyncProgressContext.Provider value={{ syncActive, setSyncActive }}>
      {children}
    </SyncProgressContext.Provider>
  );
}

/**
 * Hook to read and update the current sync progress state.
 *
 * Must be used within a `SyncProgressProvider`. Calling this hook outside
 * the provider will return the default (idle) object rather than throwing.
 *
 * @returns An object containing `syncActive` and `setSyncActive`.
 *
 * @example
 * ```tsx
 * const { syncActive, setSyncActive } = useSyncProgress();
 *
 * if (syncActive) return <Spinner />;
 * ```
 */
export function useSyncProgress() {
  return useContext(SyncProgressContext);
}
