import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Catalog } from "../service/catalog.ts";
import { feedApp } from "../service/app.ts";
import { previewOpml, exportOpml } from "../service/opml.ts";
import { publisher, rss, item } from "./feeds/publisher.ts";
import type { Outline } from "../shared/opml.ts";

const wrap = (body: string) =>
  '<opml version="2.0"><body>' + body + "</body></opml>";
it("classifies every outline without dereferencing it and rejects unsafe or excessive XML", () => {
  const db = new Catalog(":memory:");
  try {
    const rows = previewOpml(
      db,
      "owner",
      wrap(`<outline text="日本"><outline text="News &amp; Arts">
      <outline text="Café" xmlUrl="https://examPle.org/news?a=1&amp;b=2#fragment"/>
      <outline xmlUrl="https://example.org/news?a=1&amp;b=2"/>
      <outline xmlUrl=""/>
      <outline xmlUrl="relative"/>
      <outline xmlUrl="http://localhost/feed"/>
      <outline xmlUrl="https://account:credential@example.org/"/>
      <outline xmlUrl="https://example.org/feed?token=confidential"/>
      <outline type="link" url="https://example.org/"/>
      <outline xmlUrl="ftp://example.org/"/>
      <outline xmlUrl="https://example.org/feed" htmlUrl="http://127.0.0.1/"/>
    </outline></outline>`),
    );
    expect(rows.map((x) => x.status)).toEqual([
      "valid",
      "duplicate",
      "invalid",
      "invalid",
      "private",
      "private",
      "private",
      "unsupported",
      "unsupported",
      "private",
    ]);
    expect(rows[0].entry).toEqual({
      xmlUrl: "https://example.org/news?a=1&b=2",
      title: "Café",
      folders: ["日本", "News & Arts"],
    });
    expect(JSON.stringify(rows)).not.toMatch(/account:credential|confidential/);
    expect(rows.filter((r) => r.entry)).toHaveLength(1);
    for (const xml of [
      wrap("<outline>"),
      wrap('<outline xmlUrl="&undefined;"/>'),
      "<!DOCTYPE opml>" + wrap(""),
      '<!DOCTYPE opml [<!ENTITY note "example">]>' + wrap(""),
      wrap("<outline>".repeat(20) + "</outline>".repeat(20)),
      wrap("<outline/>".repeat(2100)),
      wrap(" ".repeat(1024 * 1024)),
      wrap("").replace("2.0", "1.0"),
      wrap("") + wrap(""),
    ])
      expect(() => previewOpml(db, "owner", xml)).toThrow();
    expect(db.subscriptions("owner")).toHaveLength(0);
  } finally {
    db.close();
  }
});

it("commits successful entries and folder placements across failures, restart, aliases and re-import", async () => {
  const remote = await publisher(),
    dir = mkdtempSync(join(tmpdir(), "reading-box-opml-"));
  function start() {
    const db = new Catalog(join(dir, "feeds.sqlite"));
    return { db, ...feedApp(db, { download: remote.download }) };
  }
  let service = start();
  const origin = "https://publisher.example.org",
    url = origin + "/rss?a=1&b=2",
    alias = origin + "/alias";
  const headers = { authorization: "Bearer " + service.db.credential("owner") };
  const xml = wrap(
    '<outline text="Météo &amp; 海"><outline text="Nord"><outline title="L’été &quot;ici&quot;" xmlUrl="' +
      alias +
      '" htmlUrl="' +
      origin +
      '/about?a=1&amp;b=2"/></outline></outline><outline text="Evening" xmlUrl="' +
      origin +
      '/late"/>',
  );
  const preview = async (input: string) =>
    (
      await service.app.inject({
        method: "POST",
        url: "/api/opml/preview",
        headers,
        payload: { xml: input },
      })
    ).json().rows;
  const add = (entry: Outline) =>
    service.app.inject({
      method: "POST",
      url: "/api/opml/import",
      headers,
      payload: entry,
    });
  try {
    remote.routes.set("/alias", { status: 301, headers: { location: url } });
    remote.routes.set("/rss?a=1&b=2", {
      body: rss(item("1", "/one", "PRIVATE READING HISTORY")),
    });
    const rows = await preview(xml);
    expect(rows.map((r: { status: string }) => r.status)).toEqual([
      "valid",
      "valid",
    ]);
    expect(remote.calls).toHaveLength(0);
    const initial = await add(rows[0].entry);
    expect(initial.json().added).toBe(true);
    const id = initial.json().subscription.id;
    expect((await add(rows[1].entry)).statusCode).toBeGreaterThanOrEqual(400);
    await service.app.close();
    service = start();
    const again = await preview(xml);
    expect(again[0].status).toBe("duplicate");
    expect(again[0].entry).toBeUndefined();
    const count = remote.calls.length;
    // A response lost after commit or a newly discovered alias must be safe to replay.
    expect((await add(rows[0].entry)).json().added).toBe(false);
    expect(remote.calls).toHaveLength(count);
    expect(
      (
        await preview(
          wrap(
            '<outline text="Elsewhere"><outline xmlUrl="' +
              url.replace("&", "&amp;") +
              '"/></outline>',
          ),
        )
      )[0].status,
    ).toBe("duplicate");
    remote.routes.set("/another", { status: 301, headers: { location: url } });
    expect(
      (
        await add({
          ...rows[0].entry,
          xmlUrl: origin + "/another",
          folders: ["Elsewhere"],
        })
      ).json(),
    ).toMatchObject({ added: false, subscription: { id } });
    remote.routes.set("/late", { body: rss("") });
    expect((await add(again[1].entry)).json().added).toBe(true);
    const exported = (
      await service.app.inject({ url: "/api/opml/export", headers })
    ).json().xml;
    expect(exported).toContain("L’été &quot;ici&quot;");
    expect(exported).toContain("Météo &amp; 海");
    expect(exported).toContain(
      "xmlUrl=" + JSON.stringify(url.replace("&", "&amp;")),
    );
    expect(exported).toContain('htmlUrl="' + origin + '/about?a=1&amp;b=2"');
    expect(exported).not.toMatch(/PRIVATE READING HISTORY|Bearer|signing-key/);
    expect(service.db.subscriptions("owner")).toHaveLength(2);
    expect(
      (await preview(exported)).every((r: { entry?: Outline }) => !r.entry),
    ).toBe(true);
    service.db.unsubscribe("owner", id);
    expect(exportOpml(service.db, "owner")).not.toContain("Nord");
    expect(exportOpml(service.db, "other")).not.toContain("Evening");
    expect(
      (await service.app.inject({ url: "/api/opml/export" })).statusCode,
    ).toBe(401);
    expect(
      (await add({ ...rows[0].entry, xmlUrl: "http://127.0.0.1/" })).statusCode,
    ).toBeGreaterThanOrEqual(400);
  } finally {
    await service.app.close();
    await remote.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("opens a populated Milestone 4 service and exports existing active feeds at the root", async () => {
  const site = await publisher(),
    dir = mkdtempSync(join(tmpdir(), "reading-box-m4-opml-")),
    file = join(dir, "feeds.sqlite");
  let db = new Catalog(file),
    service = feedApp(db, { download: site.download });
  try {
    site.routes.set("/daily", {
      body: rss(item("saved", "/article", "A retained article")),
    });
    const feed = await service.poller.subscribe(
      "owner",
      "https://publisher.example.org/daily",
    );
    const prior = db.articles("owner", 5),
      credential = db.credential("owner");
    db.db.exec("DROP TABLE subscription_outlines; PRAGMA user_version=2");
    await service.app.close();
    db = new Catalog(file);
    service = feedApp(db, { download: site.download });
    expect(db.credential("owner")).toBe(credential);
    expect(db.articles("owner", 5)).toEqual(prior);
    expect(db.get("owner", feed.subscription.id).active).toBe(1);
    expect(db.exportOutlines("owner")).toEqual([
      {
        title: "Field reports",
        xmlUrl: "https://publisher.example.org/daily",
        folders: [],
      },
    ]);
  } finally {
    await service.app.close();
    await site.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
