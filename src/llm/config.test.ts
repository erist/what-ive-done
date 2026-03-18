import assert from "node:assert/strict";
import test from "node:test";

import { coerceLLMConfiguration } from "./config.js";

test("coerceLLMConfiguration accepts openai-codex and defaults it to oauth2", () => {
  const configuration = coerceLLMConfiguration({
    provider: "openai-codex",
    model: "gpt-5.4",
  });

  assert.equal(configuration.provider, "openai-codex");
  assert.equal(configuration.authMethod, "oauth2");
  assert.equal(configuration.model, "gpt-5.4");
});

test("coerceLLMConfiguration rejects api-key auth for openai-codex", () => {
  assert.throws(
    () =>
      coerceLLMConfiguration({
        provider: "openai-codex",
        authMethod: "api-key",
      }),
    /does not support auth method api-key/iu,
  );
});
