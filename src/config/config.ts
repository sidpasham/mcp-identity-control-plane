import "dotenv/config";
import { defaultMcpAccessScopes } from "../auth/scopes.js";

export type SessionStateMode = "sticky" | "external";
export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export interface AppConfig {
  serviceName: string;
  nodeEnv: string;
  port: number;
  host: string;
  logLevel: LogLevel;
  oidcIssuer: string;
  oidcAudience: string;
  oidcJwksUri: string;
  oidcJwksTimeoutMs: number;
  mcpResourceServerUrl: URL;
  mcpAccessScopes: string[];
  databaseUrl: string;
  pgPoolMax: number;
  pgIdleTimeoutMs: number;
  pgConnectionTimeoutMs: number;
  pgQueryTimeoutMs: number;
  pgSsl: boolean;
  pgSslRejectUnauthorized: boolean;
  upstashRedisRestUrl: string;
  upstashRedisRestToken: string;
  dependencyRetryAttempts: number;
  dependencyRetryDelayMs: number;
  dependencyTimeoutMs: number;
  redisOperationTimeoutMs: number;
  rateLimitWindowSeconds: number;
  rateLimitMaxRequests: number;
  sessionStateMode: SessionStateMode;
}

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
const MCP_ACCESS_SCOPES = new Set<string>(defaultMcpAccessScopes);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = stringEnv(env, "NODE_ENV", "development");
  const isProduction = nodeEnv === "production";
  const port = portEnv(env, "PORT", 3000);
  const dependencyTimeoutMs = positiveIntegerEnv(env, "DEPENDENCY_TIMEOUT_MS", 2000);
  const pgSsl = pgSslEnv(env, "PGSSL", true);
  const pgSslRejectUnauthorized = booleanEnv(env, "PGSSL_REJECT_UNAUTHORIZED", true);

  if (isProduction && !pgSsl) {
    throw new Error("Environment variable PGSSL must not disable PostgreSQL TLS when NODE_ENV=production.");
  }

  if (isProduction && !pgSslRejectUnauthorized) {
    throw new Error("Environment variable PGSSL_REJECT_UNAUTHORIZED must not be false when NODE_ENV=production.");
  }

  return {
    serviceName: "mcp-identity-control-plane",
    nodeEnv,
    port,
    host: stringEnv(env, "HOST", "0.0.0.0"),
    logLevel: logLevelEnv(env, "LOG_LEVEL", "info"),
    oidcIssuer: requiredUrlStringEnv(env, "OIDC_ISSUER", {
      allowedProtocols: isProduction ? ["https:"] : ["http:", "https:"],
      noHash: true,
      noSearch: true
    }),
    oidcAudience: requiredStringEnv(env, "OIDC_AUDIENCE"),
    oidcJwksUri: requiredUrlStringEnv(env, "OIDC_JWKS_URI", {
      allowedProtocols: isProduction ? ["https:"] : ["http:", "https:"],
      noHash: true
    }),
    oidcJwksTimeoutMs: positiveIntegerEnv(env, "OIDC_JWKS_TIMEOUT_MS", dependencyTimeoutMs),
    mcpResourceServerUrl: urlEnv(env, "MCP_RESOURCE_SERVER_URL", isProduction ? undefined : `http://localhost:${port}/mcp`, {
      allowedProtocols: isProduction ? ["https:"] : ["http:", "https:"],
      noHash: true
    }),
    mcpAccessScopes: mcpAccessScopeListEnv(env, "MCP_ACCESS_SCOPES", [...defaultMcpAccessScopes]),
    databaseUrl: requiredUrlStringEnv(env, "DATABASE_URL", {
      allowedProtocols: ["postgres:", "postgresql:"],
      noHash: true
    }),
    pgPoolMax: positiveIntegerEnv(env, "PG_POOL_MAX", 10),
    pgIdleTimeoutMs: positiveIntegerEnv(env, "PG_IDLE_TIMEOUT_MS", 30000),
    pgConnectionTimeoutMs: positiveIntegerEnv(env, "PG_CONNECTION_TIMEOUT_MS", 5000),
    pgQueryTimeoutMs: positiveIntegerEnv(env, "PG_QUERY_TIMEOUT_MS", dependencyTimeoutMs),
    pgSsl,
    pgSslRejectUnauthorized,
    upstashRedisRestUrl: requiredUrlStringEnv(env, "UPSTASH_REDIS_REST_URL", {
      allowedProtocols: ["https:"],
      noHash: true
    }),
    upstashRedisRestToken: requiredStringEnv(env, "UPSTASH_REDIS_REST_TOKEN"),
    dependencyRetryAttempts: positiveIntegerEnv(env, "DEPENDENCY_RETRY_ATTEMPTS", 2),
    dependencyRetryDelayMs: nonNegativeIntegerEnv(env, "DEPENDENCY_RETRY_DELAY_MS", 100),
    dependencyTimeoutMs,
    redisOperationTimeoutMs: positiveIntegerEnv(env, "REDIS_OPERATION_TIMEOUT_MS", dependencyTimeoutMs),
    rateLimitWindowSeconds: positiveIntegerEnv(env, "RATE_LIMIT_WINDOW_SECONDS", 60),
    rateLimitMaxRequests: positiveIntegerEnv(env, "RATE_LIMIT_MAX_REQUESTS", 50),
    sessionStateMode: sessionStateModeEnv(env, "SESSION_STATE_MODE", "sticky")
  };
}

export const config: AppConfig = loadConfig();

function rawEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Environment variable ${name} must not be empty.`);
  }

  return trimmed;
}

function requiredStringEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = rawEnv(env, name);
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }
  return value;
}

function stringEnv(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  return rawEnv(env, name) ?? fallback;
}

function integerEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = rawEnv(env, name);
  if (value === undefined) {
    return fallback;
  }

  if (!/^-?\d+$/.test(value)) {
    throw new Error(`Environment variable ${name} must be an integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Environment variable ${name} must be a safe integer.`);
  }

  return parsed;
}

function positiveIntegerEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const parsed = integerEnv(env, name, fallback);
  if (parsed < 1) {
    throw new Error(`Environment variable ${name} must be a positive integer.`);
  }
  return parsed;
}

function nonNegativeIntegerEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const parsed = integerEnv(env, name, fallback);
  if (parsed < 0) {
    throw new Error(`Environment variable ${name} must be a non-negative integer.`);
  }
  return parsed;
}

function portEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const parsed = integerEnv(env, name, fallback);
  if (parsed < 1 || parsed > 65535) {
    throw new Error(`Environment variable ${name} must be an integer between 1 and 65535.`);
  }
  return parsed;
}

function booleanEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = rawEnv(env, name);
  if (value === undefined) {
    return fallback;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`Environment variable ${name} must be either "true" or "false".`);
}

function pgSslEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = rawEnv(env, name);
  if (value === undefined) {
    return fallback;
  }

  if (value === "require" || value === "true") {
    return true;
  }

  if (value === "disable" || value === "false") {
    return false;
  }

  throw new Error(`Environment variable ${name} must be either "require" or "disable".`);
}

function logLevelEnv(env: NodeJS.ProcessEnv, name: string, fallback: LogLevel): LogLevel {
  const value = stringEnv(env, name, fallback);
  if (!LOG_LEVELS.includes(value as LogLevel)) {
    throw new Error(`Environment variable ${name} must be one of: ${LOG_LEVELS.join(", ")}.`);
  }
  return value as LogLevel;
}

function stringListEnv(env: NodeJS.ProcessEnv, name: string, fallback: string[]): string[] {
  const value = rawEnv(env, name);
  const values = value
    ? value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean)
    : fallback;

  if (values.length === 0) {
    throw new Error(`Environment variable ${name} must contain at least one value.`);
  }

  return [...new Set(values)];
}

function mcpAccessScopeListEnv(env: NodeJS.ProcessEnv, name: string, fallback: string[]): string[] {
  const values = stringListEnv(env, name, fallback);
  const unsupported = values.filter((scope) => !MCP_ACCESS_SCOPES.has(scope));

  if (unsupported.length > 0) {
    throw new Error(
      `Environment variable ${name} contains unsupported MCP access scopes: ${unsupported.join(", ")}. Supported values: ${[...MCP_ACCESS_SCOPES].join(", ")}.`
    );
  }

  return values;
}

interface UrlValidationOptions {
  allowedProtocols: string[];
  noHash?: boolean;
  noSearch?: boolean;
}

function requiredUrlStringEnv(env: NodeJS.ProcessEnv, name: string, options: UrlValidationOptions): string {
  const value = requiredStringEnv(env, name);
  validateUrl(name, value, options);
  return value;
}

function urlEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string | undefined,
  options: UrlValidationOptions
): URL {
  const value = rawEnv(env, name) ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }

  return validateUrl(name, value, options);
}

function validateUrl(name: string, value: string, options: UrlValidationOptions): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Environment variable ${name} must be a valid URL.`);
  }

  if (!options.allowedProtocols.includes(url.protocol)) {
    throw new Error(
      `Environment variable ${name} must use one of these URL protocols: ${options.allowedProtocols.join(", ")}.`
    );
  }

  if (options.noHash && url.hash) {
    throw new Error(`Environment variable ${name} must not include a URL fragment.`);
  }

  if (options.noSearch && url.search) {
    throw new Error(`Environment variable ${name} must not include a URL query string.`);
  }

  return url;
}

function sessionStateModeEnv(env: NodeJS.ProcessEnv, name: string, fallback: SessionStateMode): SessionStateMode {
  const value = stringEnv(env, name, fallback);
  if (value !== "sticky" && value !== "external") {
    throw new Error(`Environment variable ${name} must be either "sticky" or "external".`);
  }
  return value;
}
