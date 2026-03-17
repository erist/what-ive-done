import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { resolveAppPaths } from "../app-paths.js";
import { saveWorkflowReview } from "../feedback/service.js";
import { parseReportWindow } from "../reporting/windows.js";
import { AppDatabase } from "../storage/database.js";
import {
  buildViewerDashboard,
  getViewerSessionDetail,
  getViewerWorkflowDetail,
} from "../viewer/service.js";
import { coerceIncomingEvents } from "./ingest.js";
import {
  buildIngestSecurityState,
  DEFAULT_INGEST_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_INGEST_RATE_LIMIT_WINDOW_MS,
  ensureIngestAuthToken,
  extractIngestAuthToken,
  InMemoryRateLimiter,
  resolveLocalOnlyHost,
  type IngestSecurityState,
} from "./security.js";
import { renderViewerCss, renderViewerHtml, renderViewerJs } from "./viewer-assets.js";

export interface IngestServerOptions {
  dataDir?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
  authToken?: string | undefined;
  rateLimitWindowMs?: number | undefined;
  rateLimitMaxRequests?: number | undefined;
  verbose?: boolean | undefined;
}

export interface RunningIngestServer {
  host: string;
  port: number;
  viewerUrl: string;
  authToken: string;
  security: IngestSecurityState;
  close: () => Promise<void>;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,authorization,x-what-ive-done-token",
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

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function normalizeOptionalDifficulty(value: unknown): "low" | "medium" | "high" | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function parseViewerOptions(
  requestUrl: URL,
  dataDir?: string,
): { dataDir?: string; window?: "all" | "day" | "week"; date?: string | undefined } {
  const windowValue = requestUrl.searchParams.get("window");
  const options: { dataDir?: string; window?: "all" | "day" | "week"; date?: string | undefined } = {
    window: windowValue ? parseReportWindow(windowValue) : "day",
  };
  const date = requestUrl.searchParams.get("date");

  if (dataDir) {
    options.dataDir = dataDir;
  }

  if (date) {
    options.date = date;
  }

  return options;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(statusCode, {
    ...JSON_HEADERS,
    ...headers,
  });
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
  const host = resolveLocalOnlyHost(options.host);
  const port = options.port ?? 4318;
  const database = new AppDatabase(resolveAppPaths(options.dataDir));
  database.initialize();
  const authToken = ensureIngestAuthToken(database, options.authToken);
  const security = buildIngestSecurityState({
    authToken,
    rateLimitWindowMs: options.rateLimitWindowMs,
    rateLimitMaxRequests: options.rateLimitMaxRequests,
  });
  const rateLimiter = new InMemoryRateLimiter(
    security.rateLimitMaxRequests ?? DEFAULT_INGEST_RATE_LIMIT_MAX_REQUESTS,
    security.rateLimitWindowMs ?? DEFAULT_INGEST_RATE_LIMIT_WINDOW_MS,
  );
  const log = (message: string, payload?: Record<string, unknown>): void => {
    if (!options.verbose) {
      return;
    }

    const suffix = payload ? ` ${JSON.stringify(payload)}` : "";
    console.error(`[ingest] ${message}${suffix}`);
  };

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
    const sessionPathMatch = requestUrl.pathname.match(/^\/api\/viewer\/sessions\/([^/]+)$/u);
    const workflowPathMatch = requestUrl.pathname.match(/^\/api\/viewer\/workflows\/([^/]+)$/u);
    const remoteAddress = request.socket.remoteAddress ?? "unknown";

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
        security,
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
        sendJson(
          response,
          200,
          buildViewerDashboard(database, parseViewerOptions(requestUrl, options.dataDir)),
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
        const session = getViewerSessionDetail(
          database,
          sessionId,
          parseViewerOptions(requestUrl, options.dataDir),
        );

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

    if (request.method === "GET" && workflowPathMatch) {
      try {
        const workflowId = decodeURIComponent(workflowPathMatch[1] ?? "");
        const workflow = getViewerWorkflowDetail(
          database,
          workflowId,
          parseViewerOptions(requestUrl, options.dataDir),
        );

        if (!workflow) {
          sendJson(response, 404, {
            status: "not_found",
            workflowId,
          });
          return;
        }

        sendJson(response, 200, workflow);
      } catch (error) {
        sendJson(response, 400, {
          status: "error",
          message: error instanceof Error ? error.message : "Unknown viewer workflow error",
        });
      }

      return;
    }

    if (request.method === "POST" && workflowPathMatch) {
      try {
        const workflowId = decodeURIComponent(workflowPathMatch[1] ?? "");
        const body = (await readJsonBody(request)) as Record<string, unknown>;

        saveWorkflowReview(database, {
          workflowId,
          name: normalizeOptionalString(body.name),
          purpose: normalizeOptionalString(body.purpose),
          repetitive: normalizeOptionalBoolean(body.repetitive),
          automationCandidate: normalizeOptionalBoolean(body.automationCandidate),
          difficulty: normalizeOptionalDifficulty(body.difficulty),
          approvedAutomationCandidate: normalizeOptionalBoolean(body.approvedAutomationCandidate),
          excluded: normalizeOptionalBoolean(body.excluded),
          hidden: normalizeOptionalBoolean(body.hidden),
        });

        const workflow = getViewerWorkflowDetail(
          database,
          workflowId,
          parseViewerOptions(requestUrl, options.dataDir),
        );

        sendJson(response, 200, {
          status: "workflow_feedback_saved",
          workflowId,
          workflow: workflow ?? null,
        });
      } catch (error) {
        sendJson(response, 400, {
          status: "error",
          message: error instanceof Error ? error.message : "Unknown viewer feedback error",
        });
      }

      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/events") {
      try {
        const providedToken = extractIngestAuthToken(request);

        if (providedToken !== authToken) {
          log("reject_unauthorized_request", {
            remoteAddress,
            path: requestUrl.pathname,
          });
          sendJson(response, 401, {
            status: "unauthorized",
            message: "An ingest auth token is required.",
          });
          return;
        }

        const rateLimit = rateLimiter.check(remoteAddress);
        const rateLimitHeaders = {
          "X-RateLimit-Limit": String(rateLimit.limit),
          "X-RateLimit-Remaining": String(rateLimit.remaining),
          ...(rateLimit.retryAfterSeconds
            ? {
                "Retry-After": String(rateLimit.retryAfterSeconds),
              }
            : {}),
        };

        if (!rateLimit.allowed) {
          log("reject_rate_limited_request", {
            remoteAddress,
            path: requestUrl.pathname,
            retryAfterSeconds: rateLimit.retryAfterSeconds,
          });
          sendJson(
            response,
            429,
            {
              status: "rate_limited",
              message: "Too many ingest requests. Please retry shortly.",
            },
            rateLimitHeaders,
          );
          return;
        }

        const payload = await readJsonBody(request);
        const events = coerceIncomingEvents(payload);

        for (const event of events) {
          database.insertRawEvent(event);
        }

        log("accepted_events", {
          remoteAddress,
          ingested: events.length,
        });
        sendJson(
          response,
          202,
          {
            status: "accepted",
            ingested: events.length,
          },
          rateLimitHeaders,
        );
      } catch (error) {
        log("ingest_error", {
          remoteAddress,
          message: error instanceof Error ? error.message : String(error),
        });
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
    authToken,
    security,
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
