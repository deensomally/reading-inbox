import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { preview } from "vite";
import { Catalog, INTERVAL } from "../../service/catalog.ts";
import { feedApp } from "../../service/app.ts";
import { readProofs } from "../../service/config.ts";
import { publisher, fixture, rss, item, example } from "../feeds/publisher.ts";
import { addNotebook, sourceOrigin, riverProof } from "../originals/source.ts";
import { debianReview } from "../../shared/reviewed-article.ts";
export async function ownerPreview(usePublicNetwork = false) {
  const directory = mkdtempSync(join(tmpdir(), "reading-box-owner-"));
  const publisherSite = await publisher();
  addNotebook(publisherSite);
  const testSource = example.replace("/feed", "/journal");
  publisherSite.routes.set("/journal", {
    body: rss(
      item("old", "/old", "First dispatch", "2026-11-01") +
        item("edit", "/edit", "Second dispatch", "2026-11-02"),
    ),
  });
  publisherSite.routes.set("/feeds/atom.xml", {
    body: fixture("debian-election.atom"),
  });
  publisherSite.routes.set("/feed", { body: fixture("substack.rss") });
  publisherSite.routes.set("/briefs", {
    body: '<feed xmlns="http://www.w3.org/2005/Atom"><title>Press desk</title><link rel="license" href="https://creativecommons.org/licenses/by/4.0/"/><entry><id>excerpt</id><title>Short bulletin</title><link href="/brief"/><summary>Published excerpt.</summary></entry><entry><id>uncertain</id><title>Unverified dispatch</title><link href="/dispatch"/><content>Text with no original comparison.</content></entry></feed>',
  });
  const reserve = createServer().listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const addr = reserve.address();
  if (!addr || typeof addr === "string") throw Error("No test port");
  const apiPort = addr.port;
  await new Promise<void>((r) => reserve.close(() => r()));
  const web = await preview({
    configFile: false,
    root: resolve("."),
    build: { outDir: "dist" },
    logLevel: "silent",
    preview: {
      host: "127.0.0.1",
      port: 0,
      proxy: {
        "/api": { target: "http://127.0.0.1:" + apiPort, changeOrigin: false },
      },
    },
  });
  const address = web.httpServer.address();
  if (!address || typeof address === "string") throw Error("No reader port");
  const port = address.port;
  let now = Date.now(),
    db: Catalog,
    service: ReturnType<typeof feedApp> | undefined;
  async function start() {
    db = new Catalog(join(directory, "feeds.sqlite"));
    const proofs = readProofs(directory);
    db.reconcileProofs(proofs);
    service = feedApp(db, {
      readerPort: port,
      proofs,
      ...(!usePublicNetwork && {
        proofs: new Map([...proofs, riverProof]),
        pageOrigins: new Set([sourceOrigin]),
        now: () => now,
        jitter: () => 0,
        download: publisherSite.download,
      }),
    });
    await service.app.listen({ port: apiPort, host: "127.0.0.1" });
    service.poller.start();
  }
  const stop = async () => {
    if (service) {
      await service.app.close();
      service = undefined;
    }
  };
  await start();
  return {
    port,
    url: "http://localhost:" + port,
    testSource,
    start,
    stop,
    async code() {
      const result = await service!.app.inject({
        method: "POST",
        url: "/api/browser/codes",
        headers: { authorization: "Bearer " + db.credential("local") },
      });
      return result.json().code as string;
    },
    rollover() {
      publisherSite.routes.set("/journal", {
        body: rss(
          item("edit", "/edit", "Second dispatch, corrected", "2026-11-02") +
            item("later", "/later", "New while closed", "2026-11-04"),
        ),
      });
      now += INTERVAL + 1;
    },
    observed() {
      return db.articles("local", 100).items.map((a) => a.title as string);
    },
    pageEvidence(url: string) {
      const row = db.db
        .prepare(
          "SELECT a.id FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE f.owner=? AND json_extract(a.metadata,'$.url')=?",
        )
        .get("local", url);
      if (!row) return undefined;
      const a = db.article("local", String(row.id));
      return { coverage: a.coverage, reason: a.reason };
    },
    async publicEdition() {
      const id = db.find("local", debianReview.feed)!.id;
      const rows = db.db
        .prepare("SELECT id FROM articles WHERE feed_id=?")
        .all(id);
      return {
        count: rows.length,
        article: rows
          .map((r) => db.article("local", String(r.id)))
          .find((a) => a.url === debianReview.article),
      };
    },
    async close() {
      await stop();
      await web.close();
      await publisherSite.close();
      rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}
