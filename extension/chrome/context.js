(() => {
  const UUID_LIKE_SEGMENT =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const LONG_HEX_SEGMENT = /^[0-9a-f]{12,}$/i;
  const NUMERIC_SEGMENT = /^\d+$/;
  const LONG_OPAQUE_SEGMENT = /^[A-Za-z0-9_-]{16,}$/;
  const DOCUMENT_TYPE_HASH_LENGTH = 24;

  function compactObject(value) {
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== undefined),
    );
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function safeDomain(urlString) {
    if (!urlString) {
      return undefined;
    }

    try {
      return new URL(urlString).hostname.toLowerCase();
    } catch {
      return undefined;
    }
  }

  function sanitizeUrl(urlString) {
    if (!urlString) {
      return undefined;
    }

    try {
      const url = new URL(urlString);
      url.username = "";
      url.password = "";
      url.hash = "";
      return url.toString();
    } catch {
      return undefined;
    }
  }

  function normalizePathSegment(segment) {
    const decoded = safeDecode(segment).trim();

    if (!decoded) {
      return "segment";
    }

    if (NUMERIC_SEGMENT.test(decoded)) {
      return "{id}";
    }

    if (UUID_LIKE_SEGMENT.test(decoded)) {
      return "{uuid}";
    }

    if (LONG_HEX_SEGMENT.test(decoded)) {
      return "{id}";
    }

    const suffix = decoded.split(/[-_]/).filter(Boolean).at(-1);
    const looksOpaqueSegment =
      LONG_OPAQUE_SEGMENT.test(decoded) &&
      (/\d/.test(decoded) || /[a-z]/.test(decoded) && /[A-Z]/.test(decoded) || !/[-_]/.test(decoded));
    const looksOpaqueSuffix =
      Boolean(suffix) &&
      LONG_OPAQUE_SEGMENT.test(suffix) &&
      (/\d/.test(suffix) || /[a-z]/.test(suffix) && /[A-Z]/.test(suffix) || !/[-_]/.test(suffix));

    if (looksOpaqueSegment || looksOpaqueSuffix) {
      return "{id}";
    }

    const normalized = decoded
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    return normalized || "segment";
  }

  function extractHashRoute(url) {
    const hash = url.hash || "";

    if (!hash.startsWith("#")) {
      return undefined;
    }

    let normalized = hash.slice(1);

    if (normalized.startsWith("!")) {
      normalized = normalized.slice(1);
    }

    normalized = normalized.split("?", 1)[0] || "";

    if (!normalized) {
      return undefined;
    }

    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }

  function toNormalizedSegments(pathname) {
    return pathname
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => normalizePathSegment(segment));
  }

  function formatRouteTemplate(segments) {
    return segments.length === 0 ? "/" : `/${segments.join("/")}`;
  }

  function deriveRouteTaxonomy(urlString) {
    if (!urlString) {
      return undefined;
    }

    try {
      const url = new URL(urlString);
      const hashRoute = extractHashRoute(url);
      const source = hashRoute ? "hash" : "pathname";
      const segments = toNormalizedSegments(hashRoute || url.pathname);
      const routeTemplate = formatRouteTemplate(segments);

      return compactObject({
        source,
        signature: `${source}:${routeTemplate}`,
        routeTemplate,
        depth: segments.length,
        primarySection: segments[0],
        secondarySection: segments[1],
        leafSection: segments[segments.length - 1],
        dynamicSegmentCount: segments.filter((segment) => segment.startsWith("{")).length,
      });
    } catch {
      return undefined;
    }
  }

  function bucketCount(count) {
    if (count <= 0) {
      return "0";
    }

    if (count === 1) {
      return "1";
    }

    if (count <= 4) {
      return "2_4";
    }

    if (count <= 9) {
      return "5_9";
    }

    return "10_plus";
  }

  function queryAll(documentLike, selector) {
    return Array.from(documentLike.querySelectorAll(selector));
  }

  function hasSelector(documentLike, selector) {
    return Boolean(documentLike.querySelector(selector));
  }

  function buildDocumentTypeDescriptor(documentLike) {
    const inputKinds = [...new Set(
      queryAll(documentLike, "input")
        .map((input) => normalizePathSegment(input.type || "text"))
        .slice(0, 12),
    )].sort();
    const landmarks = ["main", "nav", "aside", "article", "section", "dialog"]
      .filter((selector) => hasSelector(documentLike, selector))
      .sort();

    return JSON.stringify({
      contentType: documentLike.contentType || "unknown",
      compatMode: documentLike.compatMode || "unknown",
      doctype: documentLike.doctype?.name || "unknown",
      landmarks,
      counts: {
        forms: bucketCount(documentLike.forms?.length || 0),
        tables: bucketCount(queryAll(documentLike, "table").length),
        buttons: bucketCount(queryAll(documentLike, "button, [role='button']").length),
        links: bucketCount(queryAll(documentLike, "a[href]").length),
        inputs: bucketCount(queryAll(documentLike, "input, textarea, select").length),
        headings: bucketCount(queryAll(documentLike, "h1, h2, h3").length),
      },
      inputKinds,
      hasFileInput: hasSelector(documentLike, "input[type='file']"),
      hasRichText: hasSelector(documentLike, "[contenteditable='true'], [role='textbox']"),
    });
  }

  async function deriveDocumentTypeHash(documentLike) {
    const descriptor = buildDocumentTypeDescriptor(documentLike);
    const encoded = new TextEncoder().encode(descriptor);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);

    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, DOCUMENT_TYPE_HASH_LENGTH);
  }

  function buildBrowserContext(input = {}) {
    const dwell = input.dwell
      ? compactObject({
          durationMs:
            typeof input.dwell.durationMs === "number" && Number.isFinite(input.dwell.durationMs)
              ? Math.max(0, Math.round(input.dwell.durationMs))
              : undefined,
          startedAt: input.dwell.startedAt,
          endedAt: input.dwell.endedAt,
          reason: input.dwell.reason,
        })
      : undefined;
    const tabOrder = input.tabOrder
      ? compactObject({
          globalSequence: input.tabOrder.globalSequence,
          windowSequence: input.tabOrder.windowSequence,
          tabIndex: input.tabOrder.tabIndex,
          previousTabId: input.tabOrder.previousTabId,
          windowId: input.tabOrder.windowId,
        })
      : undefined;

    return compactObject({
      routeTaxonomy: input.routeTaxonomy,
      documentTypeHash: input.documentTypeHash,
      tabOrder,
      dwell: dwell && Object.keys(dwell).length > 0 ? dwell : undefined,
      signalOnly: input.signalOnly === true ? true : undefined,
    });
  }

  globalThis.WhatIveDoneChromeContext = {
    safeDomain,
    sanitizeUrl,
    deriveRouteTaxonomy,
    buildDocumentTypeDescriptor,
    deriveDocumentTypeHash,
    buildBrowserContext,
  };
})();
