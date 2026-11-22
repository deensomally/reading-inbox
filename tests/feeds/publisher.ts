import { createServer, get, type IncomingMessage } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import {
  createDownloader,
  readResponse,
  type Wire,
} from "../../service/network.ts";

export const cc = "https://creativecommons.org/feed/";
export const usgs =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.atom";
export const substack = "https://www.oneusefulthing.org/feed";
export const example = "https://publisher.example.org/feed";
export const fixture = (name: string) =>
  readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
export const rss = (items: string, extra = "") =>
  '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Field reports</title>' +
  extra +
  items +
  "</channel></rss>";
export const item = (
  id: string,
  url: string,
  title: string,
  date = "2026-11-01",
) =>
  "<item>" +
  (id ? '<guid isPermaLink="false">' + id + "</guid>" : "") +
  (url ? "<link>" + url + "</link>" : "") +
  "<title>" +
  title +
  "</title><pubDate>" +
  date +
  "</pubDate></item>";

type ResponseSpec = {
  status?: number;
  body?: string | Buffer;
  headers?: Record<string, string>;
  wait?: Promise<void>;
};
export async function publisher() {
  const routes = new Map<string, ResponseSpec>(),
    calls: { url: string; headers: IncomingMessage["headers"] }[] = [];
  const server = createServer(async (req, res) => {
    const url = req.url!;
    calls.push({ url, headers: req.headers });
    const route = routes.get(url) ?? { status: 404 };
    await route.wait;
    res.writeHead(route.status ?? 200, {
      "content-type": "application/xml",
      ...route.headers,
    });
    res.end(route.body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No test port");
  const origin = "http://127.0.0.1:" + address.port;
  // Only this test transport substitutes a disposable origin. Parsing, decompression,
  // robots, redirect policy and conditional headers go through the service code.
  const wire: Wire = async (url, headers, signal, limit) => {
    const response = await new Promise<IncomingMessage>((resolve, reject) =>
      get(origin + url.pathname + url.search, { headers, signal }, resolve).on(
        "error",
        reject,
      ),
    );
    return readResponse(response, limit);
  };
  return {
    routes,
    calls,
    wire,
    download: createDownloader(wire),
    async close() {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
