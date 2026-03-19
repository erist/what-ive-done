import test from "node:test";
import assert from "node:assert/strict";

import { createGeminiWorkflowAnalyzer } from "./gemini.js";

test("createGeminiWorkflowAnalyzer sends summarized payloads with API key auth", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;

  const analyzer = createGeminiWorkflowAnalyzer({
    apiKey: "gemini-test-key",
    model: "gemini-2.5-flash",
    baseUrl: "https://example.test/v1beta",
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      requestInit = init;

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      workflow_name: "Gemini order lookup",
                      workflow_summary: "Looks up orders and posts an update.",
                      automation_suitability: "high",
                      recommended_approach: "Browser automation",
                      rationale: "The pattern is highly repetitive.",
                    }),
                  },
                ],
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
    workflowName: "Order lookup",
    detectionMode: "standard",
    payload: {
      workflowSteps: ["Open admin page", "Search order"],
      frequency: 6,
      averageDurationSeconds: 98,
      applications: ["chrome"],
      domains: ["admin.internal"],
    },
  });

  assert.equal(
    requestUrl,
    "https://example.test/v1beta/models/gemini-2.5-flash:generateContent",
  );
  assert.equal((requestInit?.headers as Record<string, string>)["x-goog-api-key"], "gemini-test-key");
  assert.equal(result.provider, "gemini");
  assert.equal(result.workflowName, "Gemini order lookup");
});

test("createGeminiWorkflowAnalyzer requires project id for OAuth auth", () => {
  assert.throws(
    () =>
      createGeminiWorkflowAnalyzer({
        accessToken: "oauth-token",
      }),
    /project id/,
  );
});
