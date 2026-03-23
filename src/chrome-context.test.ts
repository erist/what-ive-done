import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error extension asset is loaded directly for collector contract tests
await import("../extension/chrome/context.js");

interface ChromeContextApi {
  deriveRouteTaxonomy(url: string): Record<string, unknown> | undefined;
  deriveDocumentTypeHash(documentLike: unknown): Promise<string>;
  buildBrowserContext(input?: Record<string, unknown>): Record<string, unknown>;
}

function chromeContextApi(): ChromeContextApi {
  return (globalThis as typeof globalThis & {
    WhatIveDoneChromeContext: ChromeContextApi;
  }).WhatIveDoneChromeContext;
}

function createFakeDocument(options: {
  tables?: number;
  buttons?: number;
  links?: number;
  inputs?: string[];
  forms?: number;
  headings?: number;
  hasMain?: boolean;
  hasRichText?: boolean;
  hasFileInput?: boolean;
}) {
  const selectors = new Map<string, unknown[]>([
    ["table", Array.from({ length: options.tables ?? 0 }, () => ({}))],
    ["button, [role='button']", Array.from({ length: options.buttons ?? 0 }, () => ({}))],
    ["a[href]", Array.from({ length: options.links ?? 0 }, () => ({}))],
    [
      "input",
      (options.inputs ?? []).map((type) => ({
        type,
      })),
    ],
    [
      "input, textarea, select",
      (options.inputs ?? []).map((type) => ({
        type,
      })),
    ],
    ["h1, h2, h3", Array.from({ length: options.headings ?? 0 }, () => ({}))],
    ["main", options.hasMain ? [{}] : []],
    ["input[type='file']", options.hasFileInput ? [{}] : []],
    ["[contenteditable='true'], [role='textbox']", options.hasRichText ? [{}] : []],
  ]);

  return {
    contentType: "text/html",
    compatMode: "CSS1Compat",
    doctype: {
      name: "html",
    },
    forms: Array.from({ length: options.forms ?? 0 }, () => ({})),
    querySelectorAll(selector: string) {
      return selectors.get(selector) ?? [];
    },
    querySelector(selector: string) {
      return (selectors.get(selector) ?? [])[0] ?? null;
    },
  };
}

test("deriveRouteTaxonomy captures hash-based SPA routes without raw ids", () => {
  const routeTaxonomy = chromeContextApi().deriveRouteTaxonomy(
    "https://workspace.example.com/#/orders/123/edit?tab=history",
  );

  assert.deepEqual(routeTaxonomy, {
    source: "hash",
    signature: "hash:/orders/{id}/edit",
    routeTemplate: "/orders/{id}/edit",
    depth: 3,
    primarySection: "orders",
    secondarySection: "{id}",
    leafSection: "edit",
    dynamicSegmentCount: 1,
  });
});

test("deriveRouteTaxonomy accepts hash routes without a leading slash and normalizes opaque ids", () => {
  const routeTaxonomy = chromeContextApi().deriveRouteTaxonomy(
    "https://mail.google.com/mail/u/0/#inbox/FMfcgzQbdrjVCmfjprgSrLxwNfwbmQhH",
  );

  assert.deepEqual(routeTaxonomy, {
    source: "hash",
    signature: "hash:/inbox/{id}",
    routeTemplate: "/inbox/{id}",
    depth: 2,
    primarySection: "inbox",
    secondarySection: "{id}",
    leafSection: "{id}",
    dynamicSegmentCount: 1,
  });
});

test("deriveDocumentTypeHash stays stable for the same document shape", async () => {
  const firstHash = await chromeContextApi().deriveDocumentTypeHash(
    createFakeDocument({
      forms: 1,
      tables: 1,
      buttons: 3,
      links: 5,
      inputs: ["text", "file"],
      headings: 2,
      hasMain: true,
      hasFileInput: true,
    }),
  );
  const secondHash = await chromeContextApi().deriveDocumentTypeHash(
    createFakeDocument({
      forms: 1,
      tables: 1,
      buttons: 3,
      links: 5,
      inputs: ["text", "file"],
      headings: 2,
      hasMain: true,
      hasFileInput: true,
    }),
  );
  const thirdHash = await chromeContextApi().deriveDocumentTypeHash(
    createFakeDocument({
      forms: 0,
      tables: 0,
      buttons: 1,
      links: 1,
      inputs: ["text"],
      headings: 1,
      hasMain: false,
      hasRichText: true,
    }),
  );

  assert.equal(firstHash.length, 24);
  assert.equal(firstHash, secondHash);
  assert.notEqual(firstHash, thirdHash);
});

test("buildBrowserContext omits undefined fields from the collector payload", () => {
  const browserContext = chromeContextApi().buildBrowserContext({
    routeTaxonomy: {
      source: "pathname",
      signature: "pathname:/orders",
    },
    tabOrder: {
      globalSequence: 3,
      windowSequence: 2,
    },
  });

  assert.deepEqual(browserContext, {
    routeTaxonomy: {
      source: "pathname",
      signature: "pathname:/orders",
    },
    tabOrder: {
      globalSequence: 3,
      windowSequence: 2,
    },
  });
});
