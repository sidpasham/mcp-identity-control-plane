import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractScopes, extractTenantId } from "../../src/auth/claims.js";

describe("claim extraction", () => {
  it("extracts space-delimited scope claims", () => {
    assert.deepEqual(extractScopes({ scope: "policy:read policy:write" }), ["policy:read", "policy:write"]);
  });

  it("extracts array scp claims", () => {
    assert.deepEqual(extractScopes({ scp: ["policy:read", "policy:write"] }), ["policy:read", "policy:write"]);
  });

  it("ignores malformed scope claims", () => {
    assert.deepEqual(extractScopes({ scp: ["policy:read", 10] }), []);
  });

  it("extracts standard and namespaced tenant claims", () => {
    assert.equal(extractTenantId({ tenant_id: "company_alpha" }), "company_alpha");
    assert.equal(
      extractTenantId({ "https://identity-control-plane.example/tenant_id": "company_beta" }),
      "company_beta"
    );
  });
});
