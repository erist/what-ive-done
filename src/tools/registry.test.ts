import assert from "node:assert/strict";
import test from "node:test";

import { getToolDefinition, listToolDefinitions } from "./registry.js";

test("tool registry exposes the managed collectors and analyzers", () => {
  const collectors = listToolDefinitions("collector").map((tool) => tool.name);
  const analyzers = listToolDefinitions("analyzer").map((tool) => tool.name);

  assert.deepEqual(collectors, ["gws", "git", "gh"]);
  assert.deepEqual(analyzers, ["gemini", "claude", "openai"]);

  assert.deepEqual(getToolDefinition("gemini")?.authMethods, ["oauth2", "api-key"]);
  assert.equal(getToolDefinition("git")?.prompts?.[0]?.key, "repo-path");
});
