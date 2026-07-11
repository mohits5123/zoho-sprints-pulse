/**
 * Shared error handling utilities for API calls.
 */

type ApiError = {
  response?: {
    data?: {
      error?: string;
    };
  };
};

/**
 * Extract error message from API error response.
 * @param err - Unknown error from API call
 * @returns Error message string or undefined
 */
export function extractApiError(err: unknown): string | undefined {
  if (err instanceof Error && 'response' in err) {
    return (err as ApiError).response?.data?.error;
  }
  return undefined;
}

/**
 * Handle API error by showing alert with error message.
 * Falls back to console.error if no message is available.
 * @param err - Unknown error from API call
 * @param context - Optional context message for logging
 */
export function handleApiError(err: unknown, context?: string): void {
  const message = extractApiError(err);
  if (message) {
    alert(message);
  } else {
    console.error(context || 'API error:', err);
  }
}
