import type { JWTPayload } from "jose";

export function extractScopes(payload: JWTPayload): string[] {
  const scope = payload.scope;
  if (typeof scope === "string") {
    return scope.split(" ").filter(Boolean);
  }

  const scp = payload.scp;
  if (Array.isArray(scp) && scp.every((value) => typeof value === "string")) {
    return scp;
  }

  return [];
}

export function extractTenantId(payload: JWTPayload): string | undefined {
  const tenantId = payload.tenant_id ?? payload["https://identity-control-plane.example/tenant_id"];
  return typeof tenantId === "string" ? tenantId : undefined;
}
