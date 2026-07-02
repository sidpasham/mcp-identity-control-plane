import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasAnyScope } from "../../src/auth/mcpAccess.js";
import { defaultMcpAccessScopes, McpScopes, PolicyScopes } from "../../src/auth/scopes.js";

describe("MCP access scope checks", () => {
  it("allows tokens with a readonly MCP access scope", () => {
    assert.equal(hasAnyScope([McpScopes.readonly], defaultMcpAccessScopes), true);
  });

  it("allows tokens with a readwrite MCP access scope", () => {
    assert.equal(hasAnyScope([McpScopes.readwrite], defaultMcpAccessScopes), true);
  });

  it("does not require every configured MCP access scope", () => {
    assert.equal(hasAnyScope([McpScopes.readonly], defaultMcpAccessScopes), true);
  });

  it("denies tokens without a configured MCP access scope", () => {
    assert.equal(hasAnyScope([PolicyScopes.write], defaultMcpAccessScopes), false);
  });
});
