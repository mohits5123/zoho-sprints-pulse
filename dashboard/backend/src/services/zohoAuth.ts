import axios from 'axios';
import { config } from '../config';

/** Token state: holds the current OAuth access token and expiration timestamp. */
interface TokenState {
  accessToken: string;  // Current active access token
  expiresAt: number;    // Unix timestamp when token expires (ms)
}

/** Refresh buffer: 5 minutes before token expiry to request new token proactively. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Global token state and auto-refresh timer (initialized during app startup)
let tokenState: TokenState | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

/**
 * Fetch a new OAuth access token from Zoho using the refresh token.
 * Uses client credentials grant type to exchange refresh_token for access_token.
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
 * Schedule automatic token refresh before expiry (REFRESH_BUFFER_MS ahead).
 * Retries every 60 seconds if refresh fails.
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

/** Initialize OAuth token on app startup. Calls fetchNewToken() and starts auto-refresh timer. */
export async function initAuth(): Promise<void> {
  tokenState = await fetchNewToken();
  const expiresInMin = Math.round((tokenState.expiresAt - Date.now()) / 60_000);
  console.log(`✅ Zoho token acquired — expires in ${expiresInMin} min`);
  scheduleRefresh();  // Start periodic refresh
}

/** Get the current OAuth access token. Throws if auth not initialized. */
export function getAccessToken(): string {
  if (!tokenState) throw new Error('Zoho auth not initialized');
  return tokenState.accessToken;
}

/** Get the token expiration timestamp (Unix ms). Throws if auth not initialized. */
export function getTokenExpiresAt(): number {
  if (!tokenState) throw new Error('Zoho auth not initialized');
  return tokenState.expiresAt;
}
