import pg from "pg";
import { SecurityPolicy } from "../core/types.js";
import { config } from "../config.js";

const { Pool } = pg;

export interface TenantPolicyRepository {
  patchPolicy(tenantId: string, policyUpdate: Partial<SecurityPolicy>, actorSub: string): Promise<SecurityPolicy>;
}

export class PostgresTenantPolicyRepository implements TenantPolicyRepository {
  private readonly pool: pg.Pool;

  constructor(connectionString = config.databaseUrl) {
    this.pool = new Pool({
      connectionString,
      max: config.pgPoolMax,
      idleTimeoutMillis: config.pgIdleTimeoutMs,
      connectionTimeoutMillis: config.pgConnectionTimeoutMs,
      ssl: config.pgSsl ? { rejectUnauthorized: config.pgSslRejectUnauthorized } : false
    });
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async patchPolicy(tenantId: string, policyUpdate: Partial<SecurityPolicy>, actorSub: string): Promise<SecurityPolicy> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const existing = await client.query<PolicyRow>(
        `
          SELECT tenant_id, bot_detection_enabled, suspicious_ip_throttling, rate_limit_threshold
          FROM tenant_security_policies
          WHERE tenant_id = $1
          FOR UPDATE
        `,
        [tenantId]
      );

      const currentPolicy = existing.rows[0]
        ? rowToPolicy(existing.rows[0])
        : defaultPolicy();

      const nextPolicy = {
        ...currentPolicy,
        ...policyUpdate
      };

      const saved = await client.query<PolicyRow>(
        `
          INSERT INTO tenant_security_policies (
            tenant_id,
            bot_detection_enabled,
            suspicious_ip_throttling,
            rate_limit_threshold
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (tenant_id) DO UPDATE SET
            bot_detection_enabled = EXCLUDED.bot_detection_enabled,
            suspicious_ip_throttling = EXCLUDED.suspicious_ip_throttling,
            rate_limit_threshold = EXCLUDED.rate_limit_threshold,
            updated_at = now()
          RETURNING tenant_id, bot_detection_enabled, suspicious_ip_throttling, rate_limit_threshold
        `,
        [
          tenantId,
          nextPolicy.botDetectionEnabled,
          nextPolicy.suspiciousIpThrottling,
          nextPolicy.rateLimitThreshold
        ]
      );

      const savedPolicy = rowToPolicy(saved.rows[0]);

      await client.query(
        `
          INSERT INTO policy_audit_events (
            tenant_id,
            actor_sub,
            action,
            policy_before,
            policy_after
          ) VALUES ($1, $2, $3, $4, $5)
        `,
        [
          tenantId,
          actorSub,
          "patch_tenant_security_policy",
          existing.rows[0] ? currentPolicy : null,
          savedPolicy
        ]
      );

      await client.query("COMMIT");
      return savedPolicy;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

interface PolicyRow {
  tenant_id: string;
  bot_detection_enabled: boolean;
  suspicious_ip_throttling: boolean;
  rate_limit_threshold: number;
}

function rowToPolicy(row: PolicyRow): SecurityPolicy {
  return {
    botDetectionEnabled: row.bot_detection_enabled,
    suspiciousIpThrottling: row.suspicious_ip_throttling,
    rateLimitThreshold: row.rate_limit_threshold
  };
}

function defaultPolicy(): SecurityPolicy {
  return {
    botDetectionEnabled: false,
    suspiciousIpThrottling: false,
    rateLimitThreshold: 100
  };
}
