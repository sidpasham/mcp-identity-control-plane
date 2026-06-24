# MCP Identity Control Plane

A TypeScript Model Context Protocol (MCP) server that exposes identity-aware control-plane tools over HTTP using the stable MCP SDK Streamable HTTP transport.

The current server is shaped like a deployable service rather than a stdio-only local MCP process:

- Express HTTP server.
- MCP Streamable HTTP endpoint at `/mcp`.
- Server-side transport handled by `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`.
- Per-session MCP transport lifecycle keyed by `mcp-session-id`.
- Health endpoint at `/healthz`.
- Readiness endpoint at `/readyz` for PostgreSQL and Redis dependency checks.
- Structured JSON logging with Pino.
- Request IDs via `x-request-id`.
- Graceful shutdown on `SIGINT` and `SIGTERM`.

JWT verification is handled with `jose` against a configured OIDC issuer, audience, and JWKS URI. Tenant policy storage uses PostgreSQL, and rate limiting uses Upstash Redis. FGA tuples and MCP session state are still process-local and should be replaced or handled with deployment-level session affinity before using this for real authorization decisions.

## Requirements

- Node.js 20 or newer
- npm

## Install

```bash
npm install
```

## Scripts

```bash
npm run dev        # run the HTTP MCP server from TypeScript with tsx
npm run migrate    # apply pending SQL migrations
npm run build      # compile TypeScript into dist/
npm run migrate:prod # apply migrations from compiled production image
npm start          # run the compiled server
npm run typecheck  # run tsc without emitting files
npm test           # typecheck, build, and run unit tests
```

## Configuration

For local development, copy the example file and fill in real values:

```bash
cp .env.example .env
```

The server loads `.env` automatically through `dotenv`. In production, define these values through your deployment platform's secret or environment-variable system instead of shipping a `.env` file.

Environment variables:

```bash
PORT=3000          # HTTP listen port
HOST=0.0.0.0       # HTTP listen host
LOG_LEVEL=info     # Pino log level
SESSION_STATE_MODE=sticky
OIDC_ISSUER=https://issuer.example.com/
OIDC_AUDIENCE=https://identity-control-plane.example
OIDC_JWKS_URI=https://issuer.example.com/.well-known/jwks.json
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=verify-full
PG_POOL_MAX=10
UPSTASH_REDIS_REST_URL=https://example.upstash.io
UPSTASH_REDIS_REST_TOKEN=...
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_MAX_REQUESTS=50
```

`OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI`, `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN` are required. The process fails during startup if any of them are missing.

## Database Setup

Create a PostgreSQL database, then apply pending migrations:

```bash
npm run migrate
```

The migration runner records applied files in `schema_migrations` and skips them on future runs. The current migration creates:

- `tenant_security_policies` for current policy state.
- `policy_audit_events` for write audit history.
- A seed policy row for `tenant:company_alpha`.

For a compiled production image:

```bash
npm run build
npm run migrate:prod
```

## Running The Server

For development:

```bash
npm run dev
```

For compiled execution:

```bash
npm run build
npm start
```

Default endpoints:

```text
GET|POST|DELETE /mcp      MCP Streamable HTTP transport endpoint
GET             /healthz  health check endpoint
GET             /readyz   PostgreSQL and Redis readiness checks
```

The server listens on `http://0.0.0.0:3000` by default. MCP clients should connect to the externally reachable service URL for the `/mcp` endpoint.

## MCP Client Configuration

Use a client that supports the MCP Streamable HTTP transport and point it at:

```text
http://localhost:3000/mcp
```

In production, put the service behind your normal ingress, TLS termination, authentication middleware, and routing controls, then configure the client with the deployed HTTPS URL. If the service runs with more than one replica, use sticky sessions or move MCP session coordination to infrastructure that can preserve session affinity.

`SESSION_STATE_MODE=sticky` documents the current process-local MCP session map. Multiple replicas require load-balancer session affinity for `/mcp`. Use `SESSION_STATE_MODE=external` only after implementing shared MCP session coordination.

## Tool: `patch_tenant_security_policy`

Updates selected security policy settings for a target tenant after authentication and authorization checks.

### Input

```json
{
  "accessToken": "eyJ.real-jwt-access-token",
  "targetTenant": "tenant:company_alpha",
  "policyUpdate": {
    "botDetectionEnabled": true,
    "suspiciousIpThrottling": true
  }
}
```

### Authorization Flow

1. `SecurityEngine.verifyAuth0Token` verifies the JWT signature through the configured JWKS URI.
2. `jose` validates issuer, audience, expiry, and standard JWT validity constraints.
3. Scopes are extracted from either `scope` or `scp`.
4. `SecurityEngine.enforceRateLimit` applies a Redis-backed per-subject rate limit.
5. The handler requires the decoded token to include `policy:write`.
6. If the token contains `tenant_id`, it must match `targetTenant`.
7. `SecurityEngine.checkFga` requires the verified subject to have the `editor` relation on the target tenant.
8. The PostgreSQL tenant policy row is updated and an audit event is written in the same transaction.

### Successful Response

```json
{
  "message": "Policy updated successfully",
  "currentConfig": {
    "botDetectionEnabled": true,
    "suspiciousIpThrottling": true,
    "rateLimitThreshold": 100
  }
}
```

## Project Structure

```text
src/
  auth/                        JWT claim parsing helpers
  config.ts                    Central environment validation
  index.ts                    Express HTTP MCP server entry point
  logger.ts                   Shared Pino logger
  core/types.ts               Shared identity, FGA, and policy types
  middleware/security.ts      JWT verification, mock FGA, and rate-limit enforcement
  repositories/               PostgreSQL policy storage and Redis rate limiting
  scripts/migrate.ts          SQL migration runner
  tools/identityTools.ts      MCP tool registration and handler logic
migrations/
  001_tenant_policy_storage.sql
Dockerfile
docker-compose.yml
```

## Seed Data

The migration seeds:

- Tenant: `tenant:company_alpha`

The FGA layer currently includes process-local tuples:

- Authorized editor relation: `agent:auto-pilot` on `tenant:company_alpha`
- Authorized owner relation: `user:security-lead` on `tenant:company_alpha`

The access token must be a JWT issued by `OIDC_ISSUER`, intended for `OIDC_AUDIENCE`, signed by a key published at `OIDC_JWKS_URI`, and carrying `policy:write` in either `scope` or `scp`.

## Production Hardening Checklist

Before using this pattern for real control-plane operations:

- Verify authorized party/client ID if your issuer requires it.
- Enforce tenant boundaries from trusted claims, not request input alone.
- Put the HTTP service behind TLS and ingress-level authentication controls.
- Add CORS and host/origin validation appropriate for your deployment.
- Use sticky sessions or an architecture that preserves MCP session affinity across replicas.
- Replace mock FGA tuples with OpenFGA or another durable authorization system.
- Add managed database backups, migration automation, and connection pool sizing for your deployment.
- Decide whether MCP session state should remain sticky-session based or move to shared coordination.
- Add metrics and tracing.
- Avoid logging sensitive token material.

## Development Notes

- Source files use ESM imports and TypeScript `NodeNext` module resolution.
- `dist/`, `node_modules/`, and common local artifacts are ignored by git.
- `npm test` runs type checking, build verification, and Node unit tests.
