import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { parseFragment } from "parse5";
import {
  LiveLibrary,
  adaptDelivery,
  collect,
  type Delivery,
} from "../src/data/live-library";
import { ServiceError } from "../src/data/connection";
import { bodyText } from "../src/data/model";
import { debianReview } from "../shared/reviewed-article";
import { parseFeed } from "../service/parser.ts";
import { digest } from "../service/types.ts";
import { fixture } from "./feeds/publisher.ts";

const xml = fixture("debian-election.atom");
const entry = parseFeed(xml, debianReview.feed).entries[0];
const original: Delivery = {
  ...entry.content,
  id: "public-post",
  feedId: "public-feed",
  publication: "Bits from Debian",
  url: entry.url,
  discussion: null,
  title: entry.title,
  author: entry.author,
  published: entry.published,
  received: "2026-11-22T10:00:00Z",
  revision: "first",
  withdrawn: false,
};
it("matches the independent publisher body, every inline link, the licence and final passage without accepting changed editions", () => {
  const canonical = fixture("debian-election-body.html").trim();
  expect(digest(canonical.replace(/\s+/g, " "))).toBe(debianReview.markupHash);
  const paragraphs = parseFragment(canonical).childNodes.filter(
    (n) => "tagName" in n && n.tagName === "p",
  );
  const links = paragraphs.flatMap((p, i) =>
    "childNodes" in p
      ? p.childNodes.flatMap((n) =>
          "tagName" in n && n.tagName === "a"
            ? [
                {
                  paragraph: i,
                  text: n.childNodes
                    .map((t) => ("value" in t ? t.value : ""))
                    .join(""),
                  href: n.attrs.find((a) => a.name === "href")?.value,
                },
              ]
            : [],
        )
      : [],
  );
  expect(links).toEqual(debianReview.links);
  const a = adaptDelivery(original);
  expect(a).toMatchObject({
    coverage: "complete",
    license: debianReview.license,
    permissions: { display: true, copy: true, summarise: false },
  });
  expect(a.blocks).toHaveLength(paragraphs.length);
  expect(digest(bodyText(a.blocks))).toBe(debianReview.textHash);
  expect(bodyText(a.blocks)).toMatch(/expire on April 20, 2027\.$/);
  for (const altered of [
    xml.replace("20, 2027", "21, 2027"),
    xml.replace("Condorcet_method", "Other_method"),
    xml.replace("<content", "<rights>Reserved</rights><content"),
  ])
    expect(
      parseFeed(altered, debianReview.feed).entries[0].content.coverage,
    ).not.toBe("complete");
  expect(
    parseFeed(xml, debianReview.feed, { storeText: false }).entries[0].content
      .paragraphs,
  ).toEqual([]);
  expect(
    parseFeed(xml, "https://other.example.org/feed").entries[0].content
      .permissions.copy,
  ).toBe(false);
});

it("commits pages with the cursor, resumes after a failed page and keeps independent flags through replay and withdrawal", async () => {
  const db = new LiveLibrary(crypto.randomUUID());
  let fail = true,
    withdraw = false,
    stale = false;
  const client = {
    async request<T>(path: string): Promise<T> {
      let value;
      if (path === "subscriptions") value = { items: [] };
      else if (path.startsWith("articles") && !path.includes("cursor="))
        value = {
          items: [original],
          nextCursor: "second",
          changesCursor: "base",
        };
      else if (path.startsWith("articles")) {
        if (fail) throw new Error("Disconnected");
        value = { items: [original], nextCursor: null, changesCursor: "base" };
      } else {
        if (stale) {
          stale = false;
          throw new ServiceError(400, "invalid_cursor", "Snapshot required");
        }
        value = {
          items: withdraw
            ? [
                {
                  article: {
                    ...original,
                    withdrawn: true,
                    revision: "removed",
                    paragraphs: [],
                  },
                },
              ]
            : [],
          hasMore: false,
          nextCursor: "latest",
        };
      }
      return value as T;
    },
  };
  try {
    await expect(collect(db, client)).rejects.toThrow("Disconnected");
    expect(await db.checkpoint.get("delivery")).toMatchObject({
      phase: "snapshot",
      cursor: "second",
    });
    const id = "rss-" + original.id;
    await db.changeFlag(id, "saved");
    await db.changeFlag(id, "archived");
    await db.viewed(id, "original", true);
    await db.positions.put({ id: id + "/original", top: 92 });
    fail = false;
    await collect(db, client);
    stale = true;
    await collect(db, client);
    expect(await db.articleList.count()).toBe(1);
    expect(await db.checkpoint.get("delivery")).toMatchObject({
      cursor: "latest",
    });
    withdraw = true;
    await collect(db, client);
    expect(await db.articles.get(id)).toMatchObject({
      blocks: [],
      coverage: "missing",
      permissions: { copy: false },
    });
    expect(await db.states.get(id)).toMatchObject({
      saved: true,
      archived: true,
      lastStage: "original",
    });
    expect((await db.positions.get(id + "/original"))?.top).toBe(92);
  } finally {
    await db.delete();
  }
});
