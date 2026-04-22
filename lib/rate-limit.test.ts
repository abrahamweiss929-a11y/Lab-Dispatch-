import { describe, it, expect } from "vitest";
import { TokenBucket } from "./rate-limit";

describe("TokenBucket", () => {
  it("consumes up to capacity then denies", () => {
    const bucket = new TokenBucket({ capacity: 3, refillPerMs: 0 });
    const t0 = 1_000_000;
    expect(bucket.tryConsume("k", t0)).toBe(true);
    expect(bucket.tryConsume("k", t0)).toBe(true);
    expect(bucket.tryConsume("k", t0)).toBe(true);
    expect(bucket.tryConsume("k", t0)).toBe(false);
  });

  it("refills over time when a clock advance is passed", () => {
    // 1 token per 1000ms.
    const bucket = new TokenBucket({ capacity: 2, refillPerMs: 1 / 1000 });
    const t0 = 1_000_000;
    expect(bucket.tryConsume("k", t0)).toBe(true);
    expect(bucket.tryConsume("k", t0)).toBe(true);
    expect(bucket.tryConsume("k", t0)).toBe(false);
    // After 1s, one token should have returned.
    expect(bucket.tryConsume("k", t0 + 1000)).toBe(true);
    expect(bucket.tryConsume("k", t0 + 1000)).toBe(false);
  });

  it("keeps independent buckets per key", () => {
    const bucket = new TokenBucket({ capacity: 1, refillPerMs: 0 });
    const t0 = 1_000_000;
    expect(bucket.tryConsume("a", t0)).toBe(true);
    expect(bucket.tryConsume("a", t0)).toBe(false);
    // key "b" has never been touched; should still have its full capacity.
    expect(bucket.tryConsume("b", t0)).toBe(true);
    expect(bucket.tryConsume("b", t0)).toBe(false);
  });

  it("reset() clears all per-key state", () => {
    const bucket = new TokenBucket({ capacity: 1, refillPerMs: 0 });
    const t0 = 1_000_000;
    expect(bucket.tryConsume("k", t0)).toBe(true);
    expect(bucket.tryConsume("k", t0)).toBe(false);
    bucket.reset();
    expect(bucket.tryConsume("k", t0)).toBe(true);
  });

  it("capacity 0 always denies", () => {
    const bucket = new TokenBucket({ capacity: 0, refillPerMs: 1 });
    expect(bucket.tryConsume("k", 1)).toBe(false);
    expect(bucket.tryConsume("k", 1_000_000)).toBe(false);
  });

  it("caps refill at capacity (cannot accumulate past max)", () => {
    const bucket = new TokenBucket({ capacity: 2, refillPerMs: 1 });
    const t0 = 1_000_000;
    // Far-future consume: bucket had no entry, so it starts at capacity.
    expect(bucket.tryConsume("k", t0)).toBe(true);
    expect(bucket.tryConsume("k", t0)).toBe(true);
    expect(bucket.tryConsume("k", t0)).toBe(false);
    // Wait a very long time; should re-saturate at capacity (2), not more.
    expect(bucket.tryConsume("k", t0 + 10_000_000)).toBe(true);
    expect(bucket.tryConsume("k", t0 + 10_000_000)).toBe(true);
    expect(bucket.tryConsume("k", t0 + 10_000_000)).toBe(false);
  });
});
