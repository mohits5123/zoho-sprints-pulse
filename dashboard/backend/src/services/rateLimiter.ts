/**
 * Fixed-window rate limiter for Zoho API calls.
 * Enforces 25 requests per 60-second window. When the limit is reached,
 * waits for the current window to expire before resuming.
 *
 * Usage:
 *   await zohoThrottle.wait('label');  // before every Zoho axios call
 *   zohoThrottle.record(res.status);   // after a successful response
 *   zohoThrottle.recordError(status?); // after a failed/thrown request
 *   zohoThrottle.printSummary();       // at end of sync
 */

import axios from 'axios';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanUrl(url?: string): string {
  if (!url) return '';
  return url
    .replace('https://sprintsapi.zoho.in/zsapi', '')
    .replace('https://accounts.zoho.in', '');
}

class ZohoRateLimiter {
  private windowStart = 0;
  private windowCount = 0;
  private readonly limit = 25;
  private readonly windowMs = 60_000;

  // Stats for current sync run
  public sent = 0;
  public ok = 0;
  public failed = 0;
  private _label = '';

  async wait(label = ''): Promise<void> {
    const now = Date.now();

    // Start or reset fixed window
    if (this.windowStart === 0 || now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.windowCount = 0;
    }

    // Window full — wait for it to expire
    if (this.windowCount >= this.limit) {
      const waitMs = this.windowMs - (now - this.windowStart) + 100;
      console.log(`⏳ Rate limit (${this.limit} req/min) — waiting ${Math.ceil(waitMs / 1000)}s for next window...`);
      await sleep(waitMs);
      this.windowStart = Date.now();
      this.windowCount = 0;
    }

    this.windowCount++;
    this.sent++;
    this._label = label;
  }

  recordSuccess(): void {
    this.ok++;
  }

  recordFailure(): void {
    this.failed++;
  }

  // Legacy wrappers for backwards compatibility (no-op console logs to prevent duplicates)
  record(statusCode: number): void {
    // Interceptor now handles counting and logging
  }

  recordError(statusCode?: number): void {
    // Interceptor now handles counting and logging
  }

  printSummary(): void {
    console.log(`\n📊 Zoho Sync Summary:`);
    console.log(`   Total requests sent:  ${this.sent}`);
    console.log(`   Successful responses: ${this.ok}`);
    console.log(`   Failed requests:      ${this.failed}\n`);
  }

  resetStats(): void {
    this.sent = 0;
    this.ok = 0;
    this.failed = 0;
    this.windowStart = 0;
    this.windowCount = 0;
    this._label = '';
  }

  getCurrentCount(): number {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) return 0;
    return this.windowCount;
  }

  // Legacy alias
  reset(): void { this.resetStats(); }
}

export const zohoThrottle = new ZohoRateLimiter();

// Register global Axios interceptors for centralized logging
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
