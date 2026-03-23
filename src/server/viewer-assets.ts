import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = dirname(fileURLToPath(import.meta.url));

// When running from dist/server/, built assets live at ../web/.
// When running from src/server/ via tsx, fall back to ../../dist/web/.
// We check for viewer.js (a build artifact) rather than index.html (which exists in src/web/ too).
const distWebDir = existsSync(resolve(thisDir, "../web/viewer.js"))
  ? resolve(thisDir, "../web")
  : resolve(thisDir, "../../dist/web");

let cachedHtml: string | undefined;
let cachedCss: string | undefined;
let cachedJs: string | undefined;

function loadAsset(filename: string): string {
  return readFileSync(resolve(distWebDir, filename), "utf-8");
}

export function renderViewerHtml(options: { viewerActionToken?: string | undefined } = {}): string {
  if (!cachedHtml) {
    cachedHtml = loadAsset("index.html");
  }
  return cachedHtml.replace("{{VIEWER_ACTION_TOKEN}}", options.viewerActionToken ?? "");
}

export function renderViewerCss(): string {
  if (!cachedCss) {
    cachedCss = loadAsset("viewer.css");
  }
  return cachedCss;
}

export function renderViewerJs(): string {
  if (!cachedJs) {
    cachedJs = loadAsset("viewer.js");
  }
  return cachedJs;
}
