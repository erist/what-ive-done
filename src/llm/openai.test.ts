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
