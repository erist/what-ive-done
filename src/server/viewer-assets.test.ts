import assert from "node:assert/strict";
import test from "node:test";

import { renderViewerHtml, renderViewerJs } from "./viewer-assets.js";

test("renderViewerHtml exposes the feedback review surface", () => {
  const html = renderViewerHtml();

  assert.match(html, /Feedback Queue/u);
  assert.match(html, /Comparison View/u);
  assert.match(html, /comparison-view/u);
  assert.match(html, /feedback-workflow-list/u);
  assert.match(html, /workflow-detail/u);
});

test("renderViewerJs returns parseable browser script", () => {
  assert.doesNotThrow(() => {
    new Function(renderViewerJs());
  });
});
