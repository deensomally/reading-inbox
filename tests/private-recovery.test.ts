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
    await worker.original("owner", recent.id);
    expect(remote.calls.filter((c) => c.url === "/b")).toHaveLength(1);
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

it("applies a new feed-wide copy and processing restriction to retained pages outside the feed window", async () => {
  const remote = await publisher();
  const db = new Catalog(":memory:");
  let now = Date.now();
  const worker = new Poller(db, { now: () => now, download: remote.download });
  try {
    const grant = "https://creativecommons.org/publicdomain/zero/1.0/";
    remote.routes.set("/feed", { body: rss(item("old", "/old", "Dispatch")) });
    remote.routes.set("/old", {
      headers: { "content-type": "text/html" },
      body:
        '<title>Dispatch</title><link rel="license" href="' +
        grant +
        '"><article><h1>Dispatch</h1><div class="entry-content"><p>Opening passage.</p><p>Closing passage.</p></div></article>',
    });
    const sub = await worker.subscribe("owner", example);
    const { id } = db.articles("owner", 10).items[0];
    await worker.original("owner", id);
    const prior = db.article("owner", id);
    expect(prior.permissions).toMatchObject({
      copy: true,
      export: true,
      externalAI: true,
    });
    remote.routes.set("/feed", {
      body: rss("", "<copyright>Do not copy. NoAI.</copyright>"),
      headers: { etag: '"narrowed"' },
    });
    now += 86400000;
    expect((await worker.refresh("owner", sub.subscription.id)).status).toBe(
      "updated",
    );
    const article = db.article("owner", id);
    expect(article).toMatchObject({
      paragraphs: prior.paragraphs,
      document: prior.document,
      permissions: {
        display: true,
        retain: true,
        copy: false,
        export: false,
        externalAI: false,
      },
    });
    expect(article.revision).not.toBe(prior.revision);
    const journal = db.articles("owner", 10).items[0];
    expect(journal.revision).toBe(article.revision);
    await worker.original("owner", id);
    expect(db.article("owner", id).permissions).toMatchObject({
      copy: false,
      export: false,
      externalAI: false,
    });
  } finally {
    await worker.stop();
    db.close();
    await remote.close();
  }
});

it("recovers a permalink's labelled release without copying the weblog navigation", async () => {
  const url = "https://simonwillison.net/2026/Nov/03/observatory/";
  const html =
    '<title>Release: Observatory 2</title><link rel="canonical" href="' +
    url +
    '"><div class="entry entryPage"><p class="mobile-date-eyebrow">Today</p><div class="beat"><p>The second release.</p><p>Its closing note.</p></div><div class="entryFooter">Related releases</div></div>';
  const read = (title: string) =>
    extractPage(
      {
        title,
        author: null,
        license: null,
        pageCandidate: { kind: "licensed", url },
      },
      async () => ({
        url,
        status: 200,
        aliases: [url],
        headers: new Headers({ "content-type": "text/html" }),
        bytes: Buffer.from(html),
      }),
    );
  const { edition } = await read("Observatory 2");
  expect(edition?.coverage).toBe("complete");
  expect(originalText(edition!.document!.nodes)).toBe(
    "The second release.\n\nIts closing note.",
  );
  expect((await read("Different release")).edition?.document).toBeUndefined();
});
it("retains Creative Commons feed text while checking for its unsyndicated header figure and credit", () => {
  const xml = rss(
    '<item><title>A dispatch</title><link>https://creativecommons.org/dispatch/</link><content:encoded><![CDATA[<p>First observation.</p><p>Last observation.</p><p>The post <a href="/">A dispatch</a> appeared first on Creative Commons.</p>]]></content:encoded></item>',
  );
  const entry = parseFeed(xml, "https://creativecommons.org/feed/").entries[0];
  expect(entry.content).toMatchObject({
    paragraphs: ["First observation.", "Last observation."],
    coverage: "unverified",
    pageCandidate: { kind: "cc-story" },
    permissions: { display: true },
  });
});

it("distinguishes a described lead illustration from a missing figure inside the article", async () => {
  const url = "https://creativecommons.org/a-field-report/";
  const image =
    '<figure><img src="/photo.jpg" alt="Portrait of the author"><figcaption>Photo by the author.</figcaption></figure>';
  const read = (header: string, inline: string) =>
    extractPage(
      {
        title: "Field report",
        author: null,
        license: null,
        pageCandidate: { kind: "cc-story", url },
      },
      async () => ({
        url,
        aliases: [url],
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        bytes: Buffer.from(
          "<title>Field report</title><main><header>" +
            header +
            '</header><div class="content"><p>First passage.</p>' +
            inline +
            '<p>Final passage.</p><p class="pub-date">Today</p></div></main>',
        ),
      }),
    );
  const { edition } = await read(image, "");
  expect(edition?.coverage).toBe("complete");
  expect(edition?.document?.limitations).toContainEqual(
    expect.stringMatching(/lead illustration is linked/),
  );
  expect(originalText(edition!.document!.nodes)).toContain(
    "Photo by the author.",
  );
  expect((await read("", image)).edition?.coverage).toBe("unverified");
});

it("distinguishes a WordPress link to the next post from a continuation of the same article", async () => {
  const url = example.replace("/feed", "/dispatch");
  const read = (navigation: string) =>
    extractPage(
      {
        title: "Dispatch",
        license: null,
        author: null,
        pageCandidate: { kind: "licensed", url },
      },
      async () => ({
        url,
        status: 200,
        aliases: [url],
        headers: new Headers({
          "content-type": "text/html",
          "tdm-reservation": "1",
        }),
        bytes: Buffer.from(
          '<title>Dispatch</title><link rel="license" href="https://creativecommons.org/publicdomain/zero/1.0/"><article><div class="entry-content"><p>Opening.</p><p>Closing.</p></div></article>' +
            navigation,
        ),
      }),
    );
  expect(
    (
      await read(
        '<nav class="post-navigation"><a rel="next" href="/another-post">Next post</a></nav>',
      )
    ).edition,
  ).toMatchObject({
    coverage: "complete",
    permissions: { copy: true, export: true, externalAI: false },
  });
  expect(
    (await read('<a rel="next" href="/dispatch/2">Continue</a>')).edition
      ?.outcome,
  ).toBe("partial");
});
