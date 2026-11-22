import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Catalog, INTERVAL } from "../service/catalog.ts";
import { feedApp } from "../service/app.ts";
import { createDownloader } from "../service/network.ts";
import { FeedError, digest } from "../service/types.ts";
import { parseFeed, reviewKey } from "../service/parser.ts";
import { example, item, publisher, rss } from "./feeds/publisher.ts";

let db: Catalog,
  service: ReturnType<typeof feedApp>,
  origin: Awaited<ReturnType<typeof publisher>>,
  now: number;
const a = item("opaque:1", "/one?q=1", "First", "2026-11-02");
const b = item("opaque:2", "/two", "Second", "2026-10-01");
beforeEach(async () => {
  origin = await publisher();
  db = new Catalog(":memory:");
  now = Date.parse("2026-11-20T12:00Z");
  origin.routes.set("/feed", {
    body: rss(a + b),
    headers: {
      etag: '"one"',
      "last-modified": "Fri, 20 Nov 2026 10:00:00 GMT",
    },
  });
  service = feedApp(db, {
    download: createDownloader(origin.wire, () => now),
    now: () => now,
    jitter: () => 0,
  });
});
afterEach(async () => {
  await service.app.close();
  await origin.close();
});
function get(url: string, profile = "local") {
  return service.app.inject({
    method: "GET",
    url,
    headers: { authorization: "Bearer " + db.credential(profile) },
  });
}
async function subscribe(url = example, profile = "local") {
  const res = await service.app.inject({
    method: "POST",
    url: "/api/subscriptions",
    headers: { authorization: "Bearer " + db.credential(profile) },
    payload: { url },
  });
  expect(res.statusCode).toBe(200);
  return res.json().subscription.id as string;
}

it("journals every observed article, keeps stable IDs through edits and rollover, and paginates at a fixed high-water mark", async () => {
  const id = await subscribe();
  expect(await subscribe()).toBe(id);
  const first = (await get("/api/articles?limit=1")).json();
  expect(first.items.map((e: { title: string }) => e.title)).toEqual(["First"]);
  const firstId = first.items[0].id,
    firstReceived = first.items[0].received;
  now += INTERVAL;
  origin.routes.set("/feed", {
    body: rss(
      item("new-guid", "/one?q=1", "Corrected", "2026-09-30") +
        item("third", "/3", "Third", "2026-11-19"),
    ),
    headers: { etag: '"two"' },
  });
  await service.poller.tick(); // No reader or HTTP client is open during this delivery.
  const oldPage = (
    await get("/api/articles?limit=1&cursor=" + first.nextCursor)
  ).json();
  expect(oldPage.items.map((e: { title: string }) => e.title)).toEqual([
    "Second",
  ]);
  expect(oldPage.nextCursor).toBe(null);
  const current = (await get("/api/articles")).json().items;
  expect(current.map((e: { title: string }) => e.title)).toEqual([
    "Third",
    "Second",
    "Corrected",
  ]);
  expect(current[2]).toMatchObject({ id: firstId, received: firstReceived });
  expect(current[2].revision).not.toBe(first.items[0].revision);
  expect(
    origin.calls.filter((c) => c.url === "/feed").at(-1)?.headers,
  ).toMatchObject({
    "if-none-match": '"one"',
    "if-modified-since": "Fri, 20 Nov 2026 10:00:00 GMT",
  });
  const delta = (
    await get("/api/changes?limit=1&cursor=" + first.changesCursor)
  ).json();
  expect(delta.items[0].article.title).toBe("Corrected");
  expect(delta.hasMore).toBe(true);
  const last = (await get("/api/changes?cursor=" + delta.nextCursor)).json();
  expect(last.items[0].article.title).toBe("Third");
  expect(last.hasMore).toBe(false);
  now += INTERVAL;
  await service.poller.refresh("local", id);
  expect(
    (await get("/api/changes?cursor=" + last.nextCursor)).json().items,
  ).toEqual([]);
});

it("accepts a custom-domain home page and permanent redirect aliases, including replay under either address", async () => {
  origin.routes.set("/home", {
    body: '<html><head><link rel="alternate" type="application/rss+xml" href="/old"></head></html>',
    headers: { "content-type": "text/html" },
  });
  origin.routes.set("/old", { status: 301, headers: { location: "/feed" } });
  const id = await subscribe("https://publisher.example.org/home");
  expect(await subscribe("https://publisher.example.org/old")).toBe(id);
  expect(await subscribe(example)).toBe(id);
  expect(db.get("local", id).url).toBe(example);
  origin.routes.set("/feed", {
    status: 308,
    headers: { location: "/new-feed" },
  });
  origin.routes.set("/new-feed", { body: rss(a + b) });
  now += INTERVAL;
  await service.poller.tick();
  expect(await subscribe("https://publisher.example.org/new-feed")).toBe(id);
  expect(
    origin.calls.filter((c) => c.url === "/new-feed")[0].headers[
      "if-none-match"
    ],
  ).toBeUndefined();
  expect((await get("/api/articles")).json().items).toHaveLength(2);
});

it("does not conflate ambiguous links, missing IDs or identical titles across publications", async () => {
  const anonymous =
    "<item><title>Anonymous</title><description>Edition one</description></item>";
  origin.routes.set("/feed", {
    body: rss(
      item("g1", "/shared", "Same") +
        item("g2", "/shared", "Same") +
        anonymous +
        item("", "/solo?lang=en", "Same"),
    ),
  });
  const id = await subscribe();
  origin.routes.set("/feed", {
    body: rss(
      anonymous +
        item("", "/solo?lang=en", "Same") +
        item("g2", "/shared", "Same") +
        item("g1", "/shared", "Same") +
        anonymous.replace("Edition one", "Edition two"),
    ),
  });
  now += INTERVAL;
  await service.poller.refresh("local", id);
  expect((await get("/api/articles")).json().items).toHaveLength(5);
  origin.routes.set("/another", { body: rss(item("g1", "/shared", "Same")) });
  await subscribe("https://publisher.example.org/another");
  expect((await get("/api/articles")).json().items).toHaveLength(6);
});

it("keeps conditional validators, entries and cursor intact after malformed XML or a partial SQLite write", async () => {
  const id = await subscribe();
  const before = (await get("/api/articles")).json();
  origin.routes.set("/feed", {
    body: rss(a) + "<broken",
    headers: { etag: '"bad"' },
  });
  now += INTERVAL;
  expect(
    (await service.poller.refresh("local", id)).subscription.errorCode,
  ).toBe("invalid_feed");
  expect(db.get("local", id).etag).toBe('"one"');
  origin.routes.set("/feed", {
    body: rss(item("new", "/new", "New") + item("later", "/later", "Stop")),
    headers: { etag: '"uncommitted"' },
  });
  db.db.exec(
    "CREATE TEMP TRIGGER write_failure BEFORE INSERT ON changes WHEN json_extract(NEW.metadata,'$.title')='Stop' BEGIN SELECT RAISE(ABORT,'interrupted'); END",
  );
  now += INTERVAL;
  expect(
    (await service.poller.refresh("local", id)).subscription.errorCode,
  ).toBe("storage_error");
  expect((await get("/api/articles")).json()).toEqual(before);
  expect(db.get("local", id).etag).toBe('"one"');
  db.db.exec("DROP TRIGGER write_failure");
  now += INTERVAL;
  await service.poller.tick();
  expect(db.get("local", id).etag).toBe('"uncommitted"');
  expect((await get("/api/articles")).json().items).toHaveLength(4);
});

it("honours HTTP freshness, RSS ttl, 304, rate-limit cooldown and paused or unavailable feeds", async () => {
  origin.routes.set("/feed", {
    body: rss(a, "<ttl>60</ttl>"),
    headers: { etag: '"a"', "cache-control": "max-age=7200", age: "60" },
  });
  const id = await subscribe(),
    originally = db.get("local", id);
  expect(originally.next_poll).toBe(now + 7140000);
  expect((await service.poller.refresh("local", id)).status).toBe("cooldown");
  now = originally.next_poll;
  origin.routes.set("/feed", { status: 304, headers: { etag: '"still-a"' } });
  expect((await service.poller.refresh("local", id)).status).toBe(
    "not_modified",
  );
  expect(db.get("local", id)).toMatchObject({
    ttl: 3600000,
    freshness: 7140000,
    etag: '"still-a"',
    last_success: now,
  });
  now += 7140000;
  const until = now + 3 * 3600000;
  origin.routes.set("/feed", {
    status: 429,
    headers: { "retry-after": new Date(until).toUTCString() },
  });
  expect(
    (await service.poller.refresh("local", id)).subscription.retryAfter,
  ).toBe(until);
  now = until - 1;
  const calls = origin.calls.length;
  await service.poller.tick();
  expect((await service.poller.refresh("local", id)).status).toBe("cooldown");
  expect(origin.calls.length).toBe(calls);
  now++;
  origin.routes.set("/feed", {
    status: 503,
    headers: { "retry-after": "240" },
  });
  await service.poller.tick();
  expect(db.get("local", id).not_before).toBe(now + 240000);
  now += 240000;
  origin.routes.set("/feed", { status: 410 });
  await service.poller.tick();
  expect(db.get("local", id)).toMatchObject({
    paused: 1,
    error_code: "http_410",
  });
  now += 24 * 3600000;
  expect(db.nextDue(now)).toBeUndefined();
  origin.routes.set("/feed", { body: rss(a) });
  expect((await service.poller.refresh("local", id)).subscription.paused).toBe(
    false,
  );
  expect((await get("/api/articles")).json().items).toHaveLength(1);
});

it("joins concurrent manual refreshes and fences a response arriving after unsubscribe", async () => {
  const id = await subscribe();
  now += INTERVAL;
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  origin.routes.set("/feed", {
    body: rss(item("late", "/late", "Late")),
    wait,
  });
  const first = service.poller.refresh("local", id),
    second = service.poller.refresh("local", id);
  await vi.waitFor(() =>
    expect(origin.calls.filter((c) => c.url === "/feed")).toHaveLength(2),
  );
  const auth = { authorization: "Bearer " + db.credential("local") };
  await service.app.inject({
    method: "DELETE",
    url: "/api/subscriptions/" + id,
    headers: auth,
  });
  release();
  expect((await first).status).toBe("superseded");
  expect(await second).toEqual(await first);
  expect((await get("/api/articles")).json().items).toHaveLength(2);
  expect(db.nextDue(now + INTERVAL)).toBeUndefined();
  expect(await subscribe()).toBe(id);
  expect((await get("/api/articles")).json().items).toHaveLength(3);
});

it("authenticates every API, scopes articles, subscriptions and cursors, and rejects foreign origins", async () => {
  const id = await subscribe();
  expect((await get("/api/articles", "other")).json().items).toEqual([]);
  const first = (await get("/api/articles?limit=1")).json();
  expect(
    (await get("/api/articles/" + first.items[0].id, "other")).statusCode,
  ).toBe(404);
  expect(
    (await get("/api/articles?cursor=" + first.nextCursor, "other")).statusCode,
  ).toBe(400);
  expect((await get("/api/articles?limit=0")).statusCode).toBe(400);
  for (const req of [
    { headers: {}, status: 401 },
    {
      headers: {
        authorization: "Bearer " + db.credential("local"),
        host: "book.example.org",
      },
      status: 403,
    },
    {
      headers: {
        authorization: "Bearer " + db.credential("local"),
        origin: "https://other.example.org",
      },
      status: 403,
    },
  ])
    expect(
      (
        await service.app.inject({
          url: "/api/subscriptions",
          headers: req.headers,
        })
      ).statusCode,
    ).toBe(req.status);
  expect(
    (
      await service.app.inject({
        method: "DELETE",
        url: "/api/subscriptions/" + id,
        headers: { authorization: "Bearer " + db.credential("other") },
      })
    ).statusCode,
  ).toBe(404);
  expect((await get("/api/articles")).headers["cache-control"]).toBe(
    "no-store",
  );
  expect(await subscribe(example, "other")).not.toBe(id);
});

it("handles explicit withdrawals separately from rollover and purges retained text when storage permission changes", async () => {
  const entry =
    '<entry><id>urn:dispatch</id><title>Dispatch</title><link href="/dispatch"/><content>Reviewed last line.</content></entry>';
  const feed = (s: string) =>
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:at="http://purl.org/atompub/tombstones/1.0"><title>Press</title><link rel="license" href="https://creativecommons.org/licenses/by/4.0/"/>' +
    s +
    "</feed>";
  const proofs = new Map([
    [
      reviewKey(example, "https://publisher.example.org/dispatch"),
      digest("Reviewed last line."),
    ],
  ]);
  origin.routes.set("/feed", { body: feed(entry), headers: { etag: '"a"' } });
  const id = await subscribe();
  const article = (await get("/api/articles")).json().items[0];
  expect((await get("/api/articles/" + article.id)).json().paragraphs).toEqual([
    "Reviewed last line.",
  ]);
  now += INTERVAL;
  origin.routes.set("/feed", {
    status: 304,
    headers: { "cache-control": "no-store" },
  });
  await service.poller.tick();
  expect((await get("/api/articles/" + article.id)).json().paragraphs).toEqual(
    [],
  );
  expect(db.get("local", id).etag).toBeNull();
  now += INTERVAL;
  origin.routes.set("/feed", {
    body: feed('<at:deleted-entry ref="urn:dispatch"/>'),
  });
  await service.poller.tick();
  expect((await get("/api/changes")).json().items.at(-1).type).toBe(
    "withdrawal",
  );
  now += INTERVAL;
  origin.routes.set("/feed", { body: feed(entry) });
  await service.poller.tick();
  expect((await get("/api/articles/" + article.id)).json()).toMatchObject({
    withdrawn: true,
    coverage: "missing",
    paragraphs: [],
  });
  const reviewed = parseFeed(feed(entry), example, { proofs });
  const different = db.subscribe(
    "proof-review",
    {
      url: example,
      aliases: [example],
      parsed: reviewed,
      etag: null,
      modified: null,
      freshness: null,
      noStore: false,
    },
    now,
    0,
  );
  expect(db.articles(different.owner, 5).items[0].coverage).toBe("complete");
  db.reconcileProofs(new Map());
  expect(db.articles(different.owner, 5).items[0].coverage).toBe("unverified");
});

it("records timeout without discarding the last good edition", async () => {
  const id = await subscribe();
  now += INTERVAL;
  const { Poller } = await import("../service/poller.ts");
  const failing = new Poller(db, {
    now: () => now,
    download: async () => {
      throw new FeedError("timeout", "Publisher timed out.", 502);
    },
  });
  expect((await failing.refresh("local", id)).subscription).toMatchObject({
    errorCode: "timeout",
    lastSuccess: now - INTERVAL,
  });
  expect((await get("/api/articles")).json().items).toHaveLength(2);
});

it("retains the original publication date when a later observation omits it", async () => {
  await subscribe();
  origin.routes.set("/feed", {
    body: rss(
      '<item><guid isPermaLink="false">opaque:1</guid><link>/one?q=1</link><title>Later title</title></item>',
    ),
  });
  now += INTERVAL;
  await service.poller.tick();
  expect((await get("/api/articles")).json().items[0]).toMatchObject({
    title: "Later title",
    published: "2026-11-02T00:00:00.000Z",
    sourceId: "opaque:1",
  });
});

it("rechecks inherited rights when licensed entries leave the feed window", async () => {
  const license =
    '<link rel="license" href="https://creativecommons.org/licenses/by/4.0/"/>';
  const feed = (body: string) =>
    '<feed xmlns="http://www.w3.org/2005/Atom"><title>Field reports</title>' +
    body +
    "</feed>";
  const entry = (id: string, rights: string) =>
    "<entry><id>" +
    id +
    "</id><title>" +
    id +
    "</title>" +
    rights +
    "<summary>A permitted dispatch.</summary></entry>";
  origin.routes.set("/feed", {
    body: feed(license + entry("inherited", "") + entry("individual", license)),
  });
  await subscribe();
  const snapshot = (await get("/api/articles")).json();
  const inherited = snapshot.items.find(
    (e: { title: string }) => e.title === "inherited",
  ).id;
  const individual = snapshot.items.find(
    (e: { title: string }) => e.title === "individual",
  ).id;
  origin.routes.set("/feed", {
    body: feed("<rights>All rights reserved</rights>"),
  });
  now += INTERVAL;
  await service.poller.tick();
  expect((await get("/api/articles/" + inherited)).json()).toMatchObject({
    license: null,
    paragraphs: [],
    permissions: { retain: false },
  });
  expect((await get("/api/articles/" + individual)).json()).toMatchObject({
    permissionSource: "entry",
    paragraphs: ["A permitted dispatch."],
  });
  expect(
    (await get("/api/changes?cursor=" + snapshot.changesCursor)).json().items,
  ).toHaveLength(1);
});
