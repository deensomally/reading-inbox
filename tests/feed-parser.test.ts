import { describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import {
  createDownloader,
  MAX_BYTES,
  pinnedAddress,
  publicUrl,
  subscriptionUrl,
} from "../service/network.ts";
import {
  decodeDocument,
  discoverAlternate,
  parseFeed,
  reviewKey,
} from "../service/parser.ts";
import { digest } from "../service/types.ts";
import {
  cc,
  example,
  fixture,
  publisher,
  rss,
  substack,
  usgs,
} from "./feeds/publisher.ts";

describe("public publisher formats", () => {
  it("reads captured Creative Commons RSS metadata and preserves its opaque GUID and query string", () => {
    const [e] = parseFeed(fixture("creative-commons.rss"), cc).entries;
    expect(e).toMatchObject({
      sourceId: "https://creativecommons.org/?p=78859",
      author: "Brigitte Vézina",
      topics: ["Open Culture"],
      published: "2026-11-18T16:25:42.000Z",
    });
    expect(e.url).toContain("?utm_source=rss&utm_medium=rss");
    expect(e.content).toMatchObject({
      coverage: "unverified",
      paragraphs: ["Authored test text in a syndication field."],
      permissions: { display: true, export: false },
    });
  });
  it("retains only basic, permitted USGS Atom summary text and identifies a Substack preview", () => {
    const [quake] = parseFeed(fixture("usgs.atom"), usgs).entries;
    expect(quake).toMatchObject({
      sourceId: "urn:earthquake-usgs-gov:us:6000ucly",
      published: null,
      updated: "2026-11-22T10:52:49.837Z",
      content: {
        coverage: "excerpt",
        paragraphs: ["Location", "238 km SW of Yanglong, China"],
        permissions: { display: true, summarise: false },
      },
    });
    const [post] = parseFeed(fixture("substack.rss"), substack).entries;
    expect(post).toMatchObject({
      author: "Ethan Mollick",
      discussion: null,
      content: {
        coverage: "excerpt",
        paragraphs: ["Authored preview for the test.", "Continue reading"],
        permissions: { display: true, copy: true, export: false },
      },
    });
    expect(
      parseFeed(rss("<item><title>Only a link</title></item>"), example)
        .entries[0].content.coverage,
    ).toBe("missing");
  });
  it("resolves XML bases and requires rights, a matching review, and plain full content to report complete", () => {
    const xml =
      '<a:feed xmlns:a="http://www.w3.org/2005/Atom" xml:base="/posts/"><a:title>Press</a:title><a:link rel="license" href="https://creativecommons.org/licenses/by/4.0/"/><a:entry xml:base="2026/"><a:id>urn:news:a</a:id><a:link href="a"/><a:link rel="replies" href="a#comments"/><a:content>Original final text.</a:content></a:entry></a:feed>';
    const url = "https://publisher.example.org/posts/2026/a";
    const proofs = new Map([
      [reviewKey(example, url), digest("Original final text.")],
    ]);
    const body = (input: string) =>
      parseFeed(input, example, { proofs }).entries[0].content;
    expect(body(xml)).toMatchObject({
      coverage: "complete",
      paragraphs: ["Original final text."],
      permissions: { retain: true, copy: true, summarise: false },
    });
    expect(parseFeed(xml, example).entries[0]).toMatchObject({
      url,
      discussion: url + "#comments",
      content: { coverage: "unverified" },
    });
    expect(body(xml.replace("final", "changed")).coverage).toBe("unverified");
    expect(
      body(
        xml.replace(
          "<a:content>",
          "<a:rights>Do not store</a:rights><a:content>",
        ),
      ).paragraphs,
    ).toEqual([]);
    expect(
      body(xml.replace("Original final text.", "Continue reading")).coverage,
    ).toBe("excerpt");
    expect(
      parseFeed(xml, example, { proofs, storeText: false }).entries[0].content
        .paragraphs,
    ).toEqual([]);
  });
  it("decodes a declared charset, detects malformed XML, refuses DTDs and restricts nesting", () => {
    const bytes = Buffer.from(
      '<?xml version="1.0" encoding="iso-8859-1"?>' +
        rss("<item><title>Café</title></item>"),
      "latin1",
    );
    expect(
      parseFeed(decodeDocument(bytes, null), example).entries[0].title,
    ).toBe("Café");
    for (const xml of [
      rss("<item>"),
      "<!DOCTYPE rss>" + rss(""),
      "<other/>",
      rss("<a>".repeat(70) + "</a>".repeat(70)),
    ])
      expect(() => parseFeed(xml, example)).toThrow();
  });
  it("keeps a permitted Atom summary when the publisher supplies the original separately", () => {
    const xml =
      '<feed xmlns="http://www.w3.org/2005/Atom"><link rel="license" href="https://creativecommons.org/licenses/by/4.0/"/><entry><id>entry</id><content src="/file"/><summary>Publisher preview.</summary></entry></feed>';
    const result = parseFeed(xml, example).entries[0];
    expect(result.content).toMatchObject({
      coverage: "excerpt",
      paragraphs: ["Publisher preview."],
      permissions: { retain: true },
    });
  });
  it("accepts public Substack home addresses and a publisher-advertised alternate", () => {
    expect(subscriptionUrl("press.substack.com")).toBe(
      "https://press.substack.com/feed",
    );
    expect(
      discoverAlternate(
        '<html><head><base href="/journal/"><link rel="alternate" type="application/atom+xml" href="posts.xml"></head></html>',
        example,
      ),
    ).toBe("https://publisher.example.org/journal/posts.xml");
    expect(() =>
      discoverAlternate("<html><head></head></html>", example),
    ).toThrow();
  });
});

describe("outbound boundaries", () => {
  it("admits public routes only and checks the full resolution set before selecting an address", async () => {
    for (const url of [
      "http://localhost/rss",
      "http://127.0.0.1/feed",
      "https://[::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://example.org:4443/feed",
      "https://reader:private@example.org/",
      "https://example.org/feed?access_token=private",
      "https://p.substack.com/feed/private/example",
    ])
      expect(() => publicUrl(url)).toThrow();
    const signal = new AbortController().signal;
    const lookup = vi.fn(async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "192.168.0.1", family: 4 },
    ]);
    await expect(
      pinnedAddress("publisher.example.org", signal, lookup),
    ).rejects.toThrow();
    await expect(
      pinnedAddress("publisher.example.org", signal, async () => [
        { address: "1.1.1.1", family: 4 },
      ]),
    ).resolves.toMatchObject({ address: "1.1.1.1" });
  });
  it("enforces redirect, robots and compressed/decoded size limits on a controlled HTTP origin", async () => {
    const p = await publisher();
    try {
      p.routes.set("/robots.txt", {
        body: "User-agent: ReadingBox\nDisallow: /closed",
      });
      await expect(
        p.download(example.replace("/feed", "/closed")),
      ).rejects.toMatchObject({ code: "robots_denied" });
      p.routes.set("/feed", {
        status: 301,
        headers: { location: "http://127.0.0.1/example" },
      });
      await expect(p.download(example)).rejects.toMatchObject({
        code: "public_url_required",
      });
      p.routes.set("/feed", {
        body: gzipSync(Buffer.alloc(MAX_BYTES + 1, 65)),
        headers: { "content-encoding": "gzip" },
      });
      await expect(p.download(example)).rejects.toMatchObject({
        code: "encoding",
      });
      p.routes.set("/feed", { body: Buffer.alloc(MAX_BYTES + 1) });
      await expect(p.download(example)).rejects.toMatchObject({
        code: "too_large",
      });
      const timed = createDownloader(async () => {
        throw new Error("Connection unavailable");
      });
      await expect(timed(example)).rejects.toMatchObject({
        code: "unreachable",
      });
    } finally {
      await p.close();
    }
  });
  it("aborts a stalled HTTP response at the fetch deadline", async () => {
    const p = await publisher();
    let release!: () => void;
    p.routes.set("/feed", {
      wait: new Promise<void>((resolve) => (release = resolve)),
    });
    try {
      await expect(
        createDownloader(p.wire, Date.now, 150)(example),
      ).rejects.toMatchObject({ code: "timeout" });
    } finally {
      release();
      await p.close();
    }
  });
});

it("observes a publisher crawl delay across feed and page requests and can resume after it", async () => {
  const p = await publisher();
  let now = Date.now();
  const get = createDownloader(p.wire, () => now);
  try {
    p.routes.set("/robots.txt", {
      body: "User-agent: ReadingBox\nCrawl-delay: 8\n",
    });
    p.routes.set("/feed", { body: rss("") });
    await get(example);
    const article = example.replace("/feed", "/article");
    await expect(get(article, undefined, "page")).rejects.toMatchObject({
      code: "crawl_delay",
      retryAt: now + 8000,
    });
    expect(p.calls.filter((c) => c.url === "/article")).toHaveLength(0);
    now += 8000;
    expect((await get(article, undefined, "page")).status).toBe(404);
  } finally {
    await p.close();
  }
});
