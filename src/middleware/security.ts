import { createRemoteJWKSet, jwtVerify } from "jose";
import { TokenPayload } from "../core/types.js";
import { UpstashRateLimiter } from "../repositories/rateLimiter.js";
import { config } from "../config.js";
import { extractScopes, extractTenantId } from "../auth/claims.js";

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

    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.oidcIssuer,
      audience: config.oidcAudience
    });

    if (!payload.sub) {
      throw new Error("Invalid Token: Missing subject claim.");
    }

    const scopes = extractScopes(payload);
    const tenantId = extractTenantId(payload);

    return {
      sub: payload.sub,
      iss: String(payload.iss),
      aud: payload.aud,
      scopes: scopes,
      tenant_id: tenantId
    };
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
