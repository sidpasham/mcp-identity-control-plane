import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SecurityEngine } from "../middleware/security.js";
import { PostgresTenantPolicyRepository } from "../repositories/tenantPolicyRepository.js";
import { logger } from "../logger.js";

const patchTenantSecurityPolicySchema = z.object({
  accessToken: z.string().describe("The raw OAuth2 access token passed down from the agent execution scope."),
  targetTenant: z.string().describe("The target tenant identifier (e.g., 'tenant:company_alpha')."),
  policyUpdate: z.object({
    botDetectionEnabled: z.boolean(),
    suspiciousIpThrottling: z.boolean()
  }).describe("The targeted operational security settings configuration profile.")
});

const tenantPolicyRepository = new PostgresTenantPolicyRepository();

export function registerIdentityTools(server: McpServer) {
  server.registerTool(
    "patch_tenant_security_policy",
    {
      description: "Enables or modifies critical perimeter guards (bot protection, throttling) for a specific Auth0 tenant domain.",
      inputSchema: patchTenantSecurityPolicySchema
    },
    async ({ accessToken, targetTenant, policyUpdate }) => {
      try {
        // 1. Authenticate identity
        const identity = await SecurityEngine.verifyAuth0Token(accessToken);

        // 2. Mitigate rogue loops
        await SecurityEngine.enforceRateLimit(identity.sub);

        // 3. Evaluate coarse scope
        if (!identity.scopes.includes("policy:write")) {
          return { isError: true, content: [{ type: "text", text: "Forbidden: Token missing required macro-scope 'policy:write'." }] };
        }

        if (identity.tenant_id && targetTenant !== `tenant:${identity.tenant_id}`) {
          return { isError: true, content: [{ type: "text", text: "Forbidden: Token tenant claim does not match requested target tenant." }] };
        }

        const currentConfig = await tenantPolicyRepository.patchPolicy(targetTenant, policyUpdate, identity.sub);
        logger.info({ actorSub: identity.sub, targetTenant }, "Tenant security policy updated");

        return {
          content: [{ type: "text", text: JSON.stringify({ message: "Policy updated successfully", currentConfig }) }]
        };

      } catch (err: any) {
        logger.warn({ err }, "Tenant security policy update rejected");
        return { isError: true, content: [{ type: "text", text: `Execution Exception: ${err.message}` }] };
      }
    }
  );
}
