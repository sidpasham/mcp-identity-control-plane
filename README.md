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

JWT verification is handled with `jose` against a configured OIDC issuer, audience, and JWKS URI. Tenant policy storage uses PostgreSQL, and rate limiting uses Upstash Redis. MCP session state is still process-local and should be handled with deployment-level session affinity before using this for real control-plane operations.

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
MCP_RESOURCE_SERVER_URL=http://localhost:3000/mcp
MCP_ACCESS_SCOPES=mcp:readonly,mcp:readwrite
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=verify-full
PG_POOL_MAX=10
UPSTASH_REDIS_REST_URL=https://example.upstash.io
UPSTASH_REDIS_REST_TOKEN=...
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_MAX_REQUESTS=50
```

`OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI`, `DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN` are required. The process fails during startup if any of them are missing.

For Auth0, these OIDC values must match the access token exactly:

```bash
OIDC_ISSUER=https://YOUR_AUTH0_DOMAIN/
OIDC_AUDIENCE=http://localhost:3000
OIDC_JWKS_URI=https://YOUR_AUTH0_DOMAIN/.well-known/jwks.json
```

If `OIDC_JWKS_URI` is still set to the placeholder issuer, token verification fails because the server cannot fetch the signing keys. `/mcp` requires a bearer token with one of the configured `MCP_ACCESS_SCOPES`. Write tools also require `mcp:readwrite` plus the tool-specific business scope, such as `policy:write`. In production, set `MCP_RESOURCE_SERVER_URL` to the externally reachable HTTPS URL for the MCP endpoint.

## Scope Model

The service separates MCP transport access from business authorization:

```text
mcp:readonly   Access /mcp and call read-only MCP tools
mcp:readwrite  Access /mcp and call read/write MCP tools
policy:read    Business permission to read tenant policy
policy:write   Business permission to mutate tenant policy
tenant_id      Trusted resource boundary claim
```

`/mcp` accepts either `mcp:readonly` or `mcp:readwrite`. Individual tools apply stricter policies. For example, `patch_tenant_security_policy` requires `mcp:readwrite`, `policy:write`, and a matching `tenant_id` claim when the token includes one.

## MCP Authorization

This service follows the MCP HTTP authorization model from the MCP authorization specification. The MCP server acts as an OAuth resource server: it does not issue tokens, but it validates bearer access tokens issued by the configured OIDC authorization server.

Clients authenticate every MCP HTTP request with:

```http
Authorization: Bearer <access-token>
```

The server exposes OAuth Protected Resource Metadata so MCP clients can discover the authorization server and supported scopes:

```text
/.well-known/oauth-protected-resource
/.well-known/oauth-protected-resource/mcp
```

The metadata advertises:

- `resource`: the canonical MCP resource URL from `MCP_RESOURCE_SERVER_URL`
- `authorization_servers`: the configured `OIDC_ISSUER`
- `scopes_supported`: `mcp:readonly`, `mcp:readwrite`, `policy:read`, `policy:write`
- `bearer_methods_supported`: `header`

Unauthenticated or invalid `/mcp` requests receive a bearer challenge. Insufficient-scope responses include a `WWW-Authenticate` header with `error="insufficient_scope"`, a `scope` hint, and `resource_metadata` pointing to the protected resource metadata document.

Authorization is layered:

```text
HTTP /mcp layer:
  JWT issuer/audience/signature/expiry validation
  mcp:readonly OR mcp:readwrite

Tool layer:
  operation-specific MCP scope
  operation-specific business scope

Tenant/resource layer:
  tenant_id claim must match the requested tenant when present
```

For the current write tool, the effective requirement is:

```text
mcp:readwrite AND policy:write AND matching tenant_id boundary
```

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
GET             /.well-known/oauth-protected-resource
GET             /.well-known/oauth-protected-resource/mcp
GET             /healthz  health check endpoint
GET             /readyz   PostgreSQL and Redis readiness checks
```

The server listens on `http://0.0.0.0:3000` by default. MCP clients should connect to the externally reachable service URL for the `/mcp` endpoint. Protected resource metadata advertises the canonical MCP resource URL, authorization server issuer, and supported scopes.

## MCP Client Configuration

Use a client that supports the MCP Streamable HTTP transport and point it at:

```text
http://localhost:3000/mcp
```

In production, put the service behind your normal ingress, TLS termination, authentication middleware, and routing controls, then configure the client with the deployed HTTPS URL. If the service runs with more than one replica, use sticky sessions or move MCP session coordination to infrastructure that can preserve session affinity.

`SESSION_STATE_MODE=sticky` documents the current process-local MCP session map. Multiple replicas require load-balancer session affinity for `/mcp`. Use `SESSION_STATE_MODE=external` only after implementing shared MCP session coordination.

## Curl Examples

Start the local server:

```bash
npm run dev
```

Check that the HTTP server is up:

```bash
curl -i http://localhost:3000/healthz
```

Initialize an MCP session:

```bash
curl -i http://localhost:3000/mcp \
  -H 'Authorization: Bearer YOUR_REAL_JWT' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-06-18",
      "capabilities": {},
      "clientInfo": {
        "name": "curl",
        "version": "1.0.0"
      }
    }
  }'
```

Copy the `mcp-session-id` response header. MCP sessions are process-local, so restarting the server invalidates previous session IDs.

Call the tenant policy tool. The same bearer token authorizes the MCP HTTP request and supplies the identity used for tool-level authorization.

```bash
curl -i http://localhost:3000/mcp \
  -H 'Authorization: Bearer YOUR_REAL_JWT' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'mcp-session-id: YOUR_SESSION_ID' \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "patch_tenant_security_policy",
      "arguments": {
        "targetTenant": "tenant:company_alpha",
        "settings": {
          "botDetectionEnabled": true,
          "suspiciousIpThrottling": true
        }
      }
    }
  }'
```

The JWT must be issued by `OIDC_ISSUER`, intended for `OIDC_AUDIENCE`, signed by a key published at `OIDC_JWKS_URI`, and carry `mcp:readwrite` plus `policy:write` in `scope`, `scopes`, or `scp` to call this write tool. If the token contains a `tenant_id` claim, it must match the requested tenant, for example `company_alpha` for `tenant:company_alpha`.

## Tool: `patch_tenant_security_policy`

Updates selected security policy settings for a target tenant after authentication and authorization checks.

### Input

```json
{
  "targetTenant": "tenant:company_alpha",
  "settings": {
    "botDetectionEnabled": true,
    "suspiciousIpThrottling": true
  }
}
```

### Authorization Flow

1. MCP clients discover protected resource metadata from `/.well-known/oauth-protected-resource/mcp` or the `resource_metadata` value in `WWW-Authenticate`.
2. The client sends `Authorization: Bearer <access-token>` on every `/mcp` HTTP request.
3. The MCP HTTP middleware verifies the bearer JWT signature through the configured JWKS URI.
4. `jose` validates issuer, audience, expiry, and standard JWT validity constraints.
5. Scopes are extracted from `scope`, `scopes`, or `scp`.
6. `/mcp` requires one configured MCP access scope, such as `mcp:readonly` or `mcp:readwrite`.
7. `SecurityEngine.enforceRateLimit` applies a Redis-backed per-subject rate limit.
8. The write tool authorization policy requires `mcp:readwrite` and `policy:write`.
9. If the token contains `tenant_id`, it must match `targetTenant`.
10. The PostgreSQL tenant policy row is updated and an audit event is written in the same transaction.

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
  index.ts                     Express HTTP MCP server entry point
  auth/
    authorization.ts           Reusable tool authorization policies
    claims.ts                  JWT claim extraction helpers
    mcpAccess.ts               MCP HTTP bearer auth and access-scope checks
    protectedResourceMetadata.ts
                                OAuth protected resource metadata endpoints
    scopes.ts                  Shared MCP and business scope constants
    security.ts                JWT verification and rate-limit enforcement
  config/
    config.ts                  Central environment validation
  database/
    migrate.ts                 SQL migration runner
  logging/
    logger.ts                  Shared Pino logger
  repositories/
    rateLimiter.ts             Redis-backed actor rate limiting
    tenantPolicyRepository.ts  PostgreSQL policy storage and audit writes
  tools/
    toolResult.ts              Shared MCP tool response helpers
    identity/
      index.ts                 Identity tool registry
      dependencies.ts          Identity tool dependency resolution
      patchTenantSecurityPolicy.ts
                               Tenant security policy patch tool
  types/
    types.ts                   Shared identity and policy types
tests/
  auth/
  repositories/
migrations/
  001_tenant_policy_storage.sql
Dockerfile
docker-compose.yml
```

## Seed Data

The migration seeds:

- Tenant: `tenant:company_alpha`

The access token must be a JWT issued by `OIDC_ISSUER`, intended for `OIDC_AUDIENCE`, signed by a key published at `OIDC_JWKS_URI`, and carrying `mcp:readwrite` plus `policy:write` in `scope`, `scopes`, or `scp` for write tools.

## Public Repository Safety

Before pushing this project to a public repository:

- Do not commit `.env`; it is ignored by `.gitignore`.
- Keep `.env.example` placeholder-only.
- Do not paste real JWTs, database URLs, Redis tokens, Auth0 client secrets, or private JWKS material into README files, examples, tests, or commit messages.
- Rotate any token that was pasted into a terminal, issue tracker, chat, or public branch.
- Run `git status --short` and inspect new files before pushing.

## Production Hardening Checklist

Before using this pattern for real control-plane operations:

- Verify authorized party/client ID if your issuer requires it.
- Enforce tenant boundaries from trusted claims, not request input alone.
- Put the HTTP service behind TLS and ingress-level authentication controls.
- Add CORS and host/origin validation appropriate for your deployment.
- Use sticky sessions or an architecture that preserves MCP session affinity across replicas.
- Add managed database backups, migration automation, and connection pool sizing for your deployment.
- Decide whether MCP session state should remain sticky-session based or move to shared coordination.
- Add metrics and tracing.
- Avoid logging sensitive token material.

## Development Notes

- Source files use ESM imports and TypeScript `NodeNext` module resolution.
- `dist/`, `node_modules/`, and common local artifacts are ignored by git.
- `npm test` runs type checking, build verification, and Node unit tests.
