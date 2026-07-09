import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";
import {
  evaluatePolicies,
  requireAllScopes,
  requireTenantClaimMatchesTargetTenant,
  type AuthorizationDecision
} from "../../auth/authorization.js";
import { McpScopes, PolicyScopes } from "../../auth/scopes.js";
import { logger } from "../../logging/logger.js";
import type { RateLimiter } from "../../repositories/rateLimiter.js";
import type { TenantPolicyRepository } from "../../repositories/tenantPolicyRepository.js";
import type { TokenPayload } from "../../types/types.js";
import { getErrorMessage, jsonToolResult, toolError, type TextToolResult } from "../toolResult.js";
import type { IdentityToolDependencies } from "./dependencies.js";

const TOOL_NAME = "patch_tenant_security_policy";
const TOOL_DESCRIPTION = "Enables or modifies critical perimeter guards (bot protection, throttling) for a specific Auth0 tenant domain.";

const securitySettingsSchema = z.object({
  botDetectionEnabled: z.boolean(),
  suspiciousIpThrottling: z.boolean()
}).strict();

const targetTenantSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(
    /^tenant:[A-Za-z0-9][A-Za-z0-9_.-]*$/,
    "targetTenant must use tenant:<id> with alphanumeric, underscore, hyphen, or dot characters."
  );

const inputSchema = z.object({
  targetTenant: targetTenantSchema.describe("The target tenant identifier (e.g., 'tenant:company_alpha')."),
  settings: securitySettingsSchema.describe("The targeted operational security settings configuration profile.")
}).strict();

const authorizationPolicies = [
  requireAllScopes([McpScopes.readwrite, PolicyScopes.write]),
  requireTenantClaimMatchesTargetTenant()
] as const;

type PatchTenantSecurityPolicyInput = z.infer<typeof inputSchema>;

export function registerPatchTenantSecurityPolicyTool(
  server: McpServer,
  dependencies: Required<IdentityToolDependencies>
): void {
  server.registerTool(
    TOOL_NAME,
    {
      description: TOOL_DESCRIPTION,
      inputSchema
    },
    createPatchTenantSecurityPolicyHandler(dependencies.tenantPolicyRepository, dependencies.rateLimiter)
  );
}

function createPatchTenantSecurityPolicyHandler(tenantPolicyRepository: TenantPolicyRepository, rateLimiter: RateLimiter) {
  return async (
    { targetTenant, settings }: PatchTenantSecurityPolicyInput,
    extra: { authInfo?: AuthInfo }
  ): Promise<TextToolResult> => {
    let actorSub: string | undefined;

    try {
      const identity = identityFromAuthInfo(extra.authInfo);
      if (!identity) {
        return toolError("Forbidden: Missing authenticated MCP identity.");
      }

      actorSub = identity.sub;

      const authorization = authorizePatchTenantSecurityPolicy(identity, targetTenant);
      if (!authorization.allowed) {
        logger.warn(
          { actorSub: identity.sub, targetTenant, reason: authorization.reason },
          "Tenant security policy update forbidden"
        );
        return toolError(authorization.reason);
      }

      await rateLimiter.enforce(identity.sub);

      const currentConfig = await tenantPolicyRepository.patchPolicy(targetTenant, settings, identity.sub);
      logger.info({ actorSub: identity.sub, targetTenant }, "Tenant security policy updated");

      return jsonToolResult({
        message: "Policy updated successfully",
        currentConfig
      });
    } catch (err: unknown) {
      logger.warn({ err, actorSub, targetTenant }, "Tenant security policy update rejected");
      return toolError(`Execution Exception: ${getErrorMessage(err)}`);
    }
  };
}

function authorizePatchTenantSecurityPolicy(identity: TokenPayload, targetTenant: string): AuthorizationDecision {
  return evaluatePolicies(
    { identity, targetTenant },
    authorizationPolicies
  );
}

function identityFromAuthInfo(authInfo: AuthInfo | undefined): TokenPayload | undefined {
  const identity = authInfo?.extra?.identity;
  return isTokenPayload(identity) ? identity : undefined;
}

function isTokenPayload(value: unknown): value is TokenPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as TokenPayload;
  return (
    typeof candidate.sub === "string" &&
    typeof candidate.iss === "string" &&
    Array.isArray(candidate.scopes) &&
    candidate.scopes.every((scope) => typeof scope === "string")
  );
}
