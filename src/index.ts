import { createApp, assertSupportedSessionStateMode } from "./app.js";
import { config } from "./config/config.js";
import { logger } from "./logging/logger.js";

assertSupportedSessionStateMode(config.sessionStateMode);

const runtime = createApp();

const httpServer = runtime.app.listen(config.port, config.host, () => {
  logger.warn("MCP session state is process-local; use sticky sessions when running multiple replicas");
  logger.info({ host: config.host, port: config.port, endpoint: "/mcp" }, "MCP Streamable HTTP server listening");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    logger.info({ signal }, "Received shutdown signal");

    await runtime.closeMcpTransports();

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
