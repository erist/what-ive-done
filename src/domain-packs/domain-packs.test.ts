import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildDomainPackCoverageReport } from "./index.js";
import { inspectDomainPackCoverage, rawEventInputsToRawEvents } from "./service.js";
import { importEventsFromFile } from "../importers/events.js";

interface DomainPackFixtureManifestEntry {
  id: string;
  file: string;
  expectedPackId: string;
  expectedMatchRate: number;
  expectedRouteFamilies: string[];
}

function resolveFixturePath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

function loadManifest(): DomainPackFixtureManifestEntry[] {
  return JSON.parse(
    readFileSync(resolveFixturePath("../../fixtures/domain-packs/manifest.json"), "utf8"),
  ) as DomainPackFixtureManifestEntry[];
}

for (const fixture of loadManifest()) {
  test(`domain pack fixture ${fixture.id} matches the expected route families`, () => {
    const rawEvents = rawEventInputsToRawEvents(
      importEventsFromFile(resolveFixturePath(`../../fixtures/domain-packs/${fixture.file}`)),
    );
    const result = inspectDomainPackCoverage(rawEvents);

    assert.equal(result.coverage.matchRate, fixture.expectedMatchRate);
    assert.ok(result.events.every((event) => event.domainPackId === fixture.expectedPackId));
    assert.deepEqual(
      result.events.map((event) => event.routeFamily),
      fixture.expectedRouteFamilies,
    );
  });
}

test("buildDomainPackCoverageReport exposes unmatched domains for diagnostics", () => {
  const report = buildDomainPackCoverageReport([
    {
      source: "chrome_extension",
      browserSchemaVersion: 2,
      domain: "admin.example.com",
      routeFamily: "makestar-admin.orders.detail",
    },
    {
      source: "chrome_extension",
      browserSchemaVersion: 2,
      domain: "admin.example.com",
    },
    {
      source: "chrome_extension",
      browserSchemaVersion: 2,
      domain: "docs.google.com",
    },
  ]);

  assert.equal(report.totalBrowserEvents, 3);
  assert.equal(report.matchedEvents, 1);
  assert.equal(report.unmatchedEvents, 2);
  assert.equal(report.domains[0]?.domain, "admin.example.com");
  assert.equal(report.domains[0]?.unmatchedEvents, 1);
  assert.equal(report.domains[1]?.domain, "docs.google.com");
  assert.equal(report.domains[1]?.unmatchedEvents, 1);
});
