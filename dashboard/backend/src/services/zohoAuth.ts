import axios from 'axios';
import { config } from '../config';

/**
 * Internal state for a Zoho OAuth token pair.
 *
 * @remarks
 * This interface is used exclusively by this module to track the current
 * access token and its expiration window. It is not exported.
 */
interface TokenState {
  /** The current active Zoho OAuth access token. */
  accessToken: string;
  /** Unix timestamp (milliseconds) at which `accessToken` expires. */
  expiresAt: number;
}

/**
 * Buffer window: 5 minutes before actual expiry.
 *
 * @remarks
 * The auto-refresh timer fires this many milliseconds prior to `expiresAt`
 * so that the new token is obtained before the old one becomes invalid,
 * avoiding race conditions with in-flight requests.
 */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Module-level singleton holding the current OAuth token.
 *
 * @remarks
 * Set to `null` until `initAuth()` is called (typically at app startup).
 * All downstream consumers should call `initAuth()` first.
 */
let tokenState: TokenState | null = null;

/**
 * Handle for the auto-refresh timer.
 *
 * @remarks
 * Cleared and recreated whenever the schedule is recalculated (e.g., after
 * a successful refresh or when the module is reloaded).
 */
let refreshTimer: NodeJS.Timeout | null = null;

/**
 * Fetches a fresh OAuth access token from Zoho by exchanging the stored
 * refresh token.
 *
 * @param _ — This function takes no parameters; credentials are read from
 *        the module-level `config` object.
 * @returns A promise resolving to a `TokenState` containing the new access
 *          token and its computed expiration timestamp.
 * @throws {Error} When Zoho returns an error response or the response lacks
 *                 an `access_token` field. The error message includes the
 *                 raw Zoho error payload for debugging.
 *
 * @remarks
 * - Uses the `refresh_token` grant type (OAuth 2.0).
 * - The refresh token itself is static — it comes from `config.zoho.refreshToken`
 *   and is **not** rotated by this function. If Zoho revokes or rotates the
 *   refresh token externally, `initAuth()` must be re-run with updated config.
 * - On network errors the original Axios error is re-thrown with an augmented
 *   message that includes the HTTP status code and response body.
 */
async function fetchNewToken(): Promise<TokenState> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.zoho.clientId,
    client_secret: config.zoho.clientSecret,
    refresh_token: config.zoho.refreshToken,
  });

  const res = await axios.post(
    `${config.zoho.accountsUrl}/oauth/v2/token`,
    params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  ).catch(err => {
    if (axios.isAxiosError(err)) {
      const body = JSON.stringify(err.response?.data ?? {});
      throw new Error(`Zoho OAuth ${err.response?.status}: ${body}`);
    }
    throw err;
  });

  const { access_token, expires_in, error } = res.data;

  if (error || !access_token) {
    throw new Error(
      `Zoho token exchange failed: ${error ?? 'no access_token'} — response: ${JSON.stringify(res.data)}`
    );
  }

  return {
    accessToken: access_token,
    expiresAt: Date.now() + (expires_in as number) * 1000,
  };
}

/**
 * Schedules a one-shot timer that calls `fetchNewToken()` just before the
 * current token expires.
 *
 * @remarks
 * - Only runs when `tokenState` is non-null (i.e., after `initAuth()` has
 *   been called).
 * - If the refresh succeeds, the function **recursively** calls itself to
 *   schedule the next refresh cycle, creating a self-sustaining loop for
 *   the lifetime of the process.
 * - If the refresh fails, a fallback timer retries every 60 seconds until
 *   success. This prevents the module from entering a permanent broken state.
 * - Clearing stale timers via `clearTimeout` ensures that rapid successive
 *   calls (e.g., during hot-reload in development) do not accumulate
 *   duplicate timers.
 *
 * @throws Does not throw; errors are logged to `console` and handled
 *         via the retry mechanism described above.
 */
function scheduleRefresh(): void {
  if (!tokenState) return;
  const delay = Math.max(tokenState.expiresAt - Date.now() - REFRESH_BUFFER_MS, 0);

  if (refreshTimer) clearTimeout(refreshTimer);

  refreshTimer = setTimeout(async () => {
    try {
      tokenState = await fetchNewToken();
      const expiresInMin = Math.round((tokenState.expiresAt - Date.now()) / 60_000);
      console.log(`🔄 Zoho token refreshed — expires in ${expiresInMin} min`);
      scheduleRefresh();  // Keep scheduling refreshes while running
    } catch (err) {
      console.error('❌ Token auto-refresh failed:', (err as Error).message);
      // Retry in 60 seconds if refresh fails
      setTimeout(scheduleRefresh, 60_000);
    }
  }, delay);
}

/**
 * Initializes the Zoho OAuth session at application startup.
 *
 * @remarks
 * Call this function once during your server's bootstrap sequence (e.g.,
 * in your Express app entry point or Fastify `onReady` hook). It performs
 * two actions:
 *
 * 1. Fetches an access token via `fetchNewToken()`.
 * 2. Starts the periodic auto-refresh timer via `scheduleRefresh()`.
 *
 * After successful initialization, `getAccessToken()` and
 * `getTokenExpiresAt()` will return the token and its expiration
 * timestamp for use in downstream Zoho API calls.
 *
 * @throws {Error} If the initial token fetch fails (delegated to
 *                 `fetchNewToken`'s error handling). The application
 *                 should treat this as a fatal startup error and
 *                 abort.
 *
 * @example
 * ```ts
 * import { initAuth } from './services/zohoAuth';
 *
 * async function main() {
 *   await initAuth();
 *   startServer();
 * }
 * ```
 */
export async function initAuth(): Promise<void> {
  tokenState = await fetchNewToken();
  const expiresInMin = Math.round((tokenState.expiresAt - Date.now()) / 60_000);
  console.log(`✅ Zoho token acquired — expires in ${expiresInMin} min`);
  scheduleRefresh();  // Start periodic refresh
}

/**
 * Returns the current OAuth access token.
 *
 * @returns The active Zoho access token string.
 * @throws {Error} If `initAuth()` has not been called yet (i.e., the module
 *                 is in an uninitialized state).
 *
 * @remarks
 * This function is the primary way for downstream services (e.g., Zoho
 * Books, Zoho CRM clients) to obtain the bearer token for API requests.
 * The token is managed internally by the auto-refresh timer; callers
 * should never need to handle token lifecycle themselves.
 *
 * For the expiration timestamp, use `getTokenExpiresAt()` instead of
 * parsing this token.
 */
export function getAccessToken(): string {
  if (!tokenState) throw new Error('Zoho auth not initialized');
  return tokenState.accessToken;
}

/**
 * Returns the Unix timestamp (milliseconds) at which the current access
 * token expires.
 *
 * @returns The expiration timestamp in Unix milliseconds.
 * @throws {Error} If `initAuth()` has not been called yet.
 *
 * @remarks
 * Useful for logging, monitoring, or defensive checks before making
 * a Zoho API call. Compare the return value against `Date.now()` to
 * determine remaining lifetime:
 *
 * ```ts
 * const remainingMs = getTokenExpiresAt() - Date.now();
 * if (remainingMs < 60_000) {
 *   console.warn('Zoho token expires in under 1 minute');
 * }
 * ```
 */
export function getTokenExpiresAt(): number {
  if (!tokenState) throw new Error('Zoho auth not initialized');
  return tokenState.expiresAt;
}
