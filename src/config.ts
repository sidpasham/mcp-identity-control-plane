import "dotenv/config";

export type SessionStateMode = "sticky" | "external";

export interface AppConfig {
  serviceName: string;
  port: number;
  host: string;
  logLevel: string;
  oidcIssuer: string;
  oidcAudience: string;
  oidcJwksUri: string;
  databaseUrl: string;
  pgPoolMax: number;
  pgIdleTimeoutMs: number;
  pgConnectionTimeoutMs: number;
  pgSsl: boolean;
  pgSslRejectUnauthorized: boolean;
  upstashRedisRestUrl: string;
  upstashRedisRestToken: string;
  rateLimitWindowSeconds: number;
  rateLimitMaxRequests: number;
  sessionStateMode: SessionStateMode;
}

export const config: AppConfig = {
  serviceName: "mcp-identity-control-plane",
  port: numberEnv("PORT", 3000),
  host: process.env.HOST ?? "0.0.0.0",
  logLevel: process.env.LOG_LEVEL ?? "info",
  oidcIssuer: requiredEnv("OIDC_ISSUER"),
  oidcAudience: requiredEnv("OIDC_AUDIENCE"),
  oidcJwksUri: requiredEnv("OIDC_JWKS_URI"),
  databaseUrl: requiredEnv("DATABASE_URL"),
  pgPoolMax: numberEnv("PG_POOL_MAX", 10),
  pgIdleTimeoutMs: numberEnv("PG_IDLE_TIMEOUT_MS", 30000),
  pgConnectionTimeoutMs: numberEnv("PG_CONNECTION_TIMEOUT_MS", 5000),
  pgSsl: process.env.PGSSL !== "disable",
  pgSslRejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED !== "false",
  upstashRedisRestUrl: requiredEnv("UPSTASH_REDIS_REST_URL"),
  upstashRedisRestToken: requiredEnv("UPSTASH_REDIS_REST_TOKEN"),
  rateLimitWindowSeconds: numberEnv("RATE_LIMIT_WINDOW_SECONDS", 60),
  rateLimitMaxRequests: numberEnv("RATE_LIMIT_MAX_REQUESTS", 50),
  sessionStateMode: sessionStateModeEnv("SESSION_STATE_MODE", "sticky")
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a finite number.`);
  }

  return parsed;
}

function sessionStateModeEnv(name: string, fallback: SessionStateMode): SessionStateMode {
  const value = process.env[name] ?? fallback;
  if (value !== "sticky" && value !== "external") {
    throw new Error(`Environment variable ${name} must be either "sticky" or "external".`);
  }
  return value;
}
