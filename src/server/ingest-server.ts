import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { resolveAppPaths } from "../app-paths.js";
import { parseReportWindow } from "../reporting/windows.js";
import { AppDatabase } from "../storage/database.js";
import { buildViewerDashboard, getViewerSessionDetail } from "../viewer/service.js";
import { coerceIncomingEvents } from "./ingest.js";
import { renderViewerCss, renderViewerHtml, renderViewerJs } from "./viewer-assets.js";

export interface IngestServerOptions {
  dataDir?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
}

export interface RunningIngestServer {
  host: string;
  port: number;
  viewerUrl: string;
  close: () => Promise<void>;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
};

const CSS_HEADERS = {
  "Content-Type": "text/css; charset=utf-8",
};

const JS_HEADERS = {
  "Content-Type": "text/javascript; charset=utf-8",
};

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  payload: string,
  headers: Record<string, string>,
): void {
  response.writeHead(statusCode, headers);
  response.end(payload);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString("utf8");

  if (!body) {
    return {};
  }

  return JSON.parse(body);
}

export async function startIngestServer(options: IngestServerOptions = {}): Promise<RunningIngestServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4318;
  const database = new AppDatabase(resolveAppPaths(options.dataDir));
  database.initialize();

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
    const sessionPathMatch = requestUrl.pathname.match(/^\/api\/viewer\/sessions\/([^/]+)$/u);

    if (request.method === "OPTIONS") {
      response.writeHead(204, JSON_HEADERS);
      response.end();
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/health") {
      const currentAddress = server.address();
      const viewerPort =
        currentAddress && typeof currentAddress !== "string" ? currentAddress.port : port;

      sendJson(response, 200, {
        status: "ok",
        databasePath: database.paths.databasePath,
        viewerUrl: `http://${host}:${viewerPort}/`,
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/") {
      sendText(response, 200, renderViewerHtml(), HTML_HEADERS);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/viewer.css") {
      sendText(response, 200, renderViewerCss(), CSS_HEADERS);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/viewer.js") {
      sendText(response, 200, renderViewerJs(), JS_HEADERS);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/viewer/dashboard") {
      try {
        const windowValue = requestUrl.searchParams.get("window");
        const reportWindow = windowValue ? parseReportWindow(windowValue) : "day";
        const reportDate = requestUrl.searchParams.get("date") ?? undefined;

        sendJson(
          response,
          200,
          buildViewerDashboard(database, {
            dataDir: options.dataDir,
            window: reportWindow,
            date: reportDate,
          }),
        );
      } catch (error) {
        sendJson(response, 400, {
          status: "error",
          message: error instanceof Error ? error.message : "Unknown viewer dashboard error",
        });
      }

      return;
    }

    if (request.method === "GET" && sessionPathMatch) {
      try {
        const sessionId = decodeURIComponent(sessionPathMatch[1] ?? "");
        const windowValue = requestUrl.searchParams.get("window");
        const reportWindow = windowValue ? parseReportWindow(windowValue) : "day";
        const reportDate = requestUrl.searchParams.get("date") ?? undefined;
        const session = getViewerSessionDetail(database, sessionId, {
          dataDir: options.dataDir,
          window: reportWindow,
          date: reportDate,
        });

        if (!session) {
          sendJson(response, 404, {
            status: "not_found",
            sessionId,
          });
          return;
        }

        sendJson(response, 200, session);
      } catch (error) {
        sendJson(response, 400, {
          status: "error",
          message: error instanceof Error ? error.message : "Unknown viewer session error",
        });
      }

      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/events") {
      try {
        const payload = await readJsonBody(request);
        const events = coerceIncomingEvents(payload);

        for (const event of events) {
          database.insertRawEvent(event);
        }

        sendJson(response, 202, {
          status: "accepted",
          ingested: events.length,
        });
      } catch (error) {
        sendJson(response, 400, {
          status: "error",
          message: error instanceof Error ? error.message : "Unknown ingest error",
        });
      }

      return;
    }

    sendJson(response, 404, {
      status: "not_found",
      path: requestUrl.pathname,
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve ingest server address");
  }

  return {
    host,
    port: address.port,
    viewerUrl: `http://${host}:${address.port}/`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      database.close();
    },
  };
}
