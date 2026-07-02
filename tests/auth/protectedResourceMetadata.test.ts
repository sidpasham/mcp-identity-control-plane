import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProtectedResourceMetadata, protectedResourceMetadataPath } from "../../src/auth/protectedResourceMetadata.js";
import { McpScopes, PolicyScopes } from "../../src/auth/scopes.js";
import { config } from "../../src/config/config.js";

describe("protected resource metadata", () => {
  it("builds metadata for the configured MCP resource", () => {
    const metadata = buildProtectedResourceMetadata();

    assert.equal(metadata.resource, config.mcpResourceServerUrl.href);
    assert.deepEqual(metadata.authorization_servers, [config.oidcIssuer]);
    assert.equal(metadata.resource_name, config.serviceName);
    assert.deepEqual(metadata.bearer_methods_supported, ["header"]);
    assert.deepEqual(metadata.scopes_supported, [
      McpScopes.readonly,
      McpScopes.readwrite,
      PolicyScopes.read,
      PolicyScopes.write
    ]);
  });

  it("uses a path-specific protected resource metadata URL for /mcp", () => {
    assert.equal(
      protectedResourceMetadataPath(new URL("https://identity.example.com/mcp")),
      "/.well-known/oauth-protected-resource/mcp"
    );
  });
});
