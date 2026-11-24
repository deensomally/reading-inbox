import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it, vi } from "vitest";
import { LiveLibrary, collect, type Delivery } from "../src/data/live-library";
import {
  defaults,
  facetCounts,
  resultPage,
  type SearchOptions,
} from "../src/data/search";

const id = crypto.randomUUID();
let db = new LiveLibrary(id);
afterEach(async () => {
  await db.delete();
  db = new LiveLibrary(id);
});
const first: Delivery = {
  id: "a",
  feedId: "f",
  title: "City ledger",
  publication: "Café Press",
  author: "Renée Bell",
  topics: ["Tides", "Coasts"],
  published: "2026-04-10T00:30:00+02:00",
  received: "2026-04-12T00:00:00Z",
  url: null,
  discussion: null,
  coverage: "complete",
  withdrawn: false,
  paragraphs: ["A rare moonstone."],
  reason: "",
  license: "CC BY",
  revision: "one",
  permissions: { display: true, retain: true, copy: true, summarise: false },
};
const commit = async (items: Delivery[]) =>
  db.applyPage(
    await db.checkpoint.get("delivery"),
    { id: "delivery", phase: "changes", cursor: crypto.randomUUID() },
    items,
  );
async function page(
  o: Partial<SearchOptions> = {},
  limit = 400,
  collection: "Inbox" | "Saved" | "Archive" | "Unread" = "Inbox",
) {
  const options = { ...defaults, ...o };
  return resultPage(
    await db.searchCatalog("subscriptions"),
    collection,
    options,
    await db.matchingTerms(options.text),
    limit,
  );
}
const ids = (p: Awaited<ReturnType<typeof page>>) =>
  p.rows.map((r) => r.a.id.slice(4));

it("uses publication instants, received-time fallback and stable ID ties, with unknown lengths last in both directions", async () => {
  await commit([
    first,
    {
      ...first,
      id: "b",
      published: "2026-04-09T22:30:00Z",
      paragraphs: ["Only"],
    },
    { ...first, id: "c", published: null, coverage: "excerpt", topics: [] },
    {
      ...first,
      id: "d",
      published: "bad date",
      received: "2026-04-01T00:00:00Z",
      coverage: "unverified",
    },
  ]);
  expect(ids(await page())).toEqual(["c", "a", "b", "d"]);
  expect(ids(await page({ sort: "oldest" }))).toEqual(["d", "a", "b", "c"]);
  expect(ids(await page({ sort: "shortest" }))).toEqual(["b", "a", "c", "d"]);
  expect(ids(await page({ sort: "longest" }))).toEqual(["a", "b", "c", "d"]);
  expect(ids(await page({ topic: "" }))).toEqual(["c"]);
  expect((await page()).rows.map((r) => r.a.wordCount)).toEqual([
    undefined,
    3,
    1,
    undefined,
  ]);
});
it("intersects indexed metadata, topic, read and independent flags across collections; counts prospective facets", async () => {
  await commit([
    first,
    { ...first, id: "b", publication: "Harbour", topics: ["Coasts"] },
    { ...first, id: "c", topics: [] },
  ]);
  await db.changeFlag("rss-a", "saved");
  await db.changeFlag("rss-a", "archived");
  await db.viewed("rss-a", "original", true);
  const o = {
    text: "cafe rene tid moon",
    publication: "Café Press",
    topic: "Coasts",
    read: "opened",
    archived: true,
    saved: true,
  } as const;
  expect(ids(await page())).toEqual(["b", "c"]);
  for (const c of ["Inbox", "Archive", "Saved"] as const)
    expect(ids(await page(o, 5, c))).toEqual(["a"]);
  expect((await page({ ...o, read: "unread" })).total).toBe(0);
  const counts = facetCounts(
    await db.searchCatalog("subscriptions"),
    "Inbox",
    { ...defaults, publication: "Café Press", topic: "Coasts" },
    [],
  );
  expect([...counts.publications]).toEqual([
    ["Café Press", 1],
    ["Harbour", 1],
  ]);
  expect([...counts.topics]).toEqual([
    ["Tides", 1],
    ["Coasts", 1],
    ["", 1],
  ]);
});
it("atomically replaces old terms and verified length on text edits, rights loss and withdrawal", async () => {
  await commit([first]);
  const edit = {
    ...first,
    title: "Corrected log",
    topics: ["Navigation"],
    paragraphs: ["An astrolabe."],
    revision: "two",
  };
  await commit([edit]);
  for (const text of ["ledger", "tides", "moonstone"])
    expect((await page({ text })).total).toBe(0);
  expect((await page({ text: "correct nav astr" })).total).toBe(1);
  // Even a delivery still carrying text cannot index it once retention is denied.
  await commit([
    { ...edit, permissions: { ...edit.permissions, retain: false } },
  ]);
  expect((await page({ text: "astrolabe" })).total).toBe(0);
  expect(
    (await page({ text: "navigation" })).rows[0].a.wordCount,
  ).toBeUndefined();
  await commit([edit]);
  await commit([{ ...edit, withdrawn: true }]);
  expect((await page({ text: "astrolabe" })).total).toBe(0);
  expect((await db.searchTerms.get("rss-a"))?.terms).not.toContain("astrolabe");
});
it("resumes an offline M5 upgrade and restores missing publisher topics in one server replay", async () => {
  const old = new Dexie(db.name);
  old.version(3).stores({
    articles: "id",
    articleList: "id,[library+newestFirst]",
    states: "id",
    positions: "id",
    summaries: "key,articleId",
    meta: "id",
    indexProgress: "id",
    subscriptions: "id",
    checkpoint: "id",
    outbox: "++seq",
  });
  const oldArticles = Array.from({ length: 129 }, (_, i) => ({
    id: "rss-" + i,
    title: "Chart " + i,
    publication: "Press",
    author: "Ada",
    received: first.received,
    coverage: "complete",
    blocks: [{ kind: "paragraph", text: "Carried almanac" }],
    bodyHash: "old",
    source: "rss",
    sourceKey: String(i),
    library: "subscriptions",
    permissions: first.permissions,
  }));
  await old.table("articles").bulkPut(oldArticles);
  await old
    .table("checkpoint")
    .put({ id: "delivery", phase: "changes", cursor: "old", articleFormat: 2 });
  await old
    .table("states")
    .put({ id: "rss-0", saved: true, archived: true, opened: true });
  old.close();
  expect(await db.indexNextBatch()).toBe(true);
  expect(await db.searchTerms.count()).toBe(64);
  db.close();
  db = new LiveLibrary(id);
  await db.prepareIndexes();
  expect((await page({ text: "almanac" })).total).toBe(129);
  let snapshots = 0;
  const client = {
    async request<T>(path: string): Promise<T> {
      if (path === "subscriptions") return { items: [] } as T;
      if (path.startsWith("articles")) {
        snapshots++;
        return {
          items: [{ ...first, id: "0" }],
          nextCursor: null,
          changesCursor: "current",
        } as T;
      }
      return { items: [], nextCursor: "current", hasMore: false } as T;
    },
  };
  await collect(db, client);
  await collect(db, client);
  expect(snapshots).toBe(1);
  expect(
    ids(await page({ topic: "Tides", archived: true, saved: true })),
  ).toEqual(["0"]);
  expect((await page({ text: "almanac" })).total).toBe(128);
});
it("matches reference ordering across page boundaries, groups and updates", async () => {
  const entries = Array.from({ length: 123 }, (_, i) => ({
    ...first,
    id: String(i).padStart(3, "0"),
    publication: i % 3 ? "Harbour" : "Café Press",
    published:
      i % 5 ? new Date(Date.UTC(2026, 1, (i % 7) + 1)).toISOString() : null,
  }));
  await commit(entries);
  for (const corrected of [false, true]) {
    if (corrected) {
      entries[86] = {
        ...entries[86],
        published: "2027-01-01T00:00:00Z",
        publication: "Almanac",
      };
      await commit([entries[86]]);
    }
    const reference = entries
      .slice()
      .sort(
        (a, b) =>
          (a.publication < b.publication
            ? -1
            : a.publication > b.publication
              ? 1
              : 0) ||
          Date.parse(b.published ?? b.received) -
            Date.parse(a.published ?? a.received) ||
          a.id.localeCompare(b.id),
      )
      .map((e) => e.id);
    for (const limit of [40, 80, 120, 160]) {
      const p = await page({ grouped: true, text: "city" }, limit);
      expect(p.total).toBe(reference.length);
      expect(ids(p)).toEqual(reference.slice(0, limit));
    }
  }
});

it("counts complete matching publication groups and pages only expanded rows", async () => {
  const entries = Array.from({ length: 130 }, (_, n) => ({
    ...first,
    id: String(n).padStart(3, "0"),
    publication: n < 124 ? "Almanac" : "Bulletin",
    topics: [n % 3 === 0 ? "Maps" : "Rivers"],
  }));
  await commit(entries);
  const catalog = await db.searchCatalog("subscriptions");
  const grouped = (
    groupLimits: Map<string, number>,
    topic: string | null = null,
  ) =>
    resultPage(
      catalog,
      "Inbox",
      { ...defaults, grouped: true, topic },
      [],
      40,
      undefined,
      undefined,
      groupLimits,
    );
  const initial = grouped(new Map());
  expect(initial.groups.map((g) => [g.name, g.total, g.rows.length])).toEqual([
    ["Almanac", 124, 40],
    ["Bulletin", 6, 0],
  ]);
  const after = grouped(
    new Map([
      ["Almanac", 0],
      ["Bulletin", 40],
    ]),
    "Maps",
  );
  expect(after.total).toBe(44);
  expect(after.groups.map((g) => [g.name, g.total, g.rows.length])).toEqual([
    ["Almanac", 42, 0],
    ["Bulletin", 2, 2],
  ]);
  expect(ids(after)).toEqual(["126", "129"]);
});

it("repairs only legacy list rows after an open M5 tab edits a body or withdraws its rights", async () => {
  await commit([first, { ...first, id: "b" }]);
  await db.changeFlag("rss-a", "saved");
  const updated = {
    ...(await db.articles.get("rss-a"))!,
    blocks: [{ kind: "paragraph" as const, text: "New manuscript" }],
  };
  const restricted = {
    ...(await db.articles.get("rss-b"))!,
    coverage: "missing" as const,
    blocks: [],
    permissions: {
      display: false,
      retain: false,
      copy: false,
      summarise: false,
    },
  };
  await db.articles.bulkPut([updated, restricted]);
  // These releases wrote primary articles and a projection with no topic
  // column. They knew nothing about the separately persisted search postings.
  for (const article of [updated, restricted]) {
    const old = { ...(await db.articleList.get(article.id))! };
    Reflect.deleteProperty(old, "topics");
    Reflect.deleteProperty(old, "wordCount");
    await db.articleList.put(old);
  }
  const catalog = await db.searchCatalog("subscriptions");
  expect([...catalog.needsIndex].sort()).toEqual(["rss-a", "rss-b"]);
  expect(ids(await page({ text: "moonstone" }))).toEqual([]);
  expect((await page()).total).toBe(2);
  await db.repairLegacyRows(catalog.needsIndex);
  expect((await db.searchCatalog("subscriptions")).needsIndex.size).toBe(0);
  expect(ids(await page({ text: "manuscript", saved: true }))).toEqual(["a"]);
  expect(
    (await page({ sort: "longest" })).rows.map((row) => row.a.wordCount),
  ).toEqual([2, undefined]);
  expect((await db.matchingTerms("moonstone"))[0].size).toBe(0);
  expect(await db.articles.get("rss-a")).toEqual(updated);
});

it("reactively refreshes active prefix matches on same-size edits, rights loss and deletion", async () => {
  await commit([first]);
  const results: string[][] = [];
  const subscription = Dexie.liveQuery(() =>
    db.matchingTerms("manus"),
  ).subscribe((matches) => results.push([...matches[0]]));
  try {
    await vi.waitFor(() => expect(results.at(-1)).toEqual([]));
    const edited = {
      ...first,
      paragraphs: ["A manuscript."],
      revision: "edit",
    };
    await commit([edited]);
    await vi.waitFor(() => expect(results.at(-1)).toEqual(["rss-a"]));
    await commit([
      {
        ...edited,
        permissions: { ...edited.permissions, retain: false },
        revision: "restricted",
      },
    ]);
    await vi.waitFor(() => expect(results.at(-1)).toEqual([]));
    await commit([edited]);
    await vi.waitFor(() => expect(results.at(-1)).toEqual(["rss-a"]));
    await db.searchTerms.delete("rss-a");
    await vi.waitFor(() => expect(results.at(-1)).toEqual([]));
  } finally {
    subscription.unsubscribe();
  }
});
