export interface TokenPayload {
  sub: string;         // Subject (e.g., "agent:deployment-bot" or "user:1234")
  iss: string;         // Issuer (e.g., "https://auth0-emerging-tech.auth0.com/")
  aud?: string | string[]; // Audience validated against OIDC_AUDIENCE
  scp: string[];       // Scopes granted via OAuth2
  tenant_id?: string;  // Multi-tenant boundary
}

export interface FgaTuple {
  user: string;
  relation: "owner" | "editor" | "viewer";
  object: string;      // Formatted as "resource_type:resource_id"
}

export interface SecurityPolicy {
  botDetectionEnabled: boolean;
  suspiciousIpThrottling: boolean;
  rateLimitThreshold: number;
}
