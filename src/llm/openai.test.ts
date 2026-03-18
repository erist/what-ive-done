import test from "node:test";
import assert from "node:assert/strict";

import { createOpenAIWorkflowAnalyzer } from "./openai.js";

test("createOpenAIWorkflowAnalyzer sends summarized payloads to Responses API", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;

  const analyzer = createOpenAIWorkflowAnalyzer({
    apiKey: "test-key",
    model: "gpt-5-mini",
    baseUrl: "https://example.test/v1",
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      requestInit = init;

      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            workflow_name: "Order status lookup",
            workflow_summary: "Looks up order status and updates Slack.",
            automation_suitability: "high",
            recommended_approach: "Browser automation",
            rationale: "The sequence is repeated and mostly browser based.",
          }),
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    },
  });

  const result = await analyzer.analyze({
    workflowClusterId: "workflow-1",
    workflowName: "Order Search workflow",
    payload: {
      workflowSteps: ["Open admin page", "Search order", "Send Slack update"],
      frequency: 3,
      averageDurationSeconds: 135,
      applications: ["chrome", "slack"],
      domains: ["admin.internal"],
    },
  });

  assert.equal(requestUrl, "https://example.test/v1/responses");
  assert.ok(requestInit?.body);

  const parsedBody = JSON.parse(String(requestInit.body)) as {
    model: string;
    store: boolean;
    input: string;
    text: { format: { type: string; name: string } };
  };

  assert.equal(parsedBody.model, "gpt-5-mini");
  assert.equal(parsedBody.store, false);
  assert.equal(parsedBody.text.format.type, "json_schema");
  assert.equal(parsedBody.text.format.name, "workflow_analysis");
  assert.equal(JSON.parse(parsedBody.input).frequency, 3);
  assert.equal(result.workflowName, "Order status lookup");
  assert.equal(result.provider, "openai");
  assert.equal(result.recommendedApproach, "Browser automation");
});

test("createOpenAIWorkflowAnalyzer retries once on unauthorized and preserves the provider label", async () => {
  let attempt = 0;

  const analyzer = createOpenAIWorkflowAnalyzer({
    apiKey: "expired-api-key",
    provider: "openai-codex",
    model: "gpt-5.4",
    baseUrl: "https://example.test/v1",
    onUnauthorized: async () => "fresh-api-key",
    fetchImpl: async (_url, init) => {
      attempt += 1;
      const headers = init?.headers as Record<string, string>;

      if (attempt === 1) {
        assert.equal(headers.Authorization, "Bearer expired-api-key");
        return new Response("unauthorized", {
          status: 401,
        });
      }

      assert.equal(headers.Authorization, "Bearer fresh-api-key");
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            workflow_name: "Codex workflow",
            workflow_summary: "Replayed after refresh.",
            automation_suitability: "medium",
            recommended_approach: "API integration",
            rationale: "The retry path should refresh the token once.",
          }),
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    },
  });

  const result = await analyzer.analyze({
    workflowClusterId: "workflow-2",
    workflowName: "Codex workflow",
    payload: {
      workflowSteps: ["Open app", "Run task"],
      frequency: 2,
      averageDurationSeconds: 45,
      applications: ["chrome"],
      domains: ["app.example.test"],
    },
  });

  assert.equal(attempt, 2);
  assert.equal(result.provider, "openai-codex");
  assert.equal(result.workflowName, "Codex workflow");
});
