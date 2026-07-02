import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config/config.js";
import { logger } from "./logging/logger.js";
import { requireAnyMcpAccessScope, requireMcpBearerAuth } from "./auth/mcpAccess.js";
import { mcpProtectedResourceMetadataRouter } from "./auth/protectedResourceMetadata.js";
import { SecurityEngine } from "./auth/security.js";
import { PostgresTenantPolicyRepository } from "./repositories/tenantPolicyRepository.js";

const { registerIdentityTools } = await import("./tools/identity/index.js");

const transports = new Map<string, StreamableHTTPServerTransport>();
const tenantPolicyRepository = new PostgresTenantPolicyRepository();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

app.use((req, res, next) => {
  const requestId = req.header("x-request-id") ?? randomUUID();
  res.setHeader("x-request-id", requestId);
  res.locals.requestId = requestId;
  next();
});

app.use(mcpProtectedResourceMetadataRouter());

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok", service: config.serviceName });
});

app.get("/readyz", async (_req, res) => {
  const checks: Record<string, "ok" | "error"> = {
    postgres: "ok",
    redis: "ok"
  };

  try {
    await tenantPolicyRepository.ping();
  } catch (error) {
    checks.postgres = "error";
    logger.error({ err: error }, "Postgres readiness check failed");
  }

  try {
    await SecurityEngine.checkRateLimiter();
  } catch (error) {
    checks.redis = "error";
    logger.error({ err: error }, "Redis readiness check failed");
  }

  const ready = Object.values(checks).every((value) => value === "ok");
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    service: config.serviceName,
    checks
  });
});

app.use("/mcp", requireMcpBearerAuth, requireAnyMcpAccessScope());

app.get("/mcp", async (req, res) => {
  const transport = findExistingTransport(req, res);
  if (!transport) {
    return;
  }

  const startedAt = Date.now();
  try {
    await transport.handleRequest(req, res);
    logHandledRequest(req, res, startedAt);
  } catch (error) {
    logRequestError(req, res, error);
  }
});

app.post("/mcp", express.json({ limit: "1mb" }), async (req, res) => {
  const sessionId = getSessionId(req);
  const startedAt = Date.now();

  try {
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (sessionId || !isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: missing or invalid MCP session"
          },
          id: null
        });
        return;
      }

      transport = createSessionTransport();
      const server = createMcpServer();
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
    logHandledRequest(req, res, startedAt);
  } catch (error) {
    logRequestError(req, res, error);
  }
});

app.delete("/mcp", async (req, res) => {
  const transport = findExistingTransport(req, res);
  if (!transport) {
    return;
  }

  const startedAt = Date.now();
  try {
    await transport.handleRequest(req, res);
    logHandledRequest(req, res, startedAt);
  } catch (error) {
    logRequestError(req, res, error);
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

const httpServer = app.listen(config.port, config.host, () => {
  if (config.sessionStateMode === "sticky") {
    logger.warn("MCP session state is process-local; use sticky sessions when running multiple replicas");
  }

  logger.info({ host: config.host, port: config.port, endpoint: "/mcp" }, "MCP Streamable HTTP server listening");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    logger.info({ signal }, "Received shutdown signal");

    for (const [sessionId, transport] of transports) {
      try {
        await transport.close();
      } catch (error) {
        logger.warn({ sessionId, err: error }, "Failed to close MCP transport");
      }
    }

    httpServer.close((error) => {
      if (error) {
        logger.error({ err: error }, "HTTP server shutdown failed");
        process.exit(1);
      }

      logger.info("HTTP server shutdown complete");
      process.exit(0);
    });
  });
}

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: config.serviceName,
    version: "1.0.0"
  });

  registerIdentityTools(server);
  return server;
}

function createSessionTransport(): StreamableHTTPServerTransport {
  let transport: StreamableHTTPServerTransport;

  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      transports.set(sessionId, transport);
      logger.info({ sessionId }, "MCP session initialized");
    }
  });

  transport.onclose = () => {
    const sessionId = transport.sessionId;
    if (sessionId) {
      transports.delete(sessionId);
      logger.info({ sessionId }, "MCP session closed");
    }
  };

  return transport;
}

function findExistingTransport(req: Request, res: Response): StreamableHTTPServerTransport | undefined {
  const sessionId = getSessionId(req);
  const transport = sessionId ? transports.get(sessionId) : undefined;

  if (!sessionId || !transport) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: missing or invalid MCP session"
      },
      id: null
    });
    return undefined;
  }

  return transport;
}

function getSessionId(req: Request): string | undefined {
  const header = req.header("mcp-session-id");
  return header?.trim() || undefined;
}

function logHandledRequest(req: Request, res: Response, startedAt: number): void {
  logger.info(
    {
      requestId: res.locals.requestId,
      method: req.method,
      path: req.path,
      sessionId: getSessionId(req),
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    },
    "Handled MCP request"
  );
}

function logRequestError(req: Request, res: Response, error: unknown): void {
  logger.error(
    {
      requestId: res.locals.requestId,
      method: req.method,
      path: req.path,
      sessionId: getSessionId(req),
      err: error
    },
    "Failed to handle MCP request"
  );

  if (!res.headersSent) {
    res.status(500).json({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Internal server error"
      },
      id: null
    });
    return;
  }

  res.end();
}
