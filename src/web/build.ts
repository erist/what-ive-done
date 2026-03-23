import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const projectRoot = resolve(import.meta.dirname, "../..");
const webRoot = resolve(import.meta.dirname);
const outDir = resolve(projectRoot, "dist/web");

mkdirSync(outDir, { recursive: true });

const isWatch = process.argv.includes("--watch");

async function build() {
  // Bundle TypeScript
  const jsResult = await esbuild.build({
    entryPoints: [resolve(webRoot, "app.ts")],
    bundle: true,
    format: "iife",
    target: "es2023",
    outfile: resolve(outDir, "viewer.js"),
    minify: !isWatch,
    sourcemap: isWatch ? "inline" : false,
    logLevel: "info",
  });

  // Bundle CSS
  const cssFiles = [
    "styles/tokens.css",
    "styles/reset.css",
    "styles/layout.css",
    "styles/components.css",
    "styles/views.css",
  ];

  const cssContent = cssFiles
    .map((file) => readFileSync(resolve(webRoot, file), "utf-8"))
    .join("\n");

  writeFileSync(resolve(outDir, "viewer.css"), cssContent);

  // Copy HTML template
  const html = readFileSync(resolve(webRoot, "index.html"), "utf-8");
  writeFileSync(resolve(outDir, "index.html"), html);

  console.log("Web build complete.");
}

if (isWatch) {
  const ctx = await esbuild.context({
    entryPoints: [resolve(webRoot, "app.ts")],
    bundle: true,
    format: "iife",
    target: "es2023",
    outfile: resolve(outDir, "viewer.js"),
    sourcemap: "inline",
    logLevel: "info",
  });

  await ctx.watch();
  console.log("Watching for changes...");

  // Initial CSS + HTML build
  await build();
} else {
  await build();
}
