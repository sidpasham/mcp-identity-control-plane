import { PostgresTenantPolicyRepository, type TenantPolicyRepository } from "../../repositories/tenantPolicyRepository.js";
import { UpstashRateLimiter, type RateLimiter } from "../../repositories/rateLimiter.js";

export interface IdentityToolDependencies {
  tenantPolicyRepository?: TenantPolicyRepository;
  rateLimiter?: RateLimiter;
}

const defaultTenantPolicyRepository = new PostgresTenantPolicyRepository();
const defaultRateLimiter = new UpstashRateLimiter();

export function resolveIdentityToolDependencies(
  dependencies: IdentityToolDependencies = {}
): Required<IdentityToolDependencies> {
  return {
    tenantPolicyRepository: dependencies.tenantPolicyRepository ?? defaultTenantPolicyRepository,
    rateLimiter: dependencies.rateLimiter ?? defaultRateLimiter
  };
}
