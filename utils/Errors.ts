// Copyright © 2025 Jason Hutchcraft
// Licensed under the Business Source License 1.1 (see LICENSE for details)
// Change Date: 2029-01-01 → Apache 2.0 License

/**
 * Common error helpers for network/offline detection.
 */

export class OfflineError extends Error {
  constructor(message: string = 'Network connection unavailable') {
    super(message);
    this.name = 'OfflineError';
  }
}

export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }

  const message =
    typeof error === 'string'
      ? error
      : (error as any)?.message || (error as any)?.toString?.() || '';

  if (typeof message !== 'string') {
    return false;
  }

  return (
    message.includes('Failed to fetch') ||
    message.includes('ERR_INTERNET_DISCONNECTED') ||
    message.includes('Network request failed') ||
    message.includes('Connection error')
  );
}

