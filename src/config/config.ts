import "dotenv/config";
import { defaultMcpAccessScopes } from "../auth/scopes.js";

export type SessionStateMode = "sticky" | "external";

export interface AppConfig {
  serviceName: string;
  port: number;
  host: string;
  logLevel: string;
  oidcIssuer: string;
  oidcAudience: string;
  oidcJwksUri: string;
  mcpResourceServerUrl: URL;
  mcpAccessScopes: string[];
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

const port = numberEnv("PORT", 3000);

export const config: AppConfig = {
  serviceName: "mcp-identity-control-plane",
  port,
  host: process.env.HOST ?? "0.0.0.0",
  logLevel: process.env.LOG_LEVEL ?? "info",
  oidcIssuer: requiredEnv("OIDC_ISSUER"),
  oidcAudience: requiredEnv("OIDC_AUDIENCE"),
  oidcJwksUri: requiredEnv("OIDC_JWKS_URI"),
  mcpResourceServerUrl: urlEnv("MCP_RESOURCE_SERVER_URL", `http://localhost:${port}/mcp`),
  mcpAccessScopes: stringListEnv("MCP_ACCESS_SCOPES", [...defaultMcpAccessScopes]),
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

function stringListEnv(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  const values = value
    ? value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean)
    : fallback;

  if (values.length === 0) {
    throw new Error(`Environment variable ${name} must contain at least one value.`);
  }

  return values;
}

function urlEnv(name: string, fallback: string): URL {
  const value = process.env[name] ?? fallback;
  const url = new URL(value);

  if (url.hash) {
    throw new Error(`Environment variable ${name} must not include a URL fragment.`);
  }

  return url;
}

function sessionStateModeEnv(name: string, fallback: SessionStateMode): SessionStateMode {
  const value = process.env[name] ?? fallback;
  if (value !== "sticky" && value !== "external") {
    throw new Error(`Environment variable ${name} must be either "sticky" or "external".`);
  }
  return value;
}
