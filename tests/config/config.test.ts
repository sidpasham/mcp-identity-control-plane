import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultMcpAccessScopes } from "../../src/auth/scopes.js";
import { loadConfig } from "../../src/config/config.js";

describe("config loading", () => {
  it("parses typed defaults from a minimal environment", () => {
    const config = loadConfig(baseEnv());

    assert.equal(config.nodeEnv, "test");
    assert.equal(config.port, 3000);
    assert.equal(config.host, "0.0.0.0");
    assert.equal(config.logLevel, "info");
    assert.equal(config.mcpResourceServerUrl.href, "http://localhost:3000/mcp");
    assert.deepEqual(config.mcpAccessScopes, [...defaultMcpAccessScopes]);
    assert.equal(config.pgSsl, true);
    assert.equal(config.pgSslRejectUnauthorized, true);
  });

  it("derives the local MCP resource URL from a custom port", () => {
    const config = loadConfig({
      ...baseEnv(),
      PORT: "4111"
    });

    assert.equal(config.port, 4111);
    assert.equal(config.mcpResourceServerUrl.href, "http://localhost:4111/mcp");
  });

  it("deduplicates configured MCP access scopes", () => {
    const config = loadConfig({
      ...baseEnv(),
      MCP_ACCESS_SCOPES: "mcp:readonly,mcp:readonly mcp:readwrite"
    });

    assert.deepEqual(config.mcpAccessScopes, ["mcp:readonly", "mcp:readwrite"]);
  });

  it("rejects invalid port values", () => {
    assertConfigError({ PORT: "0" }, /PORT must be an integer between 1 and 65535/);
    assertConfigError({ PORT: "65536" }, /PORT must be an integer between 1 and 65535/);
    assertConfigError({ PORT: "3.14" }, /PORT must be an integer/);
  });

  it("rejects invalid numeric runtime limits", () => {
    assertConfigError({ PG_POOL_MAX: "0" }, /PG_POOL_MAX must be a positive integer/);
    assertConfigError({ RATE_LIMIT_MAX_REQUESTS: "-1" }, /RATE_LIMIT_MAX_REQUESTS must be a positive integer/);
    assertConfigError({ DEPENDENCY_RETRY_DELAY_MS: "-1" }, /DEPENDENCY_RETRY_DELAY_MS must be a non-negative integer/);
  });

  it("rejects empty required values", () => {
    assertConfigError({ OIDC_AUDIENCE: "   " }, /OIDC_AUDIENCE must not be empty/);
  });

  it("validates URL formats and protocols", () => {
    assertConfigError({ OIDC_JWKS_URI: "not-a-url" }, /OIDC_JWKS_URI must be a valid URL/);
    assertConfigError({ DATABASE_URL: "https://db.example.com/app" }, /DATABASE_URL must use one of these URL protocols/);
    assertConfigError({ UPSTASH_REDIS_REST_URL: "http://example.upstash.io" }, /UPSTASH_REDIS_REST_URL must use one of these URL protocols/);
  });

  it("rejects loose booleans and log levels", () => {
    assertConfigError({ PGSSL_REJECT_UNAUTHORIZED: "yes" }, /PGSSL_REJECT_UNAUTHORIZED must be either "true" or "false"/);
    assertConfigError({ LOG_LEVEL: "verbose" }, /LOG_LEVEL must be one of/);
  });

  it("allows only MCP transport access scopes in MCP_ACCESS_SCOPES", () => {
    assertConfigError({ MCP_ACCESS_SCOPES: "mcp:readwrite,policy:write" }, /unsupported MCP access scopes: policy:write/);
  });

  it("enforces production-only URL and PostgreSQL TLS requirements", () => {
    assertConfigError(
      { NODE_ENV: "production" },
      /Missing required environment variable: MCP_RESOURCE_SERVER_URL/
    );
    assertConfigError(
      { NODE_ENV: "production", MCP_RESOURCE_SERVER_URL: "http://identity.example.com/mcp" },
      /MCP_RESOURCE_SERVER_URL must use one of these URL protocols/
    );
    assertConfigError(
      {
        NODE_ENV: "production",
        MCP_RESOURCE_SERVER_URL: "https://identity.example.com/mcp",
        OIDC_ISSUER: "http://issuer.example.com/"
      },
      /OIDC_ISSUER must use one of these URL protocols/
    );
    assertConfigError(
      {
        NODE_ENV: "production",
        MCP_RESOURCE_SERVER_URL: "https://identity.example.com/mcp",
        OIDC_JWKS_URI: "http://issuer.example.com/.well-known/jwks.json"
      },
      /OIDC_JWKS_URI must use one of these URL protocols/
    );
    assertConfigError(
      { NODE_ENV: "production", MCP_RESOURCE_SERVER_URL: "https://identity.example.com/mcp", PGSSL: "disable" },
      /PGSSL must not disable PostgreSQL TLS/
    );
    assertConfigError(
      {
        NODE_ENV: "production",
        MCP_RESOURCE_SERVER_URL: "https://identity.example.com/mcp",
        PGSSL_REJECT_UNAUTHORIZED: "false"
      },
      /PGSSL_REJECT_UNAUTHORIZED must not be false/
    );
  });
});

function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    OIDC_ISSUER: "https://issuer.example.com/",
    OIDC_AUDIENCE: "https://identity-control-plane.example",
    OIDC_JWKS_URI: "https://issuer.example.com/.well-known/jwks.json",
    DATABASE_URL: "postgresql://user:password@db.example.com:5432/app?sslmode=verify-full",
    UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "redis-token"
  };
}

function assertConfigError(overrides: NodeJS.ProcessEnv, expectedMessage: RegExp): void {
  assert.throws(
    () => loadConfig({ ...baseEnv(), ...overrides }),
    expectedMessage
  );
}
