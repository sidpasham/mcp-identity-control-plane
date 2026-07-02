import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTPayload } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { TokenPayload } from "../types/types.js";
import { UpstashRateLimiter } from "../repositories/rateLimiter.js";
import { config } from "../config/config.js";
import { extractScopes, extractTenantId } from "./claims.js";

const jwks = createRemoteJWKSet(new URL(config.oidcJwksUri));
const rateLimiter = new UpstashRateLimiter();

export class SecurityEngine {
  /**
   * Verifies an OAuth/OIDC JWT using the configured issuer, audience, and JWKS URI.
   */
  static async verifyAuth0Token(token: string): Promise<TokenPayload> {
    if (!token) {
      throw new Error("Invalid Token: Missing bearer access token.");
    }

    const payload = await verifyJwt(token);
    return tokenPayloadFromJwtPayload(payload);
  }

  static async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      const payload = await verifyJwt(token);
      const identity = tokenPayloadFromJwtPayload(payload);

      return {
        token,
        clientId: extractClientId(payload, identity.sub),
        scopes: identity.scopes,
        expiresAt: typeof payload.exp === "number" ? payload.exp : undefined,
        extra: { identity }
      };
    } catch {
      throw new InvalidTokenError("Invalid bearer access token.");
    }
  }

  /**
   * Crucial for GenAI: Mitigates infinite looping or cascading agent execution calls
   */
  static async enforceRateLimit(actorId: string): Promise<void> {
    await rateLimiter.enforce(actorId);
  }

  static async checkRateLimiter(): Promise<void> {
    await rateLimiter.ping();
  }
}

async function verifyJwt(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.oidcIssuer,
    audience: config.oidcAudience
  });

  return payload;
}

function tokenPayloadFromJwtPayload(payload: JWTPayload): TokenPayload {
  if (!payload.sub) {
    throw new Error("Invalid Token: Missing subject claim.");
  }

  return {
    sub: payload.sub,
    iss: String(payload.iss),
    aud: payload.aud,
    scopes: extractScopes(payload),
    tenant_id: extractTenantId(payload)
  };
}

function extractClientId(payload: JWTPayload, fallback: string): string {
  const clientId = payload.client_id ?? payload.azp ?? payload.clientId;
  return typeof clientId === "string" && clientId ? clientId : fallback;
}
