import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveIdentityToolDependencies, type IdentityToolDependencies } from "./dependencies.js";
import { registerPatchTenantSecurityPolicyTool } from "./patchTenantSecurityPolicy.js";

export function registerIdentityTools(server: McpServer, dependencies: IdentityToolDependencies = {}): void {
  const resolvedDependencies = resolveIdentityToolDependencies(dependencies);

  registerPatchTenantSecurityPolicyTool(server, resolvedDependencies);
}
