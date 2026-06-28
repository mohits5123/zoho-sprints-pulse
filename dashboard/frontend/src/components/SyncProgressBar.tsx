import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchSyncProgress } from '../api/client';
import { useSyncProgress } from '../contexts/SyncProgressContext';

/**
 * SyncProgressBar
 *
 * Displays a thin progress bar at the top of the viewport during a
 * background sync operation. Polls the server every 2 seconds for the
 * current sync status and updates the bar accordingly.
 *
 * Behaviour:
 *  - Only polls when `syncActive` is true (controlled by the parent app).
 *  - Stops polling when `syncActive` becomes false OR when the API never
 *    reports inProgress=true within 10s (safety timeout for syncs that
 *    don't call startSync on the backend).
 *  - Not visible when `inProgress` is false.
 *  - Width spans 100% of the screen.
 *  - First-time sync or requests-exceeded phase: indefinite (animated) loader.
 *  - Percentage available and not exceeded: definite loader filling up to 100%.
 *  - After reaching 100% in definite mode: switches to indefinite loader.
 *
 * Colors:
 *  - Track background: white-tinted → rgba(255,255,255,0.08)
 *  - Definite fill (light): blue with low opacity → rgba(59,130,246,0.3)
 *  - Definite overlay (dark): darker blue → #1d4ed8
 *  - Indefinite fill: darker blue → #1d4ed8
 */

const DARK_BLUE = '#1d4ed8';
const LIGHT_BLUE = 'rgba(59,130,246,0.3)';
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

  // Track whether we've ever seen inProgress=true to detect syncs that
  // don't call startSync() on the backend (e.g. users sync, projects sync).
  const hasSeenInProgress = useRef(false);

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
      }
    } catch (err) {
      console.error('[SyncProgressBar] Polling error:', err);
    }
  }, []);

  // Start polling when syncActive becomes true; stop when it becomes false.
  // Also add a 10s safety timeout: if syncActive is true but the API never
  // returns inProgress=true, stop polling and deactivate (handles syncs that
  // don't call startSync on the backend).
  useEffect(() => {
    if (!syncActive) {
      return;
    }

    hasSeenInProgress.current = false;

    const timeout = setTimeout(() => {
      if (!hasSeenInProgress.current) {
        // API never reported inProgress=true within 10s — stop polling.
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

  /**
   * Determine the mode:
   * - "indefinite": first sync, or requests already exceeded total (past 100%)
   * - "definite": percentage is available and we haven't exceeded requests yet
   */
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

  /**
   * Definite mode: lighter blue background track with darker blue fill
   * growing proportionally to the percentage.
   */
  const barStyle: React.CSSProperties = isDefinite
    ? {
        height: '100%',
        width: '100%',
        backgroundColor: LIGHT_BLUE,
        position: 'relative',
        overflow: 'hidden',
      }
    : {
        height: '100%',
        width: '100%',
        background: `no-repeat linear-gradient(${DARK_BLUE} 0 0), no-repeat linear-gradient(${DARK_BLUE} 0 0), ${LIGHT_BLUE}`,
        backgroundSize: '60% 100%',
        animation: 'syncLoader 3s infinite',
      };

  /**
   * Darker blue overlay that fills over the lighter tint in definite mode.
   */
  const overlayStyle: React.CSSProperties | undefined = isDefinite
    ? {
        position: 'absolute' as const,
        top: 0,
        left: 0,
        height: '100%',
        width: `${percentage}%`,
        backgroundColor: DARK_BLUE,
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
