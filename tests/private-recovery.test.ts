import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { Catalog, LEASE } from "../service/catalog.ts";
import { Poller } from "../service/poller.ts";
import { extractPage } from "../service/original-page.ts";
import { parseFeed } from "../service/parser.ts";
import { originalText } from "../shared/original.ts";
import { example, item, publisher, rss } from "./feeds/publisher.ts";

it("recovers saved before recent across a crash, honours retry timing and stops retrying permanent failures", async () => {
  const remote = await publisher(),
    directory = mkdtempSync(join(tmpdir(), "readingbox-recovery-")),
    file = join(directory, "db");
  let now = Date.now(),
    db = new Catalog(file);
  const options = { now: () => now, download: remote.download };
  let worker = new Poller(db, options);
  try {
    remote.routes.set("/feed", {
      body: rss(
        item("a", "/a", "Saved dispatch", "2020-01-01") +
          item("b", "/b", "Recent dispatch", "2026-11-21"),
      ),
    });
    remote.routes.set("/a", { status: 503 });
    await worker.subscribe("owner", example);
    const [recent, saved] = db.articles("owner", 10).items;
    db.requestRecovery("owner", [saved.id]);
    const interrupted = db.claimRecovery(now)!;
    expect(interrupted.id).toBe(saved.id);
    await worker.stop();
    db.close();
    db = new Catalog(file);
    worker = new Poller(db, options);
    now += LEASE + 1;
    expect(await worker.recoverOne()).toBe(true);
    expect(db.recoveryStatus("owner").counts.retry).toBe(1);
    expect(await worker.recoverOne()).toBe(true);
    expect(db.recoveryStatus("owner").counts.unavailable).toBe(1);
    expect(remote.calls.filter((c) => c.url === "/b")).toHaveLength(1);
    db.requestRecovery("owner", [saved.id]);
    expect(await worker.recoverOne()).toBe(false);
    now += 300000;
    remote.routes.set("/a", {
      headers: { "content-type": "text/html" },
      body: '<title>Saved dispatch</title><article><h1>Saved dispatch</h1><div class="entry-content"><p>First note.</p><p>Final saved passage.</p></div></article>',
    });
    await worker.recoverOne();
    expect(db.article("owner", saved.id)).toMatchObject({
      coverage: "complete",
      paragraphs: ["First note.", "Final saved passage."],
      permissions: { export: false, externalAI: false },
    });
    expect(db.recoveryStatus("owner").counts).toMatchObject({
      unavailable: 1,
      recovered: 1,
    });
    expect(db.recoveryStatus("other").counts).toEqual({});
    expect(db.article("owner", recent.id).paragraphs).toEqual([]);
    db.applyPublisherTerms(
      new Map([[new URL(example).origin, "no-retention"]]),
    );
    expect(db.article("owner", saved.id)).toMatchObject({
      paragraphs: [],
      permissions: { retain: false, export: false },
    });
  } finally {
    await worker.stop();
    db.close();
    await remote.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("reads unknown-licence syndication privately, separates CC0 backup and AI, and honours use-specific notices", () => {
  const full = (rights: string, text: string) =>
    parseFeed(
      rss(
        "<item><title>Report</title><content:encoded><![CDATA[<p>First reported passage.</p><p>" +
          text +
          "</p>]]></content:encoded></item>",
        rights,
      ),
      example,
    ).entries[0].content;
  expect(full("", "Final observation.")).toMatchObject({
    coverage: "complete",
    provenance: "publisher-feed",
    permissions: { copy: true, retain: true, export: false, externalAI: false },
  });
  const cc0 =
    '<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="license" href="https://creativecommons.org/publicdomain/zero/1.0/"/>';
  expect(full(cc0, "Final observation.").permissions).toMatchObject({
    export: true,
    externalAI: true,
    summarise: false,
  });
  expect(
    full(cc0, "NoAI. Do not copy this content.").permissions,
  ).toMatchObject({
    display: true,
    export: false,
    copy: false,
    externalAI: false,
  });
  expect(
    full("<copyright>Do not store</copyright>", "Final observation.")
      .paragraphs,
  ).toEqual([]);
  expect(full("", "Continue reading").coverage).toBe("excerpt");
});
it("extracts an ordinary blog with Readability and rejects an uncertain ending or access restriction", async () => {
  const p = await publisher();
  try {
    const input = {
      title: "Public field report",
      author: null,
      license: null,
      pageCandidate: {
        kind: "licensed" as const,
        url: example.replace("/feed", "/report"),
      },
    };
    const first =
      "The station keeper recorded the flow by the east gate twice each day. ".repeat(
        5,
      );
    const article =
      "<title>Public field report</title><main><article><h1>Public field report</h1><nav>Unrelated navigation</nav><p>" +
      first +
      "</p><blockquote>Separate observation.</blockquote><p>The final passage remains available.</p></article></main>";
    async function read(html: string) {
      p.routes.set("/report", {
        body: html,
        headers: { "content-type": "text/html" },
      });
      return (await extractPage(input, p.download)).edition!;
    }
    const result = await read(article);
    expect(result.coverage).toBe("complete");
    const text = originalText(result.document!.nodes);
    expect(text).toContain("Separate observation.");
    expect(text).toMatch(/The final passage remains available\.$/);
    expect(text).not.toContain("Unrelated navigation");
    expect(
      (
        await read(
          article.replace(
            "The final passage remains available.",
            "Continue reading",
          ),
        )
      ).coverage,
    ).toBe("excerpt");
    expect(
      (await read("<title>Public field report</title><div><p>broken")).coverage,
    ).not.toBe("complete");
    expect(
      (
        await read(
          article.replace(
            "<main>",
            '<meta name="robots" content="noarchive"><main>',
          ),
        )
      ).document,
    ).toBeUndefined();
    expect(
      (await read(article.replace("<article>", '<article class="paywall">')))
        .subscriberOnly,
    ).toBe(true);
  } finally {
    await p.close();
  }
});
