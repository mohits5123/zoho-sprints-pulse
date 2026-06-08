/**
 * Fixed-window rate limiter for Zoho API calls.
 * 
 * Enforces 25 requests per 60-second sliding window to avoid hitting Zoho's rate limits.
 * When the limit is reached, automatically waits for the next window to expire before
 * allowing more requests. Required on every runtime API call per project constraints.
 * 
 * Usage pattern:
 *   - await zohoThrottle.wait('label')  // Before every Zoho axios call (include label for tracking)
 *   - zohoThrottle.record(statusCode)   // After successful response (interceptor now handles this)
 *   - zohoThrottle.recordError(status?) // After failed/thrown request (interceptor now handles this)
 *   - zohoThrottle.printSummary()       // At end of sync for statistics
 */

import axios from 'axios';

/** Sleep helper: non-blocking delay. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanUrl(url?: string): string {
  if (!url) return '';
  return url
    .replace('https://sprintsapi.zoho.in/zsapi', '')
    .replace('https://accounts.zoho.in', '');
}

/**
 * Rate limiter class enforcing 25 requests per 60-second window.
 * Tracks request stats for the current sync run and automatically waits when limit is reached.
 */
class ZohoRateLimiter {
  private windowStart = 0;      // Unix timestamp when current window started
  private windowCount = 0;      // Number of requests in current window (max: 25)
  private readonly limit = 25;  // Zoho's rate limit: 25 requests per window
  private readonly windowMs = 60_000;  // 60 seconds in milliseconds

  /** Stats for current sync run (reset at each sync start). */
  public sent = 0;      // Total requests attempted in this run
  public ok = 0;        // Successful responses (2xx)
  public failed = 0;    // Failed requests (non-2xx or errors)
  private _label = '';   // Current request label for tracking

  /**
   * Wait if rate limit is reached. Blocks until next window starts.
   * @param label Optional request label for tracking/logging (e.g., 'users/p1')
   */
  async wait(label = ''): Promise<void> {
    const now = Date.now();

    // Start or reset fixed window when it expires
    if (this.windowStart === 0 || now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.windowCount = 0;
    }

    // Window full — wait for it to expire before making request
    if (this.windowCount >= this.limit) {
      const waitMs = this.windowMs - (now - this.windowStart) + 100;
      console.log(`⏳ Rate limit (${this.limit} req/min) — waiting ${Math.ceil(waitMs / 1000)}s for next window...`);
      await sleep(waitMs);
      this.windowStart = Date.now();
      this.windowCount = 0;
    }

    // Increment counter and track stats
    this.windowCount++;
    this.sent++;
    this._label = label;
  }

  /** Record successful response (interceptor now handles logging). */
  recordSuccess(): void {
    this.ok++;
  }

  /** Record failed response (interceptor now handles logging). */
  recordFailure(): void {
    this.failed++;
  }

  /** Legacy wrappers for backwards compatibility (no-op console logs). */
  record(statusCode: number): void {
    // Interceptor now handles counting and logging
  }

  /** Record error (interceptor now handles counting). */
  recordError(statusCode?: number): void {
    // Interceptor now handles counting and logging
  }

  /** Print sync statistics summary. */
  printSummary(): void {
    console.log(`\n📊 Zoho Sync Summary:`);
    console.log(`   Total requests sent:  ${this.sent}`);
    console.log(`   Successful responses: ${this.ok}`);
    console.log(`   Failed requests:      ${this.failed}\n`);
  }

  /** Reset all statistics for new sync run. */
  resetStats(): void {
    this.sent = 0;
    this.ok = 0;
    this.failed = 0;
    this.windowStart = 0;
    this.windowCount = 0;
    this._label = '';
  }

  /** Get current request count in window. Returns 0 if window has expired. */
  getCurrentCount(): number {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) return 0;
    return this.windowCount;
  }

  /** Legacy alias for resetStats(). */
  reset(): void { this.resetStats(); }
}

export const zohoThrottle = new ZohoRateLimiter();

// Register global Axios interceptors for centralized request/response logging
axios.interceptors.response.use(
  (response) => {
    const cleaned = cleanUrl(response.config.url);
    const method = response.config.method?.toUpperCase() ?? 'GET';
    zohoThrottle.recordSuccess();
    console.log(`  [Zoho API] ${method} ${cleaned} -> Success (${response.status})`);
    return response;
  },
  (error) => {
    zohoThrottle.recordFailure();
    const config = error.config;
    if (config) {
      const cleaned = cleanUrl(config.url);
      const method = config.method?.toUpperCase() ?? 'GET';
      if (error.response) {
        console.log(`  [Zoho API] ${method} ${cleaned} -> Failed (${error.response.status})`);
      } else {
        console.log(`  [Zoho API] ${method} ${cleaned} -> No Response (${error.message || 'Network Error'})`);
      }
    } else {
      console.log(`  [Zoho API] Request Error: ${error.message || error}`);
    }
    return Promise.reject(error);
  }
);

export { ZohoRateLimiter, sleep };
