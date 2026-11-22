import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it } from "vitest";
import { adapt, fixtures } from "../src/data/fixtures";
import { dateLabel } from "../src/data/model";
import { Library, seedLibrary } from "../src/data/store";

const connections: Dexie[] = [];
function phaseOne(name = "upgrade-" + crypto.randomUUID()) {
  const db = new Dexie(name);
  db.version(1).stores({
    articles: "id",
    states: "id",
    summaries: "key, articleId",
    positions: "id",
    meta: "id",
  });
  connections.push(db);
  return db;
}
function reopen(name: string) {
  const db = new Library(name);
  connections.push(db);
  return db;
}
afterEach(async () => {
  const names = new Set(connections.map((db) => db.name));
  connections.splice(0).forEach((db) => db.close());
  for (const name of names) await Dexie.delete(name);
});

it("indexes legacy articles in place, including previously stored editions and received-only dates", async () => {
  const legacy = phaseOne();
  const article = await adapt(fixtures[0]);
  const edited = {
    ...article,
    title: "An earlier saved edition",
    bodyHash: "saved-edition",
  };
  await legacy.table("articles").add(edited);
  await legacy
    .table("states")
    .add({ id: edited.id, opened: true, saved: true, archived: false });
  legacy.close();
  const db = reopen(legacy.name);
  await seedLibrary(db);
  const rows = await db.listDemoArticles();
  expect(rows).toHaveLength(8);
  expect(rows.map((row) => row.newestFirst)).toEqual(
    rows.map((row) => row.newestFirst).sort((a, b) => a - b),
  );
  expect(
    rows.some(
      (row) => !row.published && row.newestFirst === -Date.parse(row.received),
    ),
  ).toBe(true);
  expect(rows[0]).toMatchObject({
    id: edited.id,
    title: edited.title,
    library: "demo",
  });
  expect(rows[0]).not.toHaveProperty("blocks");
  expect(await db.articles.get(edited.id)).toEqual(edited);
  expect(await db.states.get(edited.id)).toEqual({
    id: edited.id,
    opened: true,
    saved: true,
    archived: false,
  });
  await db.deliver([{ ...edited, title: "Publisher correction" }]);
  expect((await db.articleList.get(edited.id))?.title).toBe(
    "Publisher correction",
  );
});

it("resumes a committed batch after closing, with concurrent upgrades and deliveries on either side of the cursor", async () => {
  const legacy = phaseOne();
  const article = await adapt(fixtures[0]);
  const old = Array.from({ length: 145 }, (_, i) => ({
    ...article,
    id: "old-" + String(i).padStart(3, "0"),
  }));
  await legacy.table("articles").bulkAdd(old);
  legacy.close();
  const first = reopen(legacy.name);
  expect(await first.indexNextBatch()).toBe(true);
  const indexed = await first.articleList.count();
  expect(indexed).toBeGreaterThan(0);
  expect(indexed).toBeLessThan(old.length);
  first.close();
  const a = reopen(legacy.name),
    b = reopen(legacy.name);
  await a.deliver([
    { ...article, id: "aaa" },
    { ...article, id: "zzz" },
    { ...old[0], title: "Corrected" },
  ]);
  await Promise.all([seedLibrary(a), seedLibrary(b)]);
  const rows = await a.listDemoArticles();
  expect(rows).toHaveLength(old.length + fixtures.length + 2);
  expect(rows.map((row) => row.id).sort()).toEqual(
    await b.articles.toCollection().primaryKeys(),
  );
  expect(await a.articleList.get(old[0].id)).toMatchObject({
    title: "Corrected",
  });
  expect(await b.indexNextBatch()).toBe(false);
  expect(await b.indexProgress.count()).toBe(0);
});

it("rolls back a failed batch and resumes without a gap", async () => {
  const legacy = phaseOne();
  await legacy
    .table("articles")
    .bulkAdd(await Promise.all(fixtures.map(adapt)));
  legacy.close();
  const db = reopen(legacy.name);
  await db.open();
  const stop = () => {
    throw new Error("Interrupted write");
  };
  db.articleList.hook("creating", stop);
  await expect(db.indexNextBatch()).rejects.toThrow("Interrupted write");
  expect(await db.articleList.count()).toBe(0);
  expect(await db.indexProgress.get("articleList")).toEqual({
    id: "articleList",
  });
  db.articleList.hook.creating.unsubscribe(stop);
  await seedLibrary(db);
  expect(await db.articleList.count()).toBe(8);
});

it("indexes an article first written by a rolled-back Phase 1 reader", async () => {
  const first = reopen("rollback-" + crypto.randomUUID());
  await first.open();
  first.close();
  const legacy = phaseOne(first.name);
  const saved = { ...(await adapt(fixtures[0])), title: "My stored edition" };
  await legacy.table("articles").add(saved);
  await legacy
    .table("states")
    .add({ id: saved.id, opened: true, saved: true, archived: true });
  legacy.close();
  const updated = reopen(first.name);
  await seedLibrary(updated);
  expect(await updated.articleList.count()).toBe(8);
  expect((await updated.articleList.get(saved.id))?.title).toBe(saved.title);
  expect(await updated.articles.get(saved.id)).toEqual(saved);
  expect(await updated.states.get(saved.id)).toMatchObject({
    saved: true,
    archived: true,
  });
});

it("keeps ties in ID order and includes old entries with unusable dates", async () => {
  const legacy = phaseOne();
  const article = await adapt(fixtures[0]);
  await legacy.table("articles").bulkAdd([
    { ...article, id: "b", published: "invalid" },
    { ...article, id: "a", published: undefined },
    { ...article, id: "undated", published: undefined, received: "" },
  ]);
  legacy.close();
  const db = reopen(legacy.name);
  expect(await db.indexNextBatch()).toBe(false);
  const rows = await db.listDemoArticles();
  expect(rows.map((row) => row.id)).toEqual(["a", "b", "undated"]);
  expect(rows.map((row) => dateLabel(row))).toEqual([
    "Received 19 Nov",
    "Received 19 Nov",
    "Date unavailable",
  ]);
});
