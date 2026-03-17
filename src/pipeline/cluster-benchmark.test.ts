import test from "node:test";
import assert from "node:assert/strict";

import { runClusterBenchmark } from "./cluster-benchmark.js";

test("runClusterBenchmark shows hybrid clustering reducing legacy false split and merge errors", () => {
  const result = runClusterBenchmark();

  assert.ok(result.legacy.falseSplits > 0);
  assert.ok(result.legacy.falseMerges > 0);
  assert.equal(result.hybridV2.falseSplits, 0);
  assert.equal(result.hybridV2.falseMerges, 0);
  assert.ok(result.improvementRate >= 0.5);
});
