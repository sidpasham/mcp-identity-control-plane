import type { RequestHandler } from "express";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { config } from "../config/config.js";
import { SecurityEngine } from "./security.js";

const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(config.mcpResourceServerUrl);

const mcpTokenVerifier: OAuthTokenVerifier = {
  verifyAccessToken: (token) => SecurityEngine.verifyAccessToken(token)
};

export const requireMcpBearerAuth = requireBearerAuth({
  verifier: mcpTokenVerifier,
  resourceMetadataUrl
});

export function requireAnyMcpAccessScope(allowedScopes = config.mcpAccessScopes): RequestHandler {
  return (req, res, next) => {
    const grantedScopes = req.auth?.scopes ?? [];

    if (hasAnyScope(grantedScopes, allowedScopes)) {
      next();
      return;
    }

    res.set(
      "WWW-Authenticate",
      `Bearer error="insufficient_scope", error_description="Insufficient MCP access scope", scope="${allowedScopes.join(" ")}", resource_metadata="${resourceMetadataUrl}"`
    );
    res.status(403).json({
      error: "insufficient_scope",
      error_description: `Requires one of the following MCP access scopes: ${allowedScopes.join(", ")}`
    });
  };
}

export function hasAnyScope(grantedScopes: readonly string[], allowedScopes: readonly string[]): boolean {
  const granted = new Set(grantedScopes);
  return allowedScopes.some((scope) => granted.has(scope));
}
