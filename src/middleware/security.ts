import { createRemoteJWKSet, jwtVerify } from "jose";
import { TokenPayload, FgaTuple } from "../core/types.js";
import { UpstashRateLimiter } from "../repositories/rateLimiter.js";
import { config } from "../config.js";
import { extractScopes, extractTenantId } from "../auth/claims.js";

const jwks = createRemoteJWKSet(new URL(config.oidcJwksUri));
const rateLimiter = new UpstashRateLimiter();

// Mock database for OpenFGA relations
const mockFgaStore: FgaTuple[] = [
  { user: "agent:auto-pilot", relation: "editor", object: "tenant:company_alpha" },
  { user: "user:security-lead", relation: "owner", object: "tenant:company_alpha" }
];

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
      scp: scopes,
      tenant_id: tenantId
    };
  }

  /**
   * Implements Fine-Grained Authorization (FGA) checking the tuple relation
   */
  static checkFga(user: string, relation: string, object: string): boolean {
    return mockFgaStore.some(
      (tuple) => tuple.user === user && tuple.relation === relation && tuple.object === object
    );
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
