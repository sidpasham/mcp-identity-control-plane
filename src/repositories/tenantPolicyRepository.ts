import pg from "pg";
import { SecurityPolicy } from "../types/types.js";
import { config } from "../config/config.js";
import { retryDependency } from "../reliability/dependencies.js";

const { Pool } = pg;

export interface TenantPolicyRepository {
  ping(): Promise<void>;
  patchPolicy(tenantId: string, settings: Partial<SecurityPolicy>, actorSub: string): Promise<SecurityPolicy>;
}

export interface PostgresTenantPolicyRepositoryOptions {
  retryAttempts?: number;
  retryDelayMs?: number;
}

export class PostgresTenantPolicyRepository implements TenantPolicyRepository {
  private readonly pool: pg.Pool;
  private readonly retryAttempts: number;
  private readonly retryDelayMs: number;

  constructor(connectionString = config.databaseUrl, options: PostgresTenantPolicyRepositoryOptions = {}) {
    this.pool = new Pool({
      connectionString,
      max: config.pgPoolMax,
      idleTimeoutMillis: config.pgIdleTimeoutMs,
      connectionTimeoutMillis: config.pgConnectionTimeoutMs,
      statement_timeout: config.pgQueryTimeoutMs,
      query_timeout: config.pgQueryTimeoutMs,
      idle_in_transaction_session_timeout: config.pgQueryTimeoutMs * 2,
      ssl: config.pgSsl ? { rejectUnauthorized: config.pgSslRejectUnauthorized } : false
    });
    this.retryAttempts = options.retryAttempts ?? config.dependencyRetryAttempts;
    this.retryDelayMs = options.retryDelayMs ?? config.dependencyRetryDelayMs;
  }

  async ping(): Promise<void> {
    await retryDependency(
      async () => {
        await this.pool.query("SELECT 1");
      },
      this.retryOptions("Postgres health check")
    );
  }

  async patchPolicy(tenantId: string, settings: Partial<SecurityPolicy>, actorSub: string): Promise<SecurityPolicy> {
    const client = await retryDependency(
      () => this.pool.connect(),
      this.retryOptions("Postgres connection acquisition")
    );

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
        ...settings
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

  private retryOptions(operationName: string) {
    return {
      attempts: this.retryAttempts,
      delayMs: this.retryDelayMs,
      operationName
    };
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
