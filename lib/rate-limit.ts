/**
 * Per-key token-bucket rate limiter.
 *
 * In-memory and per-process: resets on server restart, does not span
 * multiple Node instances. Good enough for v1 abuse-mitigation on the
 * public pickup form. Swap for a Redis/edge-KV backing before scaling
 * horizontally.
 *
 * Tests pass a deterministic `now` so behavior is reproducible without
 * wall-clock waits.
 */

export interface TokenBucketOptions {
  /** Max tokens per key. */
  capacity: number;
  /** Tokens added per millisecond (fractional ok). */
  refillPerMs: number;
}

interface BucketState {
  tokens: number;
  updatedAt: number;
}

export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly state: Map<string, BucketState> = new Map();

  constructor(opts: TokenBucketOptions) {
    this.capacity = opts.capacity;
    this.refillPerMs = opts.refillPerMs;
  }

  /** Returns true if a token was consumed; false if the bucket was empty. */
  tryConsume(key: string, now: number = Date.now()): boolean {
    if (this.capacity <= 0) return false;
    const existing = this.state.get(key);
    let tokens: number;
    if (existing === undefined) {
      tokens = this.capacity;
    } else {
      const elapsed = Math.max(0, now - existing.updatedAt);
      tokens = Math.min(
        this.capacity,
        existing.tokens + elapsed * this.refillPerMs,
      );
    }
    if (tokens >= 1) {
      this.state.set(key, { tokens: tokens - 1, updatedAt: now });
      return true;
    }
    this.state.set(key, { tokens, updatedAt: now });
    return false;
  }

  /** Test helper. */
  reset(): void {
    this.state.clear();
  }
}

/**
 * Module-scope singleton for the public `/pickup/[slugToken]` form.
 * 10 requests per 5 minutes per slugToken.
 */
export const pickupFormBucket = new TokenBucket({
  capacity: 10,
  refillPerMs: 10 / (5 * 60 * 1000),
});
