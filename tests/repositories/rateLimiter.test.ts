import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UpstashRateLimiter, type RedisCounterClient } from "../../src/repositories/rateLimiter.js";

class FakeRedis implements RedisCounterClient {
  private readonly counts = new Map<string, number>();
  readonly expirations: Array<{ key: string; seconds: number }> = [];

  async incr(key: string): Promise<number> {
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return count;
  }

  async expire(key: string, seconds: number): Promise<void> {
    this.expirations.push({ key, seconds });
  }

  async set(): Promise<void> {
    return undefined;
  }

  async get<TData = unknown>(): Promise<TData | null> {
    return "ok" as TData;
  }
}

describe("UpstashRateLimiter", () => {
  it("sets an expiration only when creating a new counter", async () => {
    const redis = new FakeRedis();
    const limiter = new UpstashRateLimiter(redis);

    await limiter.enforce("agent:auto-pilot");
    await limiter.enforce("agent:auto-pilot");

    assert.deepEqual(redis.expirations, [
      { key: "rate-limit:actor:agent:auto-pilot", seconds: 60 }
    ]);
  });
});
