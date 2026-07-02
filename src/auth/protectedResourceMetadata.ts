import express from "express";
import { config } from "../config/config.js";
import { supportedAuthorizationScopes } from "./scopes.js";

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
  resource_name: string;
}

export function mcpProtectedResourceMetadataRouter(): express.Router {
  const router = express.Router();
  const metadata = buildProtectedResourceMetadata();
  const pathSpecificMetadataPath = protectedResourceMetadataPath(config.mcpResourceServerUrl);

  router.get(pathSpecificMetadataPath, (_req, res) => {
    res.status(200).json(metadata);
  });

  if (pathSpecificMetadataPath !== "/.well-known/oauth-protected-resource") {
    router.get("/.well-known/oauth-protected-resource", (_req, res) => {
      res.status(200).json(metadata);
    });
  }

  return router;
}

export function buildProtectedResourceMetadata(): ProtectedResourceMetadata {
  return {
    resource: config.mcpResourceServerUrl.href,
    authorization_servers: [config.oidcIssuer],
    scopes_supported: [...supportedAuthorizationScopes],
    bearer_methods_supported: ["header"],
    resource_name: config.serviceName
  };
}

export function protectedResourceMetadataPath(resourceServerUrl: URL): string {
  const resourcePath = resourceServerUrl.pathname === "/" ? "" : resourceServerUrl.pathname;
  return `/.well-known/oauth-protected-resource${resourcePath}`;
}
