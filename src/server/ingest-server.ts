import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { resolveAppPaths } from "../app-paths.js";
import { AppDatabase } from "../storage/database.js";
import { coerceIncomingEvents } from "./ingest.js";

export interface IngestServerOptions {
  dataDir?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
}

export interface RunningIngestServer {
  host: string;
  port: number;
  close: () => Promise<void>;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(payload, null, 2));
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

    if (request.method === "OPTIONS") {
      response.writeHead(204, JSON_HEADERS);
      response.end();
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/health") {
      sendJson(response, 200, {
        status: "ok",
        databasePath: database.paths.databasePath,
      });
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
