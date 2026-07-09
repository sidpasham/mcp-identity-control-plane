import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import type { RequestHandler } from "express";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { assertSupportedSessionStateMode, closeMcpTransports, createApp, type AppRuntime } from "../../src/app.js";
import { McpScopes, PolicyScopes } from "../../src/auth/scopes.js";
import type { RateLimiter } from "../../src/repositories/rateLimiter.js";
import type { TenantPolicyRepository } from "../../src/repositories/tenantPolicyRepository.js";
import type { SecurityPolicy } from "../../src/types/types.js";

const mcpJsonHeaders = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream"
};

const allowMcpAuth: RequestHandler = (req, _res, next) => {
  req.auth = {
    token: "test-token",
    clientId: "test-client",
    scopes: [McpScopes.readwrite, PolicyScopes.write],
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    extra: {
      identity: {
        sub: "agent:test",
        iss: "https://issuer.example/",
        aud: "https://identity-control-plane.example",
        scopes: [McpScopes.readwrite, PolicyScopes.write],
        tenant_id: "company_alpha"
      }
    }
  };
  next();
};

describe("HTTP MCP app dependency handling", () => {
  it("rejects external session state until shared MCP transport coordination exists", () => {
    assert.throws(
      () => assertSupportedSessionStateMode("external"),
      /SESSION_STATE_MODE=external is not implemented/
    );
  });

  it("removes MCP sessions even when transport close fails", async () => {
    let closeCalls = 0;
    const transport = {
      close: async () => {
        closeCalls += 1;
        throw new Error("close failed");
      }
    } as unknown as StreamableHTTPServerTransport;
    const transports = new Map<string, StreamableHTTPServerTransport>([["session-1", transport]]);

    await closeMcpTransports(transports);

    assert.equal(closeCalls, 1);
    assert.equal(transports.size, 0);
  });

  it("defaults readiness dependencies to error until checks succeed", async () => {
    const runtime = createApp({
      tenantPolicyRepository: new FailingTenantPolicyRepository("Postgres unavailable"),
      rateLimiter: new FailingRateLimiter("Redis unavailable"),
      mcpAccessMiddleware: [allowMcpAuth]
    });

    await withTestServer(runtime, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/readyz`);
      const body = await response.json() as ReadinessResponse;

      assert.equal(response.status, 503);
      assert.equal(body.status, "not_ready");
      assert.deepEqual(body.checks, {
        postgres: "error",
        redis: "error"
      });
    });
  });

  it("returns a bearer challenge when /mcp auth is missing", async () => {
    const runtime = createApp({
      tenantPolicyRepository: new HealthyTenantPolicyRepository(),
      rateLimiter: new HealthyRateLimiter()
    });

    await withTestServer(runtime, async (baseUrl) => {
      const response = await postMcp(baseUrl, initializeRequest(), undefined, false);
      const body = await response.json() as ErrorResponse;

      assert.equal(response.status, 401);
      assert.equal(body.error, "invalid_token");
      assert.match(response.headers.get("www-authenticate") ?? "", /Bearer/);
    });
  });

  it("returns a JSON-RPC parse error for malformed MCP JSON", async () => {
    const runtime = createApp({
      tenantPolicyRepository: new HealthyTenantPolicyRepository(),
      rateLimiter: new HealthyRateLimiter(),
      mcpAccessMiddleware: [allowMcpAuth]
    });

    await withTestServer(runtime, async (baseUrl) => {
      const response = await postRawMcp(baseUrl, "{");
      const body = await response.json() as JsonRpcErrorResponse;

      assert.equal(response.status, 400);
      assert.match(response.headers.get("content-type") ?? "", /application\/json/);
      assert.equal(body.jsonrpc, "2.0");
      assert.equal(body.error.code, -32700);
      assert.equal(body.id, null);
    });
  });

  it("returns a clean MCP tool error when Redis rate limiting is unavailable", async () => {
    const runtime = createApp({
      tenantPolicyRepository: new HealthyTenantPolicyRepository(),
      rateLimiter: new FailingRateLimiter("Redis unavailable"),
      mcpAccessMiddleware: [allowMcpAuth]
    });

    await withTestServer(runtime, async (baseUrl) => {
      const sessionId = await initializeMcpSession(baseUrl);
      const response = await postMcp(baseUrl, patchTenantPolicyRequest(), sessionId);
      const body = await readMcpResponse(response);

      assert.equal(response.status, 200);
      assert.equal(body.result?.isError, true);
      assert.match(body.result?.content[0]?.text ?? "", /Redis unavailable/);
    });
  });

  it("forbids tenant mismatches before rate limiting or writes", async () => {
    const tenantPolicyRepository = new RecordingTenantPolicyRepository();
    const runtime = createApp({
      tenantPolicyRepository,
      rateLimiter: new FailingRateLimiter("Redis unavailable"),
      mcpAccessMiddleware: [allowMcpAuth]
    });

    await withTestServer(runtime, async (baseUrl) => {
      const sessionId = await initializeMcpSession(baseUrl);
      const response = await postMcp(baseUrl, patchTenantPolicyRequest("tenant:company_beta"), sessionId);
      const body = await readMcpResponse(response);

      assert.equal(response.status, 200);
      assert.equal(body.result?.isError, true);
      assert.match(body.result?.content[0]?.text ?? "", /tenant claim does not match/);
      assert.equal(tenantPolicyRepository.patchCalls, 0);
    });
  });

  it("rejects malformed target tenant identifiers before writes", async () => {
    const tenantPolicyRepository = new RecordingTenantPolicyRepository();
    const runtime = createApp({
      tenantPolicyRepository,
      rateLimiter: new HealthyRateLimiter(),
      mcpAccessMiddleware: [allowMcpAuth]
    });

    await withTestServer(runtime, async (baseUrl) => {
      const sessionId = await initializeMcpSession(baseUrl);
      const response = await postMcp(baseUrl, patchTenantPolicyRequest("../company_alpha"), sessionId);
      const body = await readMcpResponse(response);

      assert.equal(response.status, 200);
      assert.match(JSON.stringify(body), /targetTenant/);
      assert.equal(tenantPolicyRepository.patchCalls, 0);
    });
  });

  it("returns a clean MCP tool error when Postgres policy writes are unavailable", async () => {
    const runtime = createApp({
      tenantPolicyRepository: new FailingTenantPolicyRepository("Postgres unavailable"),
      rateLimiter: new HealthyRateLimiter(),
      mcpAccessMiddleware: [allowMcpAuth]
    });

    await withTestServer(runtime, async (baseUrl) => {
      const sessionId = await initializeMcpSession(baseUrl);
      const response = await postMcp(baseUrl, patchTenantPolicyRequest(), sessionId);
      const body = await readMcpResponse(response);

      assert.equal(response.status, 200);
      assert.equal(body.result?.isError, true);
      assert.match(body.result?.content[0]?.text ?? "", /Postgres unavailable/);
    });
  });
});

async function withTestServer(runtime: AppRuntime, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn(baseUrl);
  } finally {
    await runtime.closeMcpTransports();
    await closeServer(server);
  }
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function initializeMcpSession(baseUrl: string): Promise<string> {
  const response = await postMcp(baseUrl, initializeRequest());
  assert.equal(response.status, 200, await response.text());

  const sessionId = response.headers.get("mcp-session-id");
  assert.ok(sessionId);

  const initializedResponse = await postMcp(baseUrl, initializedNotification(), sessionId);
  assert.ok([200, 202].includes(initializedResponse.status), await initializedResponse.text());

  return sessionId;
}

async function postMcp(baseUrl: string, body: unknown, sessionId?: string, authenticated = true): Promise<Response> {
  const headers = new Headers(mcpJsonHeaders);
  if (authenticated) {
    headers.set("Authorization", "Bearer test-token");
  }

  if (sessionId) {
    headers.set("mcp-session-id", sessionId);
  }

  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

async function postRawMcp(baseUrl: string, body: string, sessionId?: string): Promise<Response> {
  const headers = new Headers(mcpJsonHeaders);
  headers.set("Authorization", "Bearer test-token");

  if (sessionId) {
    headers.set("mcp-session-id", sessionId);
  }

  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers,
    body
  });
}

async function readMcpResponse(response: Response): Promise<ToolCallResponse> {
  const text = await response.text();

  if (!text.startsWith("event:")) {
    return JSON.parse(text) as ToolCallResponse;
  }

  const dataLines = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());

  assert.ok(dataLines.length > 0, text);
  return JSON.parse(dataLines.join("\n")) as ToolCallResponse;
}

function initializeRequest() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "node-test",
        version: "1.0.0"
      }
    }
  };
}

function initializedNotification() {
  return {
    jsonrpc: "2.0",
    method: "notifications/initialized"
  };
}

function patchTenantPolicyRequest(targetTenant = "tenant:company_alpha") {
  return {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "patch_tenant_security_policy",
      arguments: {
        targetTenant,
        settings: {
          botDetectionEnabled: true,
          suspiciousIpThrottling: true
        }
      }
    }
  };
}

class HealthyRateLimiter implements RateLimiter {
  async enforce(): Promise<void> {
    return undefined;
  }

  async ping(): Promise<void> {
    return undefined;
  }
}

class FailingRateLimiter extends HealthyRateLimiter {
  constructor(private readonly message: string) {
    super();
  }

  override async enforce(): Promise<void> {
    throw new Error(this.message);
  }

  override async ping(): Promise<void> {
    throw new Error(this.message);
  }
}

class HealthyTenantPolicyRepository implements TenantPolicyRepository {
  async ping(): Promise<void> {
    return undefined;
  }

  async patchPolicy(
    _tenantId: string,
    _settings: Partial<SecurityPolicy>,
    _actorSub: string
  ): Promise<SecurityPolicy> {
    return {
      botDetectionEnabled: true,
      suspiciousIpThrottling: true,
      rateLimitThreshold: 100
    };
  }
}

class RecordingTenantPolicyRepository extends HealthyTenantPolicyRepository {
  patchCalls = 0;

  override async patchPolicy(
    tenantId: string,
    settings: Partial<SecurityPolicy>,
    actorSub: string
  ): Promise<SecurityPolicy> {
    this.patchCalls += 1;
    return super.patchPolicy(tenantId, settings, actorSub);
  }
}

class FailingTenantPolicyRepository extends HealthyTenantPolicyRepository {
  constructor(private readonly message: string) {
    super();
  }

  override async ping(): Promise<void> {
    throw new Error(this.message);
  }

  override async patchPolicy(
    _tenantId: string,
    _settings: Partial<SecurityPolicy>,
    _actorSub: string
  ): Promise<SecurityPolicy> {
    throw new Error(this.message);
  }
}

interface ReadinessResponse {
  status: string;
  checks: Record<string, "ok" | "error">;
}

interface ErrorResponse {
  error: string;
}

interface JsonRpcErrorResponse {
  jsonrpc: string;
  error: {
    code: number;
    message: string;
  };
  id: null;
}

interface ToolCallResponse {
  result?: {
    isError?: boolean;
    content: Array<{
      text?: string;
    }>;
  };
}
