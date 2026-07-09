import { Redis } from "@upstash/redis";
import { config } from "../config/config.js";
import { DependencyUnavailableError, retryDependency } from "../reliability/dependencies.js";

export interface RateLimiter {
  enforce(actorId: string): Promise<void>;
  ping(): Promise<void>;
}

export interface RedisCounterClient {
  eval<TArgs extends unknown[], TData = unknown>(script: string, keys: string[], args: TArgs): Promise<TData>;
  set(key: string, value: string, options: { ex: number }): Promise<unknown>;
  get<TData = unknown>(key: string): Promise<TData | null>;
}

export interface UpstashRateLimiterOptions {
  retryAttempts?: number;
  retryDelayMs?: number;
  operationTimeoutMs?: number;
}

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

export class UpstashRateLimiter implements RateLimiter {
  private readonly redis: RedisCounterClient;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;
  private readonly operationTimeoutMs: number;

  constructor(redis?: RedisCounterClient, options: UpstashRateLimiterOptions = {}) {
    this.redis = redis ?? new Redis({
      url: config.upstashRedisRestUrl,
      token: config.upstashRedisRestToken
    });
    this.retryAttempts = options.retryAttempts ?? config.dependencyRetryAttempts;
    this.retryDelayMs = options.retryDelayMs ?? config.dependencyRetryDelayMs;
    this.operationTimeoutMs = options.operationTimeoutMs ?? config.redisOperationTimeoutMs;
  }

  async enforce(actorId: string): Promise<void> {
    const key = `rate-limit:actor:${actorId}`;
    const count = await retryDependency(
      () => this.redis.eval<[number], number>(RATE_LIMIT_SCRIPT, [key], [config.rateLimitWindowSeconds]),
      this.retryOptions("Redis rate limit enforcement")
    );

    if (!Number.isFinite(count)) {
      throw new DependencyUnavailableError("Redis rate limit enforcement returned an invalid counter value.");
    }

    if (count > config.rateLimitMaxRequests) {
      throw new Error(`Rate Limit Breached: Execution halted for '${actorId}'. Rogue AI tool-calling pattern detected.`);
    }
  }

  async ping(): Promise<void> {
    const key = "health:rate-limiter";
    await retryDependency(
      async () => {
        await this.redis.set(key, "ok", { ex: 30 });
        const value = await this.redis.get<string>(key);
        if (value !== "ok") {
          throw new Error("Redis health check failed.");
        }
      },
      this.retryOptions("Redis health check")
    );
  }

  private retryOptions(operationName: string) {
    return {
      attempts: this.retryAttempts,
      delayMs: this.retryDelayMs,
      timeoutMs: this.operationTimeoutMs,
      operationName
    };
  }
}
