import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { fixtures, adapt } from "../src/data/fixtures";
import {
  bodyText,
  belongs,
  dateLabel,
  status,
  type Article,
} from "../src/data/model";
import {
  Library,
  summaryKey,
  summaryService,
  mockSummary,
} from "../src/data/store";
let library: Library, a: Article;
beforeEach(async () => {
  library = new Library("test-" + crypto.randomUUID());
  a = await adapt(fixtures[0]);
  await library.deliver([a]);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await library.delete();
});
describe("fixture adapter", () => {
  it("preserves the delivery identity, attribution, layout, rights and coverage", async () => {
    expect(a.sourceKey).toMatch(/^urn:/);
    expect(a.author).toBe("Mara Bell");
    expect(a.blocks.some((b) => b.kind === "heading")).toBe(true);
    const all = await Promise.all(fixtures.map(adapt));
    const mail = all.find((a) => a.source === "newsletter")!;
    expect(mail.sourceKey).toMatch(/^<.+>$/);
    expect(mail.publisher).toBeUndefined();
    expect(dateLabel(mail)).toBe("Received 16 Nov");
    expect(bodyText(mail.blocks)).toMatch(/Until next time,\nIona$/);
    expect(all.find((a) => a.id === "index")!.author).toBeUndefined();
    expect(
      all.find((a) => a.coverage === "missing")!.permissions,
    ).toMatchObject({ display: false, copy: false, summarise: false });
    expect(all.find((a) => a.coverage === "excerpt")!.reason).toBeTruthy();
  });
  it("binds each mock to its source version and progressive paragraph counts", async () => {
    for (const f of fixtures.filter((f) => f.coverage !== "missing")) {
      const source = await adapt(f);
      const mock = JSON.parse(
        await readFile("public/demo/" + f.id + ".json", "utf8"),
      );
      expect(mock.bodyHash).toBe(source.bodyHash);
      expect(mock.essence).toHaveLength(1);
      expect(mock.essence[0].split(/[.!?]+/).filter(Boolean)).toHaveLength(1);
      if (f.coverage === "complete") {
        expect(mock.brief).toHaveLength(1);
        expect(mock.understanding).toHaveLength(3);
        expect(mock.brief[0].length).toBeGreaterThan(mock.essence[0].length);
        expect(mock.understanding.join(" ").length).toBeGreaterThan(
          mock.brief[0].length,
        );
      }
    }
  });
});
describe("local reading state", () => {
  it("records what was actually viewed independently from handoffs and flags", async () => {
    await Promise.all([
      library.changeFlag(a.id, "saved"),
      library.changeFlag(a.id, "archived"),
    ]);
    await library.viewed(a.id, "original", false);
    await library.states.update(a.id, { publisherOpened: true });
    let state = (await library.states.get(a.id))!;
    expect(status(state)).toBe("Opened");
    expect(belongs("Saved", state) && belongs("Archive", state)).toBe(true);
    expect(belongs("Inbox", state) || belongs("Unread", state)).toBe(false);
    await library.viewed(a.id, "brief", true);
    expect(status((await library.states.get(a.id))!)).toBe("Skimmed");
    await library.viewed(a.id, "original", true);
    await library.viewed(a.id, "essence", true);
    state = (await library.states.get(a.id))!;
    expect(status(state)).toBe("Original opened");
    expect(state.lastStage).toBe("essence");
  });
  it("preserves flags and depth across a source edit and discards the obsolete summary", async () => {
    const request = summaryService(library, async (source) => [
      source.bodyHash,
    ]);
    await request(a, "essence");
    await library.changeFlag(a.id, "saved");
    await library.changeFlag(a.id, "archived");
    await library.viewed(a.id, "brief", true);
    const changed = await adapt({
      ...fixtures[0],
      delivery: {
        kind: "rss",
        guid: a.sourceKey,
        blocks: [{ kind: "paragraph", text: "A revised edition." }],
      },
    });
    await library.deliver([changed]);
    expect(await library.summaries.count()).toBe(0);
    await expect(request(a, "essence")).rejects.toThrow("unavailable");
    expect(await request(changed, "essence")).toEqual([changed.bodyHash]);
    expect(await library.states.get(a.id)).toMatchObject({
      saved: true,
      archived: true,
      lastStage: "brief",
    });
  });
});
describe("on-demand summaries", () => {
  it("coalesces concurrent requests, caches success and retries a failure", async () => {
    const provider = vi
      .fn(async () => ["local"])
      .mockRejectedValueOnce(new Error("offline"));
    const request = summaryService(library, provider);
    await expect(request(a, "essence")).rejects.toThrow("offline");
    expect(await library.summaries.count()).toBe(0);
    await Promise.all([request(a, "essence"), request(a, "essence")]);
    await request(a, "essence");
    expect(provider).toHaveBeenCalledTimes(2);
    await request(a, "brief");
    expect(provider).toHaveBeenCalledTimes(3);
    expect((await library.meta.get("requests"))?.value).toBe(3);
  });
  it("rechecks permissions on hits and before committing in-flight results", async () => {
    const request = summaryService(library, async () => ["cached"]);
    await request(a, "essence");
    const restricted = {
      ...a,
      permissions: { ...a.permissions, summarise: false },
    };
    const stale = summaryService(library, async () => {
      await library.deliver([restricted]);
      return ["stale"];
    });
    await expect(stale(a, "brief")).rejects.toThrow("unavailable");
    await expect(request(a, "essence")).rejects.toThrow("unavailable");
    expect(await library.summaries.count()).toBe(0);
  });
  it("separates coverage, revision, stage, model and prompt versions", () => {
    expect(
      new Set([
        summaryKey(a, "brief"),
        summaryKey(a, "essence"),
        summaryKey({ ...a, coverage: "excerpt" }, "brief"),
        summaryKey({ ...a, bodyHash: "v2" }, "brief"),
        summaryKey(a, "brief", "model2"),
        summaryKey(a, "brief", "fixture-v1", "prompt2"),
      ]).size,
    ).toBe(6);
  });
  it("refuses mock prose for a different source revision", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ bodyHash: "old", brief: ["older text"] }),
    );
    await expect(mockSummary(a, "brief")).rejects.toThrow("revision");
  });
});
