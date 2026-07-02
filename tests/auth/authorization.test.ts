import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluatePolicies,
  requireAllScopes,
  requireAnyScope,
  requireTenantClaimMatchesTargetTenant
} from "../../src/auth/authorization.js";
import type { TokenPayload } from "../../src/types/types.js";

const baseIdentity: TokenPayload = {
  sub: "agent:deployment-bot",
  iss: "https://issuer.example/",
  scopes: ["policy:read", "policy:write"]
};

describe("authorization policy evaluation", () => {
  it("allows identities that satisfy every policy", () => {
    const decision = evaluatePolicies(
      {
        identity: { ...baseIdentity, tenant_id: "company_alpha" },
        targetTenant: "tenant:company_alpha"
      },
      [
        requireAllScopes(["policy:write"]),
        requireTenantClaimMatchesTargetTenant()
      ]
    );

    assert.deepEqual(decision, { allowed: true });
  });

  it("denies identities missing a required scope", () => {
    const decision = evaluatePolicies(
      {
        identity: { ...baseIdentity, scopes: ["policy:read"] }
      },
      [requireAllScopes(["policy:write"])]
    );

    assert.deepEqual(decision, {
      allowed: false,
      reason: "Forbidden: Token missing required macro-scope 'policy:write'."
    });
  });

  it("reports all missing required scopes", () => {
    const decision = evaluatePolicies(
      {
        identity: { ...baseIdentity, scopes: ["policy:read"] }
      },
      [requireAllScopes(["policy:write", "tenant:admin"])]
    );

    assert.deepEqual(decision, {
      allowed: false,
      reason: "Forbidden: Token missing required macro-scopes: 'policy:write', 'tenant:admin'."
    });
  });

  it("allows identities with any accepted scope", () => {
    const decision = evaluatePolicies(
      {
        identity: { ...baseIdentity, scopes: ["policy:admin"] }
      },
      [requireAnyScope(["policy:write", "policy:admin"])]
    );

    assert.deepEqual(decision, { allowed: true });
  });

  it("denies identities without an accepted scope", () => {
    const decision = evaluatePolicies(
      {
        identity: { ...baseIdentity, scopes: ["policy:read"] }
      },
      [requireAnyScope(["policy:write", "policy:admin"])]
    );

    assert.deepEqual(decision, {
      allowed: false,
      reason: "Forbidden: Token requires one of the following macro-scopes: 'policy:write', 'policy:admin'."
    });
  });

  it("denies tenant claim mismatches", () => {
    const decision = evaluatePolicies(
      {
        identity: { ...baseIdentity, tenant_id: "company_alpha" },
        targetTenant: "tenant:company_beta"
      },
      [requireTenantClaimMatchesTargetTenant()]
    );

    assert.deepEqual(decision, {
      allowed: false,
      reason: "Forbidden: Token tenant claim does not match requested target tenant."
    });
  });
});
