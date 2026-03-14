import { readFileSync } from "node:fs";
import { extname } from "node:path";

import type { RawEventInput } from "../domain/types.js";
import { coerceIncomingEvent, coerceIncomingEvents } from "../server/ingest.js";

function parseJsonContent(content: string): RawEventInput[] {
  return coerceIncomingEvents(JSON.parse(content));
}

function parseNdjsonContent(content: string): RawEventInput[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => coerceIncomingEvent(JSON.parse(line)));
}

export function parseImportedEvents(content: string, fileName = "events.ndjson"): RawEventInput[] {
  const trimmed = content.trim();

  if (trimmed.length === 0) {
    return [];
  }

  const extension = extname(fileName).toLowerCase();

  if (extension === ".json") {
    return parseJsonContent(trimmed);
  }

  if (extension === ".ndjson" || extension === ".jsonl") {
    return parseNdjsonContent(trimmed);
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseJsonContent(trimmed);
  }

  return parseNdjsonContent(trimmed);
}

export function importEventsFromFile(filePath: string): RawEventInput[] {
  const content = readFileSync(filePath, "utf8");

  return parseImportedEvents(content, filePath);
}
