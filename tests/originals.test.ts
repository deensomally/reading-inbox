import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Catalog } from "../service/catalog.ts";
import { feedApp } from "../service/app.ts";
import { extractPage } from "../service/original-page.ts";
import { parseFeed } from "../service/parser.ts";
import { originalText } from "../shared/original.ts";
import type { Download } from "../service/types.ts";
import { publisher } from "./feeds/publisher.ts";
import {
  addNotebook,
  goldenText,
  riverProof,
  sourceUrl,
  sourceOrigin,
  diagram,
  notebook,
  river,
  lastPassage,
} from "./originals/source.ts";
const origins = new Set([sourceOrigin]);
const entry = parseFeed(notebook, sourceUrl, { pageOrigins: origins })
  .entries[0];
const input = {
  ...entry,
  ...entry.content,
  pageCandidate: entry.content.pageCandidate!,
  reviewedText: riverProof[1],
};
function read(
  html = river,
  headers: Record<string, string> = {},
  image = diagram,
) {
  const requests: string[] = [];
  const download: Download = async (url) => {
    requests.push(url);
    const png = url.endsWith(".png");
    return {
      url,
      aliases: [],
      bytes: png ? image : Buffer.from(html),
      status: 200,
      headers: new Headers(
        png
          ? { "content-type": "image/png" }
          : { "content-type": "text/html", ...headers },
      ),
    };
  };
  return { requests, extract: () => extractPage(input, download) };
}

describe("faithful public originals", () => {
  it("reconstructs the licensed boundary including ordered passages, labels and the final words", async () => {
    const source = read(),
      r = await source.extract();
    expect(r.coverage).toBe("complete");
    expect(r.discussion).toBe(sourceOrigin + "/river#discussion");
    const nodes = r.document!.nodes.filter((n) => typeof n !== "string");
    expect(nodes.map((n) => n.tag)).toEqual([
      "p",
      "h2",
      "ol",
      "blockquote",
      "figure",
      "table",
      "pre",
      "p",
    ]);
    expect(nodes[1].passage).toBe("observations");
    expect(nodes[2].start).toBe(3);
    expect(source.requests).toEqual([
      sourceOrigin + "/river",
      sourceOrigin + "/gauge.png",
    ]);
    const copy = originalText(nodes);
    expect(copy).toBe(goldenText);
    for (const passage of [
      "waterline beside the bridge and the lock",
      "3. Watch the float.",
      "• Keep the cord slack.",
      "4. Record the reading.",
      "Return before the tide turns.",
      "Gauge marks by Mira Dale.",
      "height = 12",
    ])
      expect(copy).toContain(passage);
    expect(copy.endsWith(lastPassage)).toBe(true);
  });
  it.each([
    [
      "unknown page licence",
      river.replaceAll("licenses/by/4.0", "licenses/by-nc/4.0"),
    ],
    [
      "non-matching canonical",
      river.replace(
        "publisher.example.org/river",
        "publisher.example.org/other",
      ),
    ],
    ["paywall", river.replace("<article>", '<article class="paywall">')],
    [
      "subscriber metadata",
      river.replace(
        "</head>",
        '<meta itemprop="isAccessibleForFree" content="false"></head>',
      ),
    ],
    [
      "long teaser",
      river.replace(
        lastPassage,
        "An observed passage. ".repeat(400) + "Continue reading",
      ),
    ],
    [
      "multi-page body",
      river.replace("</head>", '<link rel="next" href="/river/2"></head>'),
    ],
    [
      "empty body",
      river.replace(
        /<section itemprop="articleBody">[\s\S]*?<\/section>/,
        '<section itemprop="articleBody"></section>',
      ),
    ],
    ["restricted material", river.replace(lastPassage, "All rights reserved.")],
  ])("hands off for %s without requesting any images", async (_, html) => {
    const s = read(html);
    expect((await s.extract()).document).toBeUndefined();
    expect(s.requests).toHaveLength(1);
  });
  it("honours storage restrictions, bounds unverified extraction and omits unsafe or unlicensed media", async () => {
    for (const headers of [
      { "cache-control": "private, no-store" },
      { "x-robots-tag": "noarchive" },
    ] as Record<string, string>[]) {
      expect((await read(river, headers).extract()).document).toBeUndefined();
    }
    expect(
      (
        await read(
          river.replace('itemprop="articleBody"', 'class="story"'),
        ).extract()
      ).coverage,
    ).toBe("unverified");
    const s = read(
      river
        .replace(
          'src="/gauge.png"',
          'src="https://images.example.org/gauge.png"',
        )
        .replace(
          lastPassage,
          '<iframe title="interactive map"></iframe><script type="application/json">ignored-script</script>' +
            lastPassage,
        ),
    );
    const r = await s.extract();
    expect(r.coverage).toBe("unverified");
    expect(s.requests).toHaveLength(1);
    expect(JSON.stringify(r.document)).not.toMatch(
      /ignored-script|data:image\/png|<iframe/,
    );
    expect(originalText(r.document!.nodes)).toContain(
      "Gauge marks by Mira Dale.",
    );
    const corrupt = Buffer.from(diagram);
    corrupt[40] ^= 1;
    expect((await read(river, {}, corrupt).extract()).coverage).toBe(
      "unverified",
    );
  });
  it("only selects reviewed, same-origin public pages and keeps separately permitted subscriber previews", () => {
    const candidate = (xml: string, approved = origins) =>
      parseFeed(xml, sourceUrl, { pageOrigins: approved }).entries[0].content;
    expect(candidate(notebook, new Set()).pageCandidate).toBeUndefined();
    expect(
      candidate(
        notebook.replace(
          'href="/river"',
          'href="https://elsewhere.example/river"',
        ),
      ).pageCandidate,
    ).toBeUndefined();
    expect(
      candidate(
        notebook.replace(
          "<summary>",
          "<content>Only for paid subscribers. Private edition.</content><summary>",
        ),
      ),
    ).toMatchObject({
      subscriberOnly: true,
      coverage: "excerpt",
      paragraphs: ["Morning notes from the river gauge."],
    });
    const unlicensed = candidate(
      notebook.replace(
        "<entry>",
        "<entry><rights>All rights reserved</rights>",
      ),
    );
    expect(unlicensed.pageCandidate).toBeUndefined();
    expect(unlicensed.permissions.display).toBe(false);
  });
  it("invalidates edited and revoked page bodies atomically, across service restarts and feed withdrawal", async () => {
    const fixture = await publisher();
    addNotebook(fixture);
    const dir = mkdtempSync(join(tmpdir(), "reading-box-originals-")),
      file = join(dir, "service.sqlite");
    let now = Date.now(),
      catalog = new Catalog(file);
    const options = {
      download: fixture.download,
      pageOrigins: origins,
      proofs: new Map([riverProof]),
      now: () => now,
    };
    let service = feedApp(catalog, options);
    try {
      const { subscription } = await service.poller.subscribe(
        "owner",
        sourceUrl,
      );
      const id = catalog.articles("owner", 1).items[0].id;
      const check = () => service.poller.original("owner", id);
      expect(fixture.calls.filter((c) => c.url === "/river")).toHaveLength(0);
      await expect(service.poller.original("other", id)).rejects.toThrow();
      await Promise.all([check(), check()]);
      const first = catalog.article("owner", id);
      expect(first.coverage).toBe("complete");
      expect(fixture.calls.filter((c) => c.url === "/river")).toHaveLength(1);
      await service.app.close();
      catalog = new Catalog(file);
      service = feedApp(catalog, options);
      expect(catalog.article("owner", id).revision).toBe(first.revision);
      now += 61000;
      fixture.routes.set("/river", {
        body: river.replace(lastPassage, "The amended final sentence."),
        headers: { "content-type": "text/html" },
      });
      await check();
      const edited = catalog.article("owner", id);
      expect(edited.coverage).toBe("unverified");
      expect(edited.revision).not.toBe(first.revision);
      expect(edited.paragraphs.at(-1)).toBe("The amended final sentence.");
      now += 61000;
      fixture.routes.set("/river", { status: 403 });
      await check();
      expect(catalog.article("owner", id)).toMatchObject({
        coverage: "excerpt",
        paragraphs: ["Morning notes from the river gauge."],
      });
      expect(catalog.article("owner", id).document).toBeUndefined();
      expect(
        catalog.db
          .prepare("SELECT body FROM page_editions WHERE article_id=?")
          .get(id)?.body,
      ).toBeNull();
      fixture.routes.set("/river", {
        body: river,
        headers: { "content-type": "text/html" },
      });
      now += 61000;
      await check();
      fixture.routes.set("/notebook.atom", {
        body: notebook.replace(
          "</feed>",
          '<deleted-entry xmlns="http://purl.org/atompub/tombstones/1.0" ref="urn:notebook:river"/></feed>',
        ),
      });
      await service.poller.refresh("owner", subscription.id);
      expect(catalog.article("owner", id)).toMatchObject({
        withdrawn: true,
        paragraphs: [],
      });
      expect(
        catalog.db.prepare("SELECT count(*) n FROM page_editions").get()?.n,
      ).toBe(0);
      expect(JSON.stringify(catalog.changes("owner", 100))).not.toContain(
        lastPassage,
      );
    } finally {
      await service.app.close();
      await fixture.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 4 });
    }
  });
});

it("preserves pairing identity, a delivery cursor and article IDs while upgrading a v1 service database", async () => {
  const remote = await publisher();
  addNotebook(remote);
  const dir = mkdtempSync(join(tmpdir(), "reading-box-v1-")),
    file = join(dir, "feeds.sqlite");
  let db = new Catalog(file);
  let service = feedApp(db, { download: remote.download });
  try {
    const { subscription } = await service.poller.subscribe("owner", sourceUrl);
    const { items, changesCursor } = db.articles("owner", 1);
    const credential = db.credential("owner"),
      library = db.browserLibrary("owner");
    db.db
      .prepare("INSERT INTO browser_devices VALUES(?,?,?,?,?)")
      .run(
        "paired-device",
        "owner",
        "http://localhost:4173",
        "existing public key",
        Date.now() + 100000,
      );
    db.db.exec(
      "DROP TRIGGER clear_page; DROP TABLE page_editions; DELETE FROM settings WHERE name='page-origins'; PRAGMA user_version=1",
    );
    await service.app.close();
    db = new Catalog(file);
    service = feedApp(db, { download: remote.download });
    expect(db.browserLibrary("owner")).toBe(library);
    expect(db.authenticate(credential)).toBe("owner");
    expect(db.db.prepare("SELECT id FROM browser_devices").get()?.id).toBe(
      "paired-device",
    );
    expect(db.get("owner", subscription.id).active).toBe(1);
    expect(db.article("owner", items[0].id).paragraphs).toEqual([
      "Morning notes from the river gauge.",
    ]);
    expect(db.changes("owner", 100, changesCursor).items).toEqual([]);
  } finally {
    await service.app.close();
    await remote.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("keeps XHTML headings and inline markup and resolves inherited XML base URLs", () => {
  const feed = notebook.replace(
    "<summary>Morning notes from the river gauge.</summary>",
    '<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml" xml:base="/guide/"><h2>Observations</h2><p>Read the <em>last</em> <a href="step">step</a>.</p></div></content>',
  );
  const content = parseFeed(feed, sourceUrl).entries[0].content;
  expect(content.coverage).toBe("unverified");
  expect(originalText(content.document!.nodes)).toBe(
    "Observations\n\nRead the last step.",
  );
  expect(JSON.stringify(content.document)).toContain(
    sourceOrigin + "/guide/step",
  );
});
