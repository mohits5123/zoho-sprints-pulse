/**
 * Fixed-window rate limiter for Zoho API calls.
 *
 * Enforces 25 requests per 60-second sliding window to avoid hitting Zoho's rate limits.
 * When the limit is reached, automatically waits for the next window to expire before
 * allowing more requests. Required on every runtime API call per project constraints.
 *
 * Design: Uses a fixed-window algorithm (not sliding) where a 60-second window starts
 * on the first request and resets entirely after 60 seconds. This is simpler and more
 * predictable than a sliding window, and aligns with Zoho's documented rate limiting
 * behavior (25 requests per minute window).
 *
 * The module also registers global Axios interceptors that automatically track success
 * and failure counts for every Zoho API request, eliminating the need for manual
 * recording at each call site.
 *
 * Usage pattern:
 *   - await zohoThrottle.wait('label')  // Before every Zoho axios call (include label for tracking)
 *   - zohoThrottle.record(statusCode)   // After successful response (interceptor now handles this)
 *   - zohoThrottle.recordError(status?) // After failed/thrown request (interceptor now handles this)
 *   - zohoThrottle.printSummary()       // At end of sync for statistics
 */

import axios from 'axios';

/**
 * Non-blocking sleep helper.
 * Returns a promise that resolves after the specified number of milliseconds.
 * Used to pause execution while waiting for a rate limit window to expire.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sanitizes a Zoho API URL by stripping the base domain and protocol prefix.
 * Strips the Zoho API base path (`/zsapi`) and account domain (`accounts.zoho.in`)
 * so that only the meaningful endpoint path remains for logging purposes.
 *
 * @param url - The raw URL string, may be undefined.
 * @returns The cleaned URL string with base domains removed, or empty string if input is falsy.
 */
function cleanUrl(url?: string): string {
  if (!url) return '';
  return url
    .replace('https://sprintsapi.zoho.in/zsapi', '')
    .replace('https://accounts.zoho.in', '');
}

/**
 * Rate limiter class enforcing 25 requests per 60-second fixed window.
 *
 * Tracks request statistics for the current sync run and automatically blocks
 * new requests when the rate limit is reached, waiting for the current window
 * to expire before allowing further requests.
 *
 * The rate limiter operates as a fixed-window counter: once the window starts,
 * it counts requests until the limit (25) is reached. At that point, all
 * subsequent calls to `wait()` will block until the 60-second window elapses,
 * at which point the counter resets and request flow resumes.
 *
 * Stats (sent, ok, failed) are scoped to a single sync run and are reset
 * when `resetStats()` is called, typically at the start of each sync.
 */
class ZohoRateLimiter {
  private windowStart = 0;      // Unix timestamp (ms) when the current window started
  private windowCount = 0;      // Number of requests made in the current window (capped at 25)
  private readonly limit = 25;  // Zoho API rate limit: 25 requests per window
  private readonly windowMs = 60_000;  // Window duration: 60 seconds in milliseconds

  /** Stats for the current sync run (reset at each sync start via `resetStats()`). */
  public sent = 0;      // Total requests that passed through the rate limiter in this run
  public ok = 0;        // Successful responses (2xx status codes) recorded via interceptors
  public failed = 0;    // Failed requests (non-2xx or network errors) recorded via interceptors
  private _label = '';   // Label of the most recent request for debugging/tracking

  /**
   * Waits if the rate limit has been reached, blocking until the next window opens.
   *
   * This method implements the core rate limiting logic:
   * 1. If no window is active or the current window has expired, start a new window.
   * 2. If the window is full (25 requests), calculate remaining time and wait synchronously
   *    using `sleep()` until the window expires.
   * 3. Increment the request counters and store the label for the current request.
   *
   * This should be called **before** every Zoho API request to ensure compliance
   * with Zoho's 25 requests per minute limit.
   *
   * @param label - Optional human-readable identifier for the request (e.g., `'users/p1'`,
   *                `'contacts/sync'`). Used for debugging and tracking which endpoint
   *                triggered the rate limit. Defaults to an empty string.
   *
   * @example
   * ```ts
   * await zohoThrottle.wait('users/p1');
   * const response = await axios.get('/zsapi/users/p1');
   * ```
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
      console.log(`Rate limit (${this.limit} req/min) — waiting ${Math.ceil(waitMs / 1000)}s for next window...`);
      await sleep(waitMs);
      this.windowStart = Date.now();
      this.windowCount = 0;
    }

    // Increment counter and track stats
    this.windowCount++;
    this.sent++;
    this._label = label;
  }

  /**
   * Records a successful API response. Increments the `ok` counter.
   *
   * This is now handled automatically by the Axios response interceptor,
   * so manual calls are no longer required. Kept for explicit use cases.
   */
  recordSuccess(): void {
    this.ok++;
  }

  /**
   * Records a failed API response. Increments the `failed` counter.
   *
   * This is now handled automatically by the Axios error interceptor,
   * so manual calls are no longer required. Kept for explicit use cases.
   */
  recordFailure(): void {
    this.failed++;
  }

  /**
   * Legacy wrapper for backwards compatibility. No longer performs any action.
   *
   * @deprecated Use the Axios interceptors directly — they now handle all counting and logging.
   * @param statusCode - The HTTP status code (ignored).
   */
  record(statusCode: number): void {
    // Interceptor now handles counting and logging
  }

  /**
   * Legacy error recorder for backwards compatibility. No longer performs any action.
   *
   * @deprecated Use the Axios interceptors directly — they now handle all error counting and logging.
   * @param statusCode - The HTTP status code (ignored).
   */
  recordError(statusCode?: number): void {
    // Interceptor now handles counting and logging
  }

 /**
    * Prints a summary of sync statistics to the console.
   *
   * Outputs the total number of requests sent, successful responses,
   * and failed requests for the current sync run. Useful for post-sync
   * diagnostics and monitoring.
   */
  printSummary(): void {
    console.log(`\nZoho Sync Summary:`);
    console.log(`   Total requests sent:  ${this.sent}`);
    console.log(`   Successful responses: ${this.ok}`);
    console.log(`   Failed requests:      ${this.failed}\n`);
  }

  /**
   * Resets all statistics and window state for a new sync run.
   *
   * Typically called at the start of each sync operation to ensure
   * that stats from previous runs do not contaminate the current one.
   *
   * Resets: `sent`, `ok`, `failed`, `windowStart`, `windowCount`, and `_label`.
   */
  resetStats(): void {
    this.sent = 0;
    this.ok = 0;
    this.failed = 0;
    this.windowStart = 0;
    this.windowCount = 0;
    this._label = '';
  }

  /**
   * Returns the current number of requests made in the active window.
   *
   * If the window has expired (more than 60 seconds since `windowStart`),
   * returns `0` since the window is considered reset.
   *
   * @returns The request count within the current window, or `0` if expired.
   */
  getCurrentCount(): number {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) return 0;
    return this.windowCount;
  }

  /**
   * Legacy alias for `resetStats()`. Preserved for backwards compatibility.
   * @deprecated Use `resetStats()` instead.
   */
  reset(): void { this.resetStats(); }
}

/**
 * Singleton instance of the rate limiter, exported for use across the application.
 *
 * Call `await zohoThrottle.wait(label)` before each Zoho API request to enforce
 * the rate limit. Statistics are automatically tracked by the Axios interceptors.
 */
export const zohoThrottle = new ZohoRateLimiter();

// Register global Axios interceptors for centralized request/response logging.
// These interceptors automatically increment success/failure counters and log
// every Zoho API request, eliminating the need for manual recording at call sites.
axios.interceptors.response.use(
  /**
   * Success handler: increments the success counter and logs the response.
   * Called for every HTTP 2xx response from the Zoho API.
   */
  (response) => {
    const cleaned = cleanUrl(response.config.url);
    const method = response.config.method?.toUpperCase() ?? 'GET';
    zohoThrottle.recordSuccess();
    console.log(`  [Zoho API] ${method} ${cleaned} -> Success (${response.status})`);
    return response;
  },
  /**
   * Error handler: increments the failure counter and logs the error.
   * Called for non-2xx responses and network errors. Distinguishes between
   * HTTP errors (with a response status) and network-level failures.
   */
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
