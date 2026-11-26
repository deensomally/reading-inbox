import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { Library, seedLibrary, summaryKey } from "../src/data/store";
import { adapt, fixtures } from "../src/data/fixtures";
import {
  archiveBatch,
  undoArchive,
  localMidnight,
  beforeDate,
} from "../src/data/archive";
import { parseBackup } from "../src/data/backup-format";
import { exportLibrary, restoreLibrary } from "../src/data/portable-library";
import { adaptDelivery, type Delivery } from "../src/data/live-library";
import { candidates, defaults } from "../src/data/search";
const opened: Library[] = [];
function profile() {
  const db = new Library("m7-" + crypto.randomUUID());
  opened.push(db);
  return db;
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(opened.splice(0).map((db) => db.delete()));
});
async function sample() {
  const db = profile();
  await seedLibrary(db);
  const a = (await db.articles.get("night-train"))!;
  await db.changeFlag(a.id, "saved");
  await db.viewed(a.id, "original", true);
  await db.rememberPosition(a.id + "/original", 245);
  await archiveBatch(db, [a.id], "batch");
  await db.viewed("bench", "brief", true);
  await db.changeFlag("tide", "saved");
  const json = await readFile("public/demo/night-train.json", "utf8");
  vi.stubGlobal("fetch", async () => new Response(json));
  await db.summaries.put({
    key: summaryKey(a, "essence"),
    articleId: a.id,
    paragraphs: JSON.parse(json).essence,
  });
  return {
    db,
    a,
    backup: parseBackup(
      JSON.stringify(await exportLibrary(db, "demo")),
      "demo",
    ),
  };
}
it("archives a frozen filtered set across pages, retries and undoes only its own changes after reopen", async () => {
  const db = profile(),
    a = await adapt(fixtures[0]);
  await db.deliver(
    Array.from({ length: 132 }, (_, i) => ({
      ...a,
      id: "a" + i,
      topics: i < 125 ? ["Work"] : ["Other"],
    })),
  );
  await db.changeFlag("a1", "saved");
  await db.viewed("a1", "brief", true);
  await db.rememberPosition("a1/brief", 152);
  const options = { ...defaults, topic: "Work" },
    cat = await db.searchCatalog("demo");
  const ids = [...candidates(cat, "Inbox", options, []).keys()];
  expect(ids).toHaveLength(125);
  await db.deliver([{ ...a, id: "late", topics: ["Work"] }]);
  expect(await archiveBatch(db, ids, "op")).toBe(125);
  expect(await archiveBatch(db, ids, "op")).toBe(0);
  expect((await db.states.get("late"))?.archived).toBe(false);
  expect((await db.states.get("a131"))?.archived).toBe(false);
  const archived = await db.searchCatalog("demo");
  expect(
    candidates(
      archived,
      "Archive",
      { ...defaults, text: "night" },
      await db.matchingTerms("night"),
    ).size,
  ).toBe(125);
  await db.changeFlag("a2", "archived");
  await db.changeFlag("a2", "archived");
  db.close();
  await db.open();
  expect(await undoArchive(db, "op")).toBe(124);
  expect(await undoArchive(db, "op")).toBe(0);
  expect(await archiveBatch(db, ids, "op")).toBe(0);
  expect(await db.states.get("a1")).toMatchObject({
    archived: false,
    saved: true,
    deepest: "brief",
  });
  expect((await db.positions.get("a1/brief"))?.top).toBe(152);
  expect((await db.states.get("a2"))?.archived).toBe(true);
});
it("rolls back aborted writes and refuses a partially stale selection", async () => {
  const { db } = await sample();
  const ids = ["bench", "paper"];
  await expect(
    db.transaction(
      "rw",
      db.states,
      db.archiveUndo,
      db.articleList,
      async () => {
        await archiveBatch(db, ids, "interrupt");
        throw new Error("interrupted");
      },
    ),
  ).rejects.toThrow("interrupted");
  expect((await db.states.get("bench"))?.archived).toBe(false);
  expect((await db.archiveUndo.get("last"))?.operation).toBe("batch");
  await db.changeFlag("paper", "archived");
  await expect(archiveBatch(db, ids, "later")).rejects.toThrow(
    "selection changed",
  );
  expect((await db.states.get("bench"))?.archived).toBe(false);
  await expect(archiveBatch(db, ["paper"], "other-window")).rejects.toThrow(
    "selection changed",
  );
});
it("uses strict local-day boundaries, falls back to received time and excludes undated records", async () => {
  const db = profile(),
    a = await adapt(fixtures[0]),
    t = localMidnight("2026-11-01");
  expect(t).toBe(new Date(2026, 10, 1).getTime());
  expect(localMidnight("2026-02-30")).toBeNaN();
  await db.deliver(
    [t - 1, t, t + 1, NaN].map((v, i) => ({
      ...a,
      id: "d" + i,
      published: undefined,
      received: Number.isFinite(v) ? new Date(v).toISOString() : "",
    })),
  );
  const cat = await db.searchCatalog("demo");
  expect(
    [...cat.rows.values()]
      .filter((r) => beforeDate(r.a.newestFirst, t))
      .map((r) => r.a.id),
  ).toEqual(["d0"]);
});
it("round-trips saved+archived text, independently permitted caches, unsaved reading state and a restricted excerpt", async () => {
  const { a, backup } = await sample();
  const full = backup.entries.find((e) => e.id === a.id)!;
  expect(full.body).toContain("meet the train after dark.");
  expect(full.summaries).toHaveLength(1);
  const restricted = backup.entries.find((e) => e.id === "tide")!;
  expect(restricted.body).toBeUndefined();
  expect(restricted.omissions.join(" ")).toContain(
    "no current text export grant",
  );
  const fresh = profile();
  const preview = await restoreLibrary(fresh, backup, false);
  expect(await fresh.articles.count()).toBe(0);
  await restoreLibrary(fresh, backup, false, preview);
  expect(await fresh.states.get(a.id)).toMatchObject({
    saved: true,
    archived: true,
    deepest: "original",
  });
  expect((await fresh.positions.get(a.id + "/original"))?.top).toBe(245);
  expect(await fresh.summaries.count()).toBe(1);
  expect(await fresh.states.get("bench")).toMatchObject({
    saved: false,
    lastStage: "brief",
  });
  const second = await restoreLibrary(fresh, backup, false);
  expect(second.rows.every((r) => !r.added && !r.changes.length)).toBe(true);
  await restoreLibrary(fresh, backup, false, second);
  expect(await fresh.articles.count()).toBe(8);
});
it("keeps newer local fields, protects undated legacy edits and aborts a stale confirmed import atomically", async () => {
  const { backup, db } = await sample();
  await db.changeFlag("night-train", "saved");
  await db.rememberPosition("night-train/original", 900);
  await db.states.update("bench", { lastStage: "original", modified: {} });
  const preview = await restoreLibrary(db, backup, false);
  expect(preview.rows.find((r) => r.id === "night-train")?.kept).toContain(
    "Local saved",
  );
  expect(preview.rows.find((r) => r.id === "bench")?.kept).toContain(
    "Local progress",
  );
  await db.changeFlag("paper", "saved");
  await expect(restoreLibrary(db, backup, false, preview)).rejects.toThrow(
    "library changed",
  );
  const current = await restoreLibrary(db, backup, false);
  await restoreLibrary(db, backup, false, current);
  expect((await db.states.get("night-train"))?.saved).toBe(false);
  expect((await db.positions.get("night-train/original"))?.top).toBe(900);
});
const serviceId = crypto.randomUUID();
const feedItem: Delivery = {
  id: serviceId,
  feedId: "secret-feed-token",
  sourceRef: "f".repeat(64),
  portableId: "a".repeat(64),
  title: "Journal",
  author: "Ada",
  publication: "Dispatches",
  published: null,
  received: "2026-11-20T12:00:00Z",
  url: "https://private.example.org/?token=PRIVATE",
  discussion: null,
  revision: "b".repeat(64),
  license: "CC BY",
  withdrawn: false,
  reason: "Excerpt only",
  coverage: "excerpt",
  paragraphs: ["Restricted passage."],
  permissions: { display: true, retain: true, copy: true, summarise: false },
};
it("keeps policy and identity authoritative across restored metadata, another collector, withdrawal and offline import", async () => {
  const db = profile(),
    a = adaptDelivery(feedItem);
  await db.deliver([a]);
  await db.changeFlag(a.id, "saved");
  await db.changeFlag(a.id, "archived");
  await db.meta.put({ id: "session.secret", value: 123 });
  const json = JSON.stringify(await exportLibrary(db, "subscriptions"));
  for (const secret of [
    "PRIVATE",
    "private.example",
    "secret-feed-token",
    "Restricted passage",
    "session.secret",
  ])
    expect(json).not.toContain(secret);
  const backup = parseBackup(json, "subscriptions");
  backup.entries[0].body = "Restricted passage.";
  const fresh = profile();
  const plan = await restoreLibrary(fresh, backup, false);
  expect(plan.rows[0].omitted).toHaveLength(1);
  await restoreLibrary(fresh, backup, false, plan);
  expect(await fresh.articles.get(a.id)).toMatchObject({
    coverage: "missing",
    blocks: [],
    permissions: { display: false },
  });
  const other = crypto.randomUUID();
  await fresh.deliver([
    adaptDelivery({
      ...feedItem,
      id: other,
      withdrawn: true,
      paragraphs: [],
      revision: "c".repeat(64),
    }),
  ]);
  expect(await fresh.articles.count()).toBe(1);
  expect(await fresh.articles.get(a.id)).toMatchObject({
    sourceKey: other,
    withdrawn: true,
  });
  const withdrawn = await restoreLibrary(fresh, backup, true);
  await restoreLibrary(fresh, backup, true, withdrawn);
  expect((await fresh.articles.get(a.id))?.blocks).toEqual([]);
  expect(await fresh.states.get(a.id)).toMatchObject({
    saved: true,
    archived: true,
  });
  const populated = profile();
  await populated.deliver([adaptDelivery({ ...feedItem, id: other })]);
  await restoreLibrary(
    populated,
    backup,
    true,
    await restoreLibrary(populated, backup, true),
  );
  expect(await populated.articles.count()).toBe(1);
  expect((await populated.states.get("rss-" + other))?.saved).toBe(true);
});
it("rejects malformed files, unsupported versions and duplicate identifiers before writing", async () => {
  const { backup } = await sample();
  expect(() => parseBackup("{", "demo")).toThrow();
  for (const change of [
    { version: 2 },
    { entries: [backup.entries[0], backup.entries[0]] },
    { entries: [{ ...backup.entries[0], state: { saved: "yes" } }] },
  ])
    expect(() =>
      parseBackup(JSON.stringify({ ...backup, ...change }), "demo"),
    ).toThrow();
  expect(() => parseBackup(JSON.stringify(backup), "subscriptions")).toThrow();
});

it("checks body and summary export grants independently and rejects an altered cached summary on restore", async () => {
  const { db, a, backup } = await sample();
  await db.articles.put({
    ...a,
    permissions: { ...a.permissions, export: false, exportSummary: true },
  });
  const entry = (await exportLibrary(db, "demo")).entries.find(
    (e) => e.id === a.id,
  )!;
  expect(entry.body).toBeUndefined();
  expect(entry.summaries).toHaveLength(1);
  await db.articles.put({
    ...a,
    permissions: { ...a.permissions, export: true, exportSummary: false },
  });
  const textOnly = (await exportLibrary(db, "demo")).entries.find(
    (e) => e.id === a.id,
  )!;
  expect(textOnly.body).toContain("meet the train after dark.");
  expect(textOnly.summaries).toHaveLength(0);
  const fresh = profile();
  backup.entries.find((e) => e.id === a.id)!.summaries[0].paragraphs = [
    "different edition",
  ];
  const plan = await restoreLibrary(fresh, backup, false);
  expect(plan.rows.find((r) => r.id === a.id)?.omitted.join(" ")).toContain(
    "no matching authorised edition",
  );
  await restoreLibrary(fresh, backup, false, plan);
  expect(await fresh.summaries.count()).toBe(0);
});

it("waits for a legacy delivery replay before exporting portable source identities", async () => {
  const db = profile();
  const a = adaptDelivery(feedItem);
  await db.deliver([{ ...a, portableId: undefined, sourceRef: undefined }]);
  await db.changeFlag(a.id, "saved");
  await expect(exportLibrary(db, "subscriptions")).rejects.toThrow(
    "check for deliveries",
  );
  await db.deliver([a]);
  const backup = await exportLibrary(db, "subscriptions");
  expect(backup.entries[0]).toMatchObject({
    portableId: feedItem.portableId,
    sourceRef: feedItem.sourceRef,
    state: { saved: true },
  });
});
