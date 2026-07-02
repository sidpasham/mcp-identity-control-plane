import { Redis } from "@upstash/redis";
import { config } from "../config/config.js";

export interface RateLimiter {
  enforce(actorId: string): Promise<void>;
}

export interface RedisCounterClient {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  set(key: string, value: string, options: { ex: number }): Promise<unknown>;
  get<TData = unknown>(key: string): Promise<TData | null>;
}

export class UpstashRateLimiter implements RateLimiter {
  private readonly redis: RedisCounterClient;

  constructor(redis?: RedisCounterClient) {
    this.redis = redis ?? new Redis({
      url: config.upstashRedisRestUrl,
      token: config.upstashRedisRestToken
    });
  }

  async enforce(actorId: string): Promise<void> {
    const key = `rate-limit:actor:${actorId}`;
    const count = await this.redis.incr(key);

    if (count === 1) {
      await this.redis.expire(key, config.rateLimitWindowSeconds);
    }

    if (count > config.rateLimitMaxRequests) {
      throw new Error(`Rate Limit Breached: Execution halted for '${actorId}'. Rogue AI tool-calling pattern detected.`);
    }
  }

  async ping(): Promise<void> {
    const key = "health:rate-limiter";
    await this.redis.set(key, "ok", { ex: 30 });
    const value = await this.redis.get<string>(key);
    if (value !== "ok") {
      throw new Error("Redis health check failed.");
    }
  }
}
