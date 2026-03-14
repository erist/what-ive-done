import test from "node:test";
import assert from "node:assert/strict";

import { createMacOSCollectorRunner } from "./macos.js";

test("macOS collector runner parses permission status output", () => {
  const runner = createMacOSCollectorRunner(() => ({
    status: 0,
    stdout: JSON.stringify({
      collector: "macos-active-window",
      platform: "macos",
      accessibilityTrusted: true,
      windowTitleAvailable: true,
      frontmostApplicationAvailable: true,
      systemSettingsPath: "System Settings > Privacy & Security > Accessibility",
    }),
    stderr: "",
  }));

  const result = runner.getPermissionStatus();

  assert.equal(result.collector, "macos-active-window");
  assert.equal(result.accessibilityTrusted, true);
  assert.equal(result.windowTitleAvailable, true);
});

test("macOS collector runner parses a one-shot event payload", () => {
  const runner = createMacOSCollectorRunner(() => ({
    status: 0,
    stdout:
      '{"source":"desktop","sourceEventType":"app.switch","timestamp":"2026-03-14T09:00:00.000Z","application":"chrome","action":"switch","metadata":{"collector":"macos-active-window","platform":"macos"}}\n',
    stderr: "collector started\n",
  }));

  const event = runner.captureOnce();

  assert.equal(event.source, "desktop");
  assert.equal(event.application, "chrome");
  assert.equal(event.sourceEventType, "app.switch");
});

test("macOS collector runner surfaces command failures", () => {
  const runner = createMacOSCollectorRunner(() => ({
    status: 1,
    stdout: "",
    stderr: "permission denied",
  }));

  assert.throws(() => runner.captureOnce(), /permission denied/u);
});
