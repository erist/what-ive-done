import assert from "node:assert/strict";
import test from "node:test";

import { shouldUseInteractiveSession } from "./interaction.js";

function createInput(isTTY: boolean): NodeJS.ReadStream {
  return {
    isTTY,
  } as NodeJS.ReadStream;
}

function createOutput(isTTY: boolean): NodeJS.WriteStream {
  return {
    isTTY,
  } as NodeJS.WriteStream;
}

test("shouldUseInteractiveSession defaults to TTY-aware prompting", () => {
  assert.equal(
    shouldUseInteractiveSession({}, createInput(true), createOutput(true)),
    true,
  );
  assert.equal(
    shouldUseInteractiveSession({}, createInput(false), createOutput(true)),
    false,
  );
});

test("shouldUseInteractiveSession honors explicit overrides", () => {
  assert.equal(
    shouldUseInteractiveSession({ nonInteractive: true }, createInput(true), createOutput(true)),
    false,
  );
  assert.equal(
    shouldUseInteractiveSession({ interactive: true }, createInput(false), createOutput(false)),
    true,
  );
  assert.throws(
    () => shouldUseInteractiveSession({ interactive: true, nonInteractive: true }),
    /Cannot combine --interactive and --non-interactive/u,
  );
});
