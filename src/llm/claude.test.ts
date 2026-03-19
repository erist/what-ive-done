import test from "node:test";
import assert from "node:assert/strict";

import { createClaudeWorkflowAnalyzer } from "./claude.js";

test("createClaudeWorkflowAnalyzer uses Anthropic Messages API tool calls", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;

  const analyzer = createClaudeWorkflowAnalyzer({
    apiKey: "anthropic-test-key",
    model: "claude-sonnet-4-5",
    baseUrl: "https://example.test/v1",
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      requestInit = init;

      return new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              input: {
                workflow_name: "Claude triage",
                workflow_summary: "Reviews a queue and updates another system.",
                automation_suitability: "medium",
                recommended_approach: "Hybrid desktop and browser automation",
                rationale: "The flow repeats but spans multiple surfaces.",
              },
            },
          ],
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
    workflowName: "Triage queue",
    detectionMode: "standard",
    payload: {
      workflowSteps: ["Open queue", "Review item", "Update CRM"],
      frequency: 8,
      averageDurationSeconds: 215,
      applications: ["chrome", "slack"],
      domains: ["ops.internal"],
    },
  });

  const parsedBody = JSON.parse(String(requestInit?.body)) as {
    tool_choice: { type: string; name: string };
    tools: Array<{ name: string }>;
  };

  assert.equal(requestUrl, "https://example.test/v1/messages");
  assert.equal((requestInit?.headers as Record<string, string>)["x-api-key"], "anthropic-test-key");
  assert.equal(parsedBody.tool_choice.name, "workflow_analysis");
  assert.equal(parsedBody.tools[0]?.name, "workflow_analysis");
  assert.equal(result.provider, "claude");
  assert.equal(result.workflowName, "Claude triage");
});
