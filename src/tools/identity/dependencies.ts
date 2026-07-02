import { PostgresTenantPolicyRepository, type TenantPolicyRepository } from "../../repositories/tenantPolicyRepository.js";

export interface IdentityToolDependencies {
  tenantPolicyRepository?: TenantPolicyRepository;
}

const defaultTenantPolicyRepository = new PostgresTenantPolicyRepository();

export function resolveIdentityToolDependencies(
  dependencies: IdentityToolDependencies = {}
): Required<IdentityToolDependencies> {
  return {
    tenantPolicyRepository: dependencies.tenantPolicyRepository ?? defaultTenantPolicyRepository
  };
}
