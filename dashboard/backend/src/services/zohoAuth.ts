import axios from 'axios';
import { config } from '../config';

interface TokenState {
  accessToken: string;
  expiresAt: number; // Unix ms
}

// Refresh the token 5 minutes before it expires
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

let tokenState: TokenState | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

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

function scheduleRefresh(): void {
  if (!tokenState) return;
  const delay = Math.max(tokenState.expiresAt - Date.now() - REFRESH_BUFFER_MS, 0);

  if (refreshTimer) clearTimeout(refreshTimer);

  refreshTimer = setTimeout(async () => {
    try {
      tokenState = await fetchNewToken();
      const expiresInMin = Math.round((tokenState.expiresAt - Date.now()) / 60_000);
      console.log(`🔄 Zoho token refreshed — expires in ${expiresInMin} min`);
      scheduleRefresh();
    } catch (err) {
      console.error('❌ Token auto-refresh failed:', (err as Error).message);
      // Retry in 60 seconds
      setTimeout(scheduleRefresh, 60_000);
    }
  }, delay);
}

export async function initAuth(): Promise<void> {
  tokenState = await fetchNewToken();
  const expiresInMin = Math.round((tokenState.expiresAt - Date.now()) / 60_000);
  console.log(`✅ Zoho token acquired — expires in ${expiresInMin} min`);
  scheduleRefresh();
}

export function getAccessToken(): string {
  if (!tokenState) throw new Error('Zoho auth not initialized');
  return tokenState.accessToken;
}

export function getTokenExpiresAt(): number {
  if (!tokenState) throw new Error('Zoho auth not initialized');
  return tokenState.expiresAt;
}
