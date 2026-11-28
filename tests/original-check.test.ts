import { expect, it, onTestFinished } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Catalog } from "../service/catalog.ts";
import { feedApp } from "../service/app.ts";
import { createDownloader, type Wire } from "../service/network.ts";
import type { Download } from "../service/types.ts";
import { originalText, type OriginalCheck } from "../shared/original.ts";
import { publisher } from "./feeds/publisher.ts";
import {
  addNotebook,
  diagram,
  goldenText,
  lastPassage,
  river,
  riverProof,
  sourceUrl,
} from "./originals/source.ts";

async function notebookService(
  makeDownload: (wire: Wire, now: () => number) => Download = createDownloader,
) {
  const remote = await publisher();
  addNotebook(remote);
  const directory = mkdtempSync(join(tmpdir(), "reading-box-check-"));
  let now = Date.now();
  function start() {
    const catalog = new Catalog(join(directory, "feeds.sqlite"));
    return {
      catalog,
      ...feedApp(catalog, {
        now: () => now,
        download: makeDownload(remote.wire, () => now),
        proofs: new Map([riverProof]),
      }),
    };
  }
  let service = start();
  onTestFinished(async () => {
    await service.app.close();
    await remote.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 4 });
  });
  await service.poller.subscribe("owner", sourceUrl);
  const id = service.catalog.articles("owner", 1).items[0].id;
  const headers = {
    authorization: "Bearer " + service.catalog.credential("owner"),
  };
  return {
    remote,
    get catalog() {
      return service.catalog;
    },
    advance(ms = 61000) {
      now += ms;
      return now;
    },
    async restart() {
      await service.app.close();
      service = start();
    },
    article: () => service.catalog.article("owner", id),
    checked: () => service.catalog.pageInput("owner", id).checked,
    async check() {
      const res = await service.app.inject({
        method: "POST",
        url: "/api/articles/" + id + "/original",
        headers,
      });
      expect(res.statusCode).toBe(200);
      return res.json<OriginalCheck>();
    },
  };
}

it("retains the verified edition, last check and delivery cursor through outages, restart and recovery", async () => {
  let outage: "connection" | "timeout" | undefined;
  const site = await notebookService((wire, now) => {
    const normal = createDownloader(wire, now);
    const interrupted = createDownloader(
      async (_url, _headers, signal) => {
        if (outage === "connection") throw new Error("Connection reset");
        return new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      },
      now,
      25,
    );
    return (...args) => (outage ? interrupted : normal)(...args);
  });
  // A failed first check leaves only the independently permitted feed excerpt.
  site.remote.routes.set("/river", { status: 502 });
  const excerpt = site.article();
  expect(await site.check()).toMatchObject({
    revision: excerpt.revision,
    issue: { message: "Publisher returned HTTP 502." },
  });
  expect(site.article()).toEqual(excerpt);
  expect(site.checked()).toBeNull();

  addNotebook(site.remote);
  const { revision, issue } = await site.check();
  expect(issue).toBeUndefined();
  const first = site.article(),
    checked = site.checked();
  const cursor = site.catalog.articles("owner", 1).changesCursor;
  expect(first).toMatchObject({
    revision,
    coverage: "complete",
    permissions: { display: true, retain: true, copy: true },
  });
  expect(originalText(first.document.nodes)).toBe(goldenText);
  const unchanged = () => {
    expect(site.article()).toEqual(first);
    expect(site.checked()).toBe(checked);
    expect(site.catalog.changes("owner", 10, cursor).items).toEqual([]);
  };
  const now = site.advance();
  site.remote.routes.set("/river", {
    status: 503,
    headers: { "retry-after": "30", "cache-control": "no-store" },
  });
  const busy = await site.check();
  expect(busy).toEqual({
    revision,
    issue: { message: "Publisher returned HTTP 503.", retryAt: now + 30000 },
  });
  unchanged();
  const requests = site.remote.calls.length;
  expect(await site.check()).toEqual(busy);
  expect(site.remote.calls).toHaveLength(requests);

  await site.restart();
  unchanged();
  site.advance(30001);
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    site.remote.routes.set("/river", { status });
    expect(await site.check()).toMatchObject({
      revision,
      issue: { message: "Publisher returned HTTP " + status + "." },
    });
    unchanged();
  }
  for (outage of ["connection", "timeout"] as const) {
    expect(await site.check()).toMatchObject({
      revision,
      issue: {
        message:
          outage === "timeout"
            ? "Publisher timed out."
            : "Could not connect securely to the publisher.",
      },
    });
    unchanged();
  }
  outage = undefined;
  addNotebook(site.remote);
  expect(await site.check()).toEqual({ revision });
  expect(site.checked()).toBeGreaterThan(checked);
  expect(site.article()).toEqual(first);
  expect(site.catalog.changes("owner", 10, cursor).items).toEqual([]);
});

it.each([
  ["access denied", { status: 403 }],
  ["withdrawn page", { status: 410 }],
  [
    "changed licence",
    { body: river.replaceAll("licenses/by/4.0", "licenses/by-nc/4.0") },
  ],
  ["no storage", { body: river, headers: { "cache-control": "no-store" } }],
  ["no archive", { body: river, headers: { "x-robots-tag": "noarchive" } }],
  [
    "subscriber-only page",
    { body: river.replace("<article>", '<article class="subscriber-only">') },
  ],
] as const)(
  "purges the prior page after an outage when the publisher reports %s",
  async (_, response) => {
    const site = await notebookService();
    const { revision } = await site.check();
    site.advance();
    site.remote.routes.set("/river", { status: 503 });
    expect((await site.check()).issue).toBeDefined();
    expect(site.article().paragraphs.at(-1)).toBe(lastPassage);
    site.remote.routes.set("/river", {
      ...response,
      headers: {
        "content-type": "text/html",
        ...("headers" in response ? response.headers : {}),
      },
    });
    const restricted = await site.check();
    expect(restricted.issue).toBeUndefined();
    expect(restricted.revision).not.toBe(revision);
    expect(site.article().document).toBeUndefined();
    expect(site.article().paragraphs).toEqual([
      "Morning notes from the river gauge.",
    ]);
    expect(
      site.catalog.db.prepare("SELECT body FROM page_editions").get()?.body,
    ).toBeNull();
    site.advance();
    site.remote.routes.set("/river", { status: 504 });
    expect(await site.check()).toMatchObject({
      revision: restricted.revision,
      issue: { message: "Publisher returned HTTP 504." },
    });
    expect(site.article().document).toBeUndefined();
  },
);

it("distinguishes a robots service outage from a publisher rule that disallows the page", async () => {
  const site = await notebookService();
  const { revision } = await site.check();
  site.advance(3600001);
  site.remote.routes.set("/robots.txt", { status: 502 });
  expect(await site.check()).toMatchObject({
    revision,
    issue: { message: "Publisher returned HTTP 502." },
  });
  expect(site.article().paragraphs.at(-1)).toBe(lastPassage);
  site.remote.routes.set("/robots.txt", {
    body: "User-agent: *\nDisallow: /river\n",
    headers: { "content-type": "text/plain" },
  });
  const denied = await site.check();
  expect(denied.issue).toBeUndefined();
  expect(denied.revision).not.toBe(revision);
  expect(site.article().document).toBeUndefined();
});

it("retains a licensed figure during an outage and applies newly observed article and image restrictions", async () => {
  const site = await notebookService();
  site.remote.routes.set("/gauge.png", { status: 503 });
  expect((await site.check()).issue).toBeDefined();
  expect(site.article().coverage).toBe("unverified");
  expect(JSON.stringify(site.article().document)).not.toContain(
    "data:image/png",
  );
  addNotebook(site.remote);
  const { revision } = await site.check();
  const first = site.article(),
    checked = site.checked();
  expect(first.coverage).toBe("complete");
  site.advance();
  site.remote.routes.set("/gauge.png", { status: 503 });
  expect(await site.check()).toMatchObject({
    revision,
    issue: {
      message: "Figure check unavailable. Publisher returned HTTP 503.",
    },
  });
  expect(site.article()).toEqual(first);
  expect(site.checked()).toBe(checked);
  site.remote.routes.set("/river", {
    body: river.replace(lastPassage, "A newly observed ending."),
    headers: { "content-type": "text/html" },
  });
  const amended = await site.check();
  expect(amended.issue).toBeDefined();
  expect(amended.revision).not.toBe(revision);
  expect(site.article().coverage).toBe("unverified");
  expect(site.article().paragraphs.at(-1)).toBe("A newly observed ending.");

  site.remote.routes.set("/gauge.png", {
    body: diagram,
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
  const restricted = await site.check();
  expect(restricted.issue).toBeUndefined();
  expect(restricted.revision).not.toBe(amended.revision);
  expect(JSON.stringify(site.article().document)).not.toContain(
    "data:image/png",
  );
  site.advance();
  site.remote.routes.set("/gauge.png", { status: 503 });
  expect((await site.check()).revision).toBe(restricted.revision);
  expect(JSON.stringify(site.article().document)).not.toContain(
    "data:image/png",
  );
});
