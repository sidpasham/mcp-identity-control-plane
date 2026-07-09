import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UpstashRateLimiter, type RedisCounterClient } from "../../src/repositories/rateLimiter.js";

class FakeRedis implements RedisCounterClient {
  private readonly counts = new Map<string, number>();
  readonly expirations: Array<{ key: string; seconds: number }> = [];
  evalAttempts = 0;

  async eval<TArgs extends unknown[], TData = unknown>(_script: string, keys: string[], args: TArgs): Promise<TData> {
    this.evalAttempts += 1;
    return this.applyEval(keys, args);
  }

  protected applyEval<TArgs extends unknown[], TData = unknown>(keys: string[], args: TArgs): TData {
    const key = keys[0];
    const seconds = Number(args[0]);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);

    if (count === 1) {
      this.expirations.push({ key, seconds });
    }

    return count as TData;
  }

  async set(): Promise<void> {
    return undefined;
  }

  async get<TData = unknown>(): Promise<TData | null> {
    return "ok" as TData;
  }
}

class FlakyRedis extends FakeRedis {
  private remainingFailures: number;

  constructor(failures: number) {
    super();
    this.remainingFailures = failures;
  }

  override async eval<TArgs extends unknown[], TData = unknown>(
    script: string,
    keys: string[],
    args: TArgs
  ): Promise<TData> {
    this.evalAttempts += 1;

    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw new Error("Redis unavailable");
    }

    return this.applyEval(keys, args);
  }
}

describe("UpstashRateLimiter", () => {
  it("sets an expiration only when creating a new counter through the atomic script", async () => {
    const redis = new FakeRedis();
    const limiter = new UpstashRateLimiter(redis);

    await limiter.enforce("agent:auto-pilot");
    await limiter.enforce("agent:auto-pilot");

    assert.deepEqual(redis.expirations, [
      { key: "rate-limit:actor:agent:auto-pilot", seconds: 60 }
    ]);
  });

  it("retries transient Redis failures", async () => {
    const redis = new FlakyRedis(1);
    const limiter = new UpstashRateLimiter(redis, {
      retryAttempts: 2,
      retryDelayMs: 0,
      operationTimeoutMs: 100
    });

    await limiter.enforce("agent:auto-pilot");

    assert.equal(redis.evalAttempts, 2);
  });

  it("fails closed when Redis remains unavailable", async () => {
    const redis = new FlakyRedis(2);
    const limiter = new UpstashRateLimiter(redis, {
      retryAttempts: 2,
      retryDelayMs: 0,
      operationTimeoutMs: 100
    });

    await assert.rejects(
      () => limiter.enforce("agent:auto-pilot"),
      /Redis rate limit enforcement failed after 2 attempt/
    );
  });
});
