export const McpScopes = {
  readonly: "mcp:readonly",
  readwrite: "mcp:readwrite"
} as const;

export const PolicyScopes = {
  read: "policy:read",
  write: "policy:write"
} as const;

export const defaultMcpAccessScopes = [
  McpScopes.readonly,
  McpScopes.readwrite
] as const;

export const readToolMcpScopes = [
  McpScopes.readonly,
  McpScopes.readwrite
] as const;

export const writeToolMcpScopes = [
  McpScopes.readwrite
] as const;

export const supportedAuthorizationScopes = [
  McpScopes.readonly,
  McpScopes.readwrite,
  PolicyScopes.read,
  PolicyScopes.write
] as const;
