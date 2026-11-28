// Compare the released M7 and current readers on the same bytes. Output counts only.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { createDownloader } from "../../service/network.ts";
import { decodeDocument, parseFeed } from "../../service/parser.ts";
import { extractPage } from "../../service/original-page.ts";
import { debianReview } from "../../shared/reviewed-article.ts";
import type { Entry, Download, DocumentResponse } from "../../service/types.ts";

const release = "16d3007d9db59af0a73e78897a640aa56cd3f06a";
const feeds = [
  ["Debian", debianReview.feed],
  ["Creative Commons", "https://creativecommons.org/feed/"],
  [
    "USGS",
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.atom",
  ],
  ["Substack", "https://www.oneusefulthing.org/feed"],
  ["Simon Willison", "https://simonwillison.net/atom/everything/"],
  ["WordPress blog", "https://ma.tt/feed/"],
];
const download = createDownloader();
async function classify(e: Entry, extract: typeof extractPage, get: Download) {
  const c = e.content;
  if (c.coverage === "complete" && c.permissions.display)
    return {
      body: "feed",
      access: "eligible",
      ai: c.permissions.externalAI === true,
    };
  let body = c.permissions.display
    ? c.coverage === "excerpt"
      ? "excerpt"
      : "unverified"
    : "unavailable";
  let access = c.subscriberOnly
    ? "access"
    : c.pagePolicy || /no storage/.test(c.reason)
      ? "restriction"
      : "eligible";
  let ai = c.permissions.externalAI === true;
  if (c.pageCandidate && access === "eligible") {
    const result = await extract(
      { ...e, ...c, pageCandidate: c.pageCandidate },
      get,
    );
    const page = result.edition;
    if (page?.document) {
      body =
        page.coverage === "complete"
          ? "page"
          : page.coverage === "excerpt"
            ? "excerpt"
            : "unverified";
      ai = page.permissions?.externalAI === true;
    }
    if (result.issue || page?.outcome === "technical") access = "technical";
    else if (page?.subscriberOnly || page?.outcome === "access")
      access = "access";
    else if (page?.outcome === "restriction") access = "restriction";
    else if (page?.outcome === "unavailable") access = "unavailable";
  }
  return { body, access, ai };
}
const root = resolve("playwright-report");
await mkdir(root, { recursive: true });
const old = await mkdtemp(join(root, "available-"));
try {
  const archived = execFileSync("git", [
    "archive",
    release,
    "service",
    "shared",
    "package.json",
  ]);
  execFileSync("tar", ["-xf", "-", "-C", old], { input: archived });
  const legacy = (await import(
    pathToFileURL(join(old, "service/parser.ts")).href
  )) as typeof import("../../service/parser.ts");
  const pages = (await import(
    pathToFileURL(join(old, "service/original-page.ts")).href
  )) as typeof import("../../service/original-page.ts");
  for (const [label, url] of feeds) {
    try {
      const res = await download(url);
      if (res.status !== 200) throw Error("HTTP " + res.status);
      const xml = decodeDocument(res.bytes, res.headers.get("content-type"));
      const opts = {
        storeText: !/(?:no-store|noarchive|nosnippet|\bnone\b)/i.test(
          [
            res.headers.get("cache-control"),
            res.headers.get("x-robots-tag"),
          ].join(" "),
        ),
        headerDirectives: res.headers.get("x-robots-tag") ?? "",
      };
      const before = legacy.parseFeed(xml, res.url, opts),
        after = parseFeed(xml, res.url, opts);
      if (before.entries.length !== after.entries.length)
        throw Error("Feed parser counts differ");
      const n = Math.min(12, after.entries.length);
      const counts = () => ({
        feed: 0,
        page: 0,
        excerpt: 0,
        unverified: 0,
        unavailable: 0,
        access: 0,
        restriction: 0,
        technical: 0,
        eligible: 0,
        ai: 0,
        pageAttempts: 0,
      });
      const results = [counts(), counts()];
      for (let i = 0; i < n; i++) {
        const index = Math.floor((i * after.entries.length) / n);
        const cache = new Map<string, DocumentResponse>();
        const get: Download = async (u, v, p) => {
          const key = p + " " + u;
          if (cache.has(key)) return cache.get(key)!;
          await pause(1000);
          const response = await download(u, v, p);
          cache.set(key, response);
          return response;
        };
        for (const [j, row] of [
          before.entries[index],
          after.entries[index],
        ].entries()) {
          const r = await classify(
            row,
            j === 0 ? pages.extractPage : extractPage,
            get,
          );
          const c = results[j];
          c[
            r.body as "page" | "feed" | "unavailable" | "excerpt" | "unverified"
          ]++;
          if (
            r.access === "access" ||
            r.access === "restriction" ||
            r.access === "technical"
          )
            c[r.access]++;
          if (r.access !== "access" && r.access !== "restriction") c.eligible++;
          if (row.content.pageCandidate && row.content.coverage !== "complete")
            c.pageAttempts++;
          if (r.ai) c.ai++;
        }
      }
      console.log(
        "AVAILABILITY",
        JSON.stringify({
          label,
          discovered: after.entries.length,
          sampled: n,
          before: results[0],
          after: results[1],
        }),
      );
    } catch (e) {
      console.log(
        "AVAILABILITY",
        JSON.stringify({
          label,
          feedFailure: e instanceof Error ? e.message : "unreachable",
        }),
      );
    }
  }
} finally {
  await rm(old, { recursive: true, force: true });
}
