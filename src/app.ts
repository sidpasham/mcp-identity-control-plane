import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config, type SessionStateMode } from "./config/config.js";
import { logger } from "./logging/logger.js";
import { requireAnyMcpAccessScope, requireMcpBearerAuth } from "./auth/mcpAccess.js";
import { mcpProtectedResourceMetadataRouter } from "./auth/protectedResourceMetadata.js";
import { UpstashRateLimiter, type RateLimiter } from "./repositories/rateLimiter.js";
import { PostgresTenantPolicyRepository, type TenantPolicyRepository } from "./repositories/tenantPolicyRepository.js";
import { registerIdentityTools } from "./tools/identity/index.js";

export interface AppRuntime {
  app: express.Express;
  transports: Map<string, StreamableHTTPServerTransport>;
  closeMcpTransports(): Promise<void>;
}

export interface CreateAppOptions {
  tenantPolicyRepository?: TenantPolicyRepository;
  rateLimiter?: RateLimiter;
  mcpAccessMiddleware?: RequestHandler[];
  transports?: Map<string, StreamableHTTPServerTransport>;
}

interface McpRouterOptions {
  tenantPolicyRepository: TenantPolicyRepository;
  rateLimiter: RateLimiter;
  mcpAccessMiddleware: RequestHandler[];
  transports: Map<string, StreamableHTTPServerTransport>;
}

export function createApp(options: CreateAppOptions = {}): AppRuntime {
  const tenantPolicyRepository = options.tenantPolicyRepository ?? new PostgresTenantPolicyRepository();
  const rateLimiter = options.rateLimiter ?? new UpstashRateLimiter();
  const transports = options.transports ?? new Map<string, StreamableHTTPServerTransport>();
  const mcpAccessMiddleware = options.mcpAccessMiddleware ?? [
    requireMcpBearerAuth,
    requireAnyMcpAccessScope()
  ];

  const app = express();
  app.disable("x-powered-by");
  // Hides the default Express response header so responses do not disclose the framework.
  app.set("trust proxy", true);
  // Trusts proxy-provided forwarding headers so Express can derive client IP and HTTPS state correctly.

  // Generates the x-request-id for every request if it's not present.
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
      postgres: "error",
      redis: "error"
    };

    try {
      await tenantPolicyRepository.ping();
      checks.postgres = "ok";
    } catch (error) {
      logger.error({ err: error }, "Postgres readiness check failed");
    }

    try {
      await rateLimiter.ping();
      checks.redis = "ok";
    } catch (error) {
      logger.error({ err: error }, "Redis readiness check failed");
    }

    const ready = Object.values(checks).every((value) => value === "ok");
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      service: config.serviceName,
      checks
    });
  });

  app.use("/mcp", createMcpRouter({
    tenantPolicyRepository,
    rateLimiter,
    mcpAccessMiddleware,
    transports
  }));

  app.use(handleJsonParseError);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return {
    app,
    transports,
    closeMcpTransports: () => closeMcpTransports(transports)
  };
}

export function assertSupportedSessionStateMode(sessionStateMode: SessionStateMode): void {
  if (sessionStateMode === "external") {
    throw new Error(
      "SESSION_STATE_MODE=external is not implemented for this MCP transport. Use SESSION_STATE_MODE=sticky with load-balancer session affinity, or implement shared MCP transport coordination before enabling external mode."
    );
  }
}

export async function closeMcpTransports(transports: Map<string, StreamableHTTPServerTransport>): Promise<void> {
  for (const [sessionId, transport] of Array.from(transports)) {
    try {
      await transport.close();
    } catch (error) {
      logger.warn({ sessionId, err: error }, "Failed to close MCP transport");
    } finally {
      transports.delete(sessionId);
    }
  }
}

function createMcpRouter(options: McpRouterOptions): express.Router {
  const router = express.Router();

  // Keep auth inside the MCP router so every MCP route runs through it before its handler.
  router.use(...options.mcpAccessMiddleware);

  router.get("/", async (req, res) => {
    const transport = findExistingTransport(req, res, options.transports);
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

  router.post("/", express.json({ limit: "1mb" }), async (req, res) => {
    const sessionId = getSessionId(req);
    const startedAt = Date.now();

    try {
      let transport = sessionId ? options.transports.get(sessionId) : undefined;

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

        transport = createSessionTransport(options.transports);
        const server = createMcpServer(options);
        await server.connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
      logHandledRequest(req, res, startedAt);
    } catch (error) {
      logRequestError(req, res, error);
    }
  });

  router.delete("/", async (req, res) => {
    const transport = findExistingTransport(req, res, options.transports);
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

  return router;
}

function createMcpServer(options: McpRouterOptions): McpServer {
  const server = new McpServer({
    name: config.serviceName,
    version: "1.0.0"
  });

  registerIdentityTools(server, {
    tenantPolicyRepository: options.tenantPolicyRepository,
    rateLimiter: options.rateLimiter
  });
  return server;
}

function createSessionTransport(transports: Map<string, StreamableHTTPServerTransport>): StreamableHTTPServerTransport {
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

function findExistingTransport(
  req: Request,
  res: Response,
  transports: Map<string, StreamableHTTPServerTransport>
): StreamableHTTPServerTransport | undefined {
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

function handleJsonParseError(error: unknown, req: Request, res: Response, next: NextFunction): void {
  if (!isJsonParseError(error)) {
    next(error);
    return;
  }

  logger.warn(
    {
      requestId: res.locals.requestId,
      method: req.method,
      path: req.path,
      err: error
    },
    "Failed to parse JSON request body"
  );

  if (req.path === "/mcp" || req.originalUrl.startsWith("/mcp")) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32700,
        message: "Parse error: invalid JSON request body"
      },
      id: null
    });
    return;
  }

  res.status(400).json({
    error: "invalid_json",
    error_description: "Invalid JSON request body"
  });
}

function isJsonParseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { status?: unknown; statusCode?: unknown; type?: unknown };
  return (
    candidate.type === "entity.parse.failed" ||
    (error instanceof SyntaxError && (candidate.status === 400 || candidate.statusCode === 400))
  );
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
