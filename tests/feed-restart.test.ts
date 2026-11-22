import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { Catalog, INTERVAL, LEASE } from "../service/catalog.ts";
import { Poller } from "../service/poller.ts";
import { parseFeed } from "../service/parser.ts";
import { example, item, rss, publisher } from "./feeds/publisher.ts";

const flags = ["--experimental-strip-types", "--experimental-sqlite"];
const cli = promisify(execFile);
function child(script: string, args: string[], env = process.env) {
  const proc = spawn(process.execPath, [...flags, script, ...args], { env });
  const stopped = once(proc, "exit");
  return {
    proc,
    async stop(signal: NodeJS.Signals = "SIGTERM") {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill(signal);
      await stopped;
    },
  };
}
function ready(proc: ChildProcessWithoutNullStreams, marker: string) {
  return new Promise<void>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("No startup marker: " + output));
    }, 12000);
    function cleanup() {
      clearTimeout(timer);
      proc.stdout.off("data", data);
      proc.stderr.off("data", data);
      proc.off("exit", exit);
    }
    function data(part: Buffer) {
      output += part.toString();
      if (output.includes(marker)) {
        cleanup();
        resolve();
      }
    }
    function exit() {
      cleanup();
      reject(new Error("Child exited before startup: " + output));
    }
    proc.stdout.on("data", data);
    proc.stderr.on("data", data);
    proc.once("exit", exit);
  });
}
function seed(file: string, now: number) {
  const db = new Catalog(file);
  try {
    const parsed = parseFeed(
      rss(item("old", "/old", "Retained original")),
      example,
    );
    const feed = db.subscribe(
      "local",
      {
        url: example,
        aliases: [example],
        parsed,
        etag: '"good"',
        modified: null,
        freshness: null,
        noStore: false,
      },
      now,
      0,
    );
    const page = db.articles("local", 10);
    return { id: feed.id, baseline: page.items[0], cursor: page.changesCursor };
  } finally {
    db.close();
  }
}

it("recovers an interrupted edition, reuses its last committed validator and resumes polling with every reader closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reading-box-wal-"));
  const file = join(dir, "feeds.sqlite");
  const origin = await publisher();
  try {
    let now = Date.parse("2026-11-20T12:00Z");
    const { id, baseline, cursor } = seed(file, now);
    now += INTERVAL;
    const worker = child("tests/feeds/interrupted.ts", [file, id, String(now)]);
    try {
      await ready(worker.proc, "edition waiting at commit");
    } finally {
      await worker.stop("SIGKILL");
    }
    const restored = new Catalog(file);
    const poller = new Poller(restored, {
      download: origin.download,
      now: () => now,
      jitter: () => 0,
    });
    try {
      expect(restored.get("local", id)).toMatchObject({
        etag: '"good"',
        lease_until: now + LEASE,
      });
      expect(restored.nextDue(now)).toBeUndefined();
      expect(restored.articles("local", 10).items).toEqual([baseline]);
      expect(restored.changes("local", 10, cursor).items).toEqual([]);
      expect(
        restored.db.prepare("PRAGMA integrity_check").get()?.integrity_check,
      ).toBe("ok");
      now += LEASE + 1;
      origin.routes.set("/feed", {
        body: rss(item("new", "/new", "Recovered delivery")),
        headers: { etag: '"new"' },
      });
      poller.start();
      await vi.waitFor(() =>
        expect(restored.changes("local", 10, cursor).items).toHaveLength(1),
      );
      expect(
        origin.calls.find((c) => c.url === "/feed")?.headers["if-none-match"],
      ).toBe('"good"');
      expect(restored.articles("local", 10).items).toHaveLength(2);
      // Wait for the real recurring timer. No API request or manual tick drives it.
      origin.routes.set("/feed", { status: 304 });
      now += INTERVAL;
      await vi.waitFor(
        () => expect(restored.get("local", id).last_success).toBe(now),
        { timeout: 6000 },
      );
      expect(restored.changes("local", 10, cursor).items).toHaveLength(1);
      expect(restored.article("local", baseline.id).title).toBe(
        "Retained original",
      );
    } finally {
      await poller.stop();
      restored.close();
    }
  } finally {
    await origin.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 25000);

it("starts and stops the shipped service and reads the same private library with the Windows-compatible CLI after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reading-box-service-"));
  try {
    const listener = createServer().listen(0, "127.0.0.1");
    await once(listener, "listening");
    const address = listener.address();
    if (!address || typeof address === "string")
      throw Error("Test port unavailable");
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    const env = {
      ...process.env,
      READING_BOX_DATA_DIR: dir,
      READING_BOX_PORT: String(address.port),
      READING_BOX_PROFILE: "local",
    };
    const run = async (args: string[], profile = "local") =>
      JSON.parse(
        (
          await cli(process.execPath, [...flags, "service/cli.ts", ...args], {
            env: { ...env, READING_BOX_PROFILE: profile },
          })
        ).stdout,
      );
    const { id, baseline, cursor } = seed(
      join(dir, "feeds.sqlite"),
      Date.now(),
    );
    for (let boot = 0; boot < 2; boot++) {
      const daemon = child("service/main.ts", [], env);
      try {
        await ready(daemon.proc, "Reading Box feed service is running");
        const url = "http://127.0.0.1:" + address.port + "/api/subscriptions";
        expect((await fetch(url)).status).toBe(401);
        expect((await run(["list"])).items[0].id).toBe(id);
        expect((await run(["articles"])).items).toEqual([baseline]);
        expect((await run(["changes", cursor])).items).toEqual([]);
        expect((await run(["list"], "another-installation")).items).toEqual([]);
      } finally {
        await daemon.stop();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 40000);
