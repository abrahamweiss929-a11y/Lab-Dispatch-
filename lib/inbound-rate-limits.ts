import { TokenBucket } from "@/lib/rate-limit";

/**
 * Module-scope singletons for webhook-layer rate limiting. Keyed by the
 * normalized sender identifier (`from`). 30 requests per minute per key
 * on each channel — well above realistic human traffic, tight enough to
 * cut accidental retry storms from a misconfigured upstream.
 */
export const smsInboundBucket = new TokenBucket({
  capacity: 30,
  refillPerMs: 30 / 60_000,
});

export const emailInboundBucket = new TokenBucket({
  capacity: 30,
  refillPerMs: 30 / 60_000,
});
