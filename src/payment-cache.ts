/**
 * Payment Parameter Cache
 *
 * Caches the 402 payment parameters (payTo, asset, network, etc.) after the first
 * request to each endpoint. On subsequent requests, pre-signs the payment and
 * attaches it to the first request, skipping the 402 round trip (~200ms savings).
 */

export type CachedPaymentParams = {
  payTo: string;
  asset: string;
  scheme: string;
  network: string;
  extra?: { name?: string; version?: string };
  maxTimeoutSeconds?: number;
  cachedAt: number;
};

const DEFAULT_TTL_MS = 3_600_000; // 1 hour

export class PaymentCache {
  private cache = new Map<string, CachedPaymentParams>();
  private ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Get cached payment params for an endpoint path. */
  get(endpointPath: string): CachedPaymentParams | undefined {
    const entry = this.cache.get(endpointPath);
    if (!entry) return undefined;
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(endpointPath);
      return undefined;
    }
    return entry;
  }

  /** Cache payment params from a 402 response. */
  set(endpointPath: string, params: Omit<CachedPaymentParams, "cachedAt">): void {
    this.cache.set(endpointPath, { ...params, cachedAt: Date.now() });
  }

  /** Invalidate cache for an endpoint (e.g., if payTo changed). */
  invalidate(endpointPath: string): void {
    this.cache.delete(endpointPath);
  }
}
