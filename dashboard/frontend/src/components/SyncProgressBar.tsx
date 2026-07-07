import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchSyncProgress } from '../api/client';
import { useSyncProgress } from '../contexts/SyncProgressContext';
import { C } from '../theme';

const PRIMARY = C.primary;
const PRIMARY_LIGHT = `${C.primary}4d`;
const TRACK_COLOR = 'rgba(255,255,255,0.08)';

export function SyncProgressBar() {
  const { syncActive, setSyncActive } = useSyncProgress();

  const [progress, setProgress] = useState<{
    inProgress: boolean;
    percentage: number | null;
    isFirstSync: boolean;
    requestsMade: number;
    totalRequests: number;
  }>({
    inProgress: false,
    percentage: null,
    isFirstSync: false,
    requestsMade: 0,
    totalRequests: 0,
  });

  const hasSeenInProgress = useRef(false);
  const wasInProgress = useRef(false);

  const poll = useCallback(async () => {
    try {
      const data = await fetchSyncProgress();
      const clampedPercentage =
        data.percentage != null ? Math.min(100, Math.max(0, data.percentage)) : null;

      setProgress({
        inProgress: data.inProgress,
        percentage: clampedPercentage,
        isFirstSync: data.isFirstSync,
        requestsMade: data.requestsMade,
        totalRequests: data.totalRequests,
      });

      if (data.inProgress) {
        hasSeenInProgress.current = true;
        wasInProgress.current = true;
      } else if (wasInProgress.current) {
        wasInProgress.current = false;
        setSyncActive(false);
      }
    } catch (err) {
      console.error('[SyncProgressBar] Polling error:', err);
    }
  }, [setSyncActive]);

  useEffect(() => {
    if (!syncActive) {
      return;
    }

    hasSeenInProgress.current = false;
    wasInProgress.current = false;

    const timeout = setTimeout(() => {
      if (!hasSeenInProgress.current) {
        setSyncActive(false);
      }
    }, 10_000);

    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [syncActive, poll, setSyncActive]);

  if (!progress.inProgress) {
    return null;
  }

  const { percentage, isFirstSync, requestsMade, totalRequests } = progress;

  const requestsExceeded =
    totalRequests > 0 && requestsMade >= totalRequests;
  const isIndefinite = isFirstSync || requestsExceeded;
  const isDefinite = !isIndefinite && percentage != null;

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    height: 3,
    backgroundColor: TRACK_COLOR,
  };

  const barStyle: React.CSSProperties = isDefinite
    ? {
        height: '100%',
        width: '100%',
        backgroundColor: PRIMARY_LIGHT,
        position: 'relative',
        overflow: 'hidden',
      }
    : {
        height: '100%',
        width: '100%',
        background: `no-repeat linear-gradient(${PRIMARY} 0 0), no-repeat linear-gradient(${PRIMARY} 0 0), ${PRIMARY_LIGHT}`,
        backgroundSize: '60% 100%',
        animation: 'syncLoader 3s infinite',
      };

  const overlayStyle: React.CSSProperties | undefined = isDefinite
    ? {
        position: 'absolute' as const,
        top: 0,
        left: 0,
        height: '100%',
        width: `${percentage}%`,
        backgroundColor: PRIMARY,
        transition: 'width 0.5s ease',
        borderRadius: '0 2px 2px 0',
      }
    : undefined;

  return (
    <div style={containerStyle}>
      <div style={barStyle}>
        {overlayStyle && <div style={overlayStyle} />}
      </div>
    </div>
  );
}
