import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { get as httpGet, type IncomingMessage } from "node:http";
import { get as httpsGet } from "node:https";
import { isIP } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import ipaddr from "ipaddr.js";
import { substackHost } from "./private-policy.ts";
import robotsParser from "robots-parser";
import {
  FeedError,
  publisherError,
  type Download,
  type Validators,
} from "./types.ts";

export const MAX_BYTES = 4 * 1024 * 1024;
const agentName = "ReadingBox";
const badUrl = () =>
  new FeedError(
    "public_url_required",
    "Enter a public HTTP or HTTPS URL without credentials, using its standard port.",
  );
const tooLarge = () =>
  new FeedError(
    "too_large",
    "The publisher response exceeded the feed size limit.",
  );

export function publicAddress(address: string) {
  if (!ipaddr.isValid(address)) return false;
  const ip = ipaddr.parse(address);
  return (
    ip.range() === "unicast" &&
    (ip.kind() === "ipv4" || (ip.toByteArray()[0] & 0xe0) === 0x20)
  );
}

export function publicUrl(input: string, base?: string) {
  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    throw badUrl();
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    throw badUrl();
  }
  if (
    url.href.length > 4096 ||
    !["http:", "https:"].includes(url.protocol) ||
    url.port ||
    url.username ||
    url.password ||
    (isIP(host)
      ? !publicAddress(host)
      : !host.includes(".") ||
        /(?:^|\.)(?:localhost|local|internal|home|lan|invalid|onion)$/.test(
          host,
        )) ||
    [...url.searchParams.keys()].some((k) =>
      /(?:^|[-_])(token|key|apikey|auth|authorization|credential|session(?:id)?|bearer|accesskey|signature|secret|password|jwt|sig)(?:$|[-_])/i.test(
        k.replace(/([a-z])([A-Z])/g, "$1_$2"),
      ),
    ) ||
    /\/(?:feed\/private|private\/feed)(?:\/|$)/i.test(path)
  )
    throw badUrl();
  if (url.hostname.endsWith(".")) url.hostname = host;
  return url;
}

export function subscriptionUrl(input: string) {
  let value = input.trim();
  if (/^[a-z0-9-]+\.substack\.com\/?$/i.test(value)) value = "https://" + value;
  const url = publicUrl(value);
  if (url.hostname.endsWith(".substack.com") && url.pathname === "/")
    url.pathname = "/feed";
  url.hash = "";
  return url.href;
}

export type Wire = (
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  limit: number,
) => Promise<{ status: number; headers: Headers; bytes: Uint8Array }>;

export async function pinnedAddress(
  host: string,
  signal: AbortSignal,
  addresses = (name: string) => lookup(name, { all: true, verbatim: true }),
) {
  if (isIP(host)) {
    if (!publicAddress(host)) throw badUrl();
    return { address: host, family: isIP(host) };
  }
  const records = await new Promise<LookupAddress[]>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.throwIfAborted();
    signal.addEventListener("abort", abort, { once: true });
    addresses(host)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
  if (!records.length || records.some((r) => !publicAddress(r.address)))
    throw badUrl();
  return records.find((r) => r.family === 4) ?? records[0];
}

export const requestPublic: Wire = async (url, headers, signal, limit) => {
  const endpoint = await pinnedAddress(
    url.hostname.replace(/^\[|\]$/g, ""),
    signal,
  );
  const get = url.protocol === "https:" ? httpsGet : httpGet;
  // Pin the validated address for this socket. URL hostname still supplies Host and TLS SNI.
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = get(
      url,
      {
        headers,
        agent: false,
        family: endpoint.family,
        signal,
        lookup: (_hostname, _options, callback) =>
          callback(null, endpoint.address, endpoint.family),
        maxHeaderSize: 32768,
      },
      resolve,
    );
    request.on("error", reject);
  });
  return readResponse(response, limit);
};

export async function readResponse(response: IncomingMessage, limit: number) {
  try {
    const status = response.statusCode ?? 502;
    const fields = new Headers();
    for (const name of [
      "location",
      "etag",
      "last-modified",
      "cache-control",
      "expires",
      "age",
      "content-type",
      "x-robots-tag",
      "retry-after",
    ]) {
      const value = response.headers[name];
      if (typeof value === "string") fields.set(name, value);
    }
    if (status !== 200)
      return { status, headers: fields, bytes: Buffer.alloc(0) };
    if (Number(response.headers["content-length"]) > limit) throw tooLarge();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const part of response) {
      size += part.length;
      if (size > limit) throw tooLarge();
      chunks.push(part);
    }
    let bytes: Uint8Array = Buffer.concat(chunks);
    const encoding = response.headers["content-encoding"]?.toLowerCase();
    if (encoding && encoding !== "identity") {
      const decompress = {
        br: brotliDecompressSync,
        gzip: gunzipSync,
        deflate: inflateSync,
      }[encoding];
      if (!decompress)
        throw new FeedError("encoding", "Unsupported publisher compression.");
      try {
        bytes = decompress(bytes, { maxOutputLength: limit });
      } catch {
        throw new FeedError(
          "encoding",
          "Invalid or oversized compressed feed.",
        );
      }
    }
    return { status, headers: fields, bytes };
  } finally {
    response.destroy();
  }
}

export function createDownloader(
  wire: Wire = requestPublic,
  now = Date.now,
  deadlineMs = 15000,
  terms: ReadonlyMap<string, string> = new Map(),
): Download {
  const robots = new Map<
    string,
    { until: number; rules: ReturnType<typeof robotsParser> }
  >();
  const cooldowns = new Map<string, FeedError>();
  async function checkRobots(
    url: URL,
    signal: AbortSignal,
    purpose?: "page" | "image",
  ) {
    let cached = robots.get(url.origin);
    if (!cached || cached.until <= now()) {
      const path = new URL("/robots.txt", url).href;
      const response = await chain(path, signal, undefined, true, purpose);
      if (
        response.status !== 200 &&
        response.status !== 404 &&
        response.status !== 410
      )
        throw publisherError(response.status, response.headers, now());
      const rules = robotsParser(
        path,
        new TextDecoder().decode(response.bytes),
      );
      cached = { until: now() + 3600000, rules };
      if (robots.size >= 256) robots.delete(robots.keys().next().value!);
      robots.set(url.origin, cached);
    }
    if (cached.rules.isAllowed(url.href, agentName) === false)
      throw new FeedError(
        "robots_denied",
        "The publisher’s robots policy disallows this feed.",
      );
  }
  async function chain(
    start: string,
    signal: AbortSignal,
    validators?: Validators,
    readingRobots = false,
    purpose?: "page" | "image",
  ) {
    let url = publicUrl(start);
    const aliases = [url.href];
    let permanent = true;
    for (let hop = 0; hop <= 5; hop++) {
      signal.throwIfAborted();
      if (purpose && !readingRobots && terms.has(url.origin))
        throw new FeedError(
          "terms_denied",
          "Publisher terms prohibit automated retrieval of this page.",
        );
      const throttled = cooldowns.get(url.origin);
      if (throttled?.retryAt && throttled.retryAt > now()) throw throttled;
      cooldowns.delete(url.origin);
      if (!readingRobots) await checkRobots(url, signal, purpose);
      const headers: Record<string, string> = {
        "user-agent": agentName + "/1.0",
        accept: readingRobots
          ? "text/plain"
          : purpose === "image"
            ? "image/png"
            : purpose === "page"
              ? "text/html"
              : "application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.5",
        "accept-encoding": "gzip, deflate, br",
      };
      if (validators?.url === url.href) {
        if (validators.etag) headers["if-none-match"] = validators.etag;
        if (validators.modified)
          headers["if-modified-since"] = validators.modified;
      }
      const result = await wire(
        url,
        headers,
        signal,
        readingRobots
          ? 512 * 1024
          : purpose === "image"
            ? 96 * 1024
            : MAX_BYTES,
      );
      if (result.status === 429 || result.status === 503) {
        const failure = publisherError(result.status, result.headers, now());
        if (failure.retryAt) {
          if (cooldowns.size >= 256)
            cooldowns.delete(cooldowns.keys().next().value!);
          cooldowns.set(url.origin, failure);
        }
        throw failure;
      }
      if (![301, 302, 303, 307, 308].includes(result.status))
        return { ...result, url: url.href, aliases };
      if (purpose === "image" && !readingRobots)
        throw new FeedError(
          "page_redirect",
          "The publisher redirected the reviewed resource. Open it at the publisher.",
        );
      const location = result.headers.get("location");
      if (!location) break;
      const next = publicUrl(location, url.href);
      if (purpose === "image" && next.origin !== url.origin) throw badUrl();
      if (purpose === "page" && substackHost(next.href))
        throw new FeedError(
          "terms_denied",
          "Substack limits automated page retrieval.",
        );
      if (url.protocol === "https:" && next.protocol === "http:")
        throw badUrl();
      next.hash = "";
      permanent = permanent && [301, 308].includes(result.status);
      if (permanent) aliases.push(next.href);
      url = next;
    }
    throw new FeedError(
      "redirect",
      "Publisher redirected too many times or omitted a destination.",
    );
  }
  return async (url, validators, purpose) => {
    const signal = AbortSignal.timeout(deadlineMs);
    try {
      return await chain(url, signal, validators, false, purpose);
    } catch (err) {
      if (err instanceof FeedError) throw err;
      throw new FeedError(
        signal.aborted ? "timeout" : "unreachable",
        signal.aborted
          ? "Publisher timed out."
          : "Could not connect securely to the publisher.",
        502,
      );
    }
  };
}
