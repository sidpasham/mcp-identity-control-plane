import type { TokenPayload } from "../types/types.js";

export interface AuthorizationContext {
  identity: TokenPayload;
  targetTenant?: string;
}

export type AuthorizationDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
    };

export type AuthorizationPolicy = (context: AuthorizationContext) => AuthorizationDecision;

export function evaluatePolicies(
  context: AuthorizationContext,
  policies: readonly AuthorizationPolicy[]
): AuthorizationDecision {
  for (const policy of policies) {
    const decision = policy(context);
    if (!decision.allowed) {
      return decision;
    }
  }

  return { allowed: true };
}

export function requireAllScopes(requiredScopes: readonly string[]): AuthorizationPolicy {
  return ({ identity }) => {
    const grantedScopes = new Set(identity.scopes);
    const missingScopes = requiredScopes.filter((scope) => !grantedScopes.has(scope));

    if (missingScopes.length > 0) {
      return deny(formatMissingScopeReason(missingScopes));
    }

    return { allowed: true };
  };
}

export function requireAnyScope(allowedScopes: readonly string[]): AuthorizationPolicy {
  return ({ identity }) => {
    const grantedScopes = new Set(identity.scopes);
    const hasAllowedScope = allowedScopes.some((scope) => grantedScopes.has(scope));

    if (!hasAllowedScope) {
      return deny(`Forbidden: Token requires one of the following macro-scopes: ${formatScopeList(allowedScopes)}.`);
    }

    return { allowed: true };
  };
}

export function requireTenantClaimMatchesTargetTenant(): AuthorizationPolicy {
  return ({ identity, targetTenant }) => {
    if (identity.tenant_id && targetTenant !== `tenant:${identity.tenant_id}`) {
      return deny("Forbidden: Token tenant claim does not match requested target tenant.");
    }

    return { allowed: true };
  };
}

function deny(reason: string): AuthorizationDecision {
  return { allowed: false, reason };
}

function formatMissingScopeReason(missingScopes: readonly string[]): string {
  if (missingScopes.length === 1) {
    return `Forbidden: Token missing required macro-scope '${missingScopes[0]}'.`;
  }

  return `Forbidden: Token missing required macro-scopes: ${formatScopeList(missingScopes)}.`;
}

function formatScopeList(scopes: readonly string[]): string {
  return scopes.map((scope) => `'${scope}'`).join(", ");
}
