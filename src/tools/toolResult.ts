import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type TextToolResult = CallToolResult;

export function jsonToolResult(value: unknown): TextToolResult {
  return textToolResult(JSON.stringify(value));
}

export function textToolResult(text: string): TextToolResult {
  return { content: [{ type: "text", text }] };
}

export function toolError(message: string): TextToolResult {
  return { ...textToolResult(message), isError: true };
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
