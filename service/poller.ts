import { Catalog, describeFeed, type Edition, type Feed } from "./catalog.ts";
import { createDownloader, subscriptionUrl } from "./network.ts";
import {
  decodeDocument,
  discoverAlternate,
  parseFeed,
  reviewKey,
  type Proofs,
} from "./parser.ts";
import { FeedError, publisherError, type Download } from "./types.ts";

function storageRestricted(headers: Headers) {
  return (
    /\b(?:no-store|private)\b/i.test(headers.get("cache-control") ?? "") ||
    /\b(?:noarchive|nosnippet|none)\b/i.test(headers.get("x-robots-tag") ?? "")
  );
}
function freshness(headers: Headers, now: number) {
  const control = headers.get("cache-control") ?? "";
  if (/\bno-cache\b/i.test(control)) return 0;
  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(control);
  if (maxAge)
    return Math.min(
      8640000000000000 - now,
      Math.max(0, Number(maxAge[1]) - (Number(headers.get("age")) || 0)) * 1000,
    );
  const expires = Date.parse(headers.get("expires") ?? "");
  return Number.isFinite(expires) ? Math.max(0, expires - now) : null;
}
type Result = { status: string; subscription: ReturnType<typeof describeFeed> };
export interface PollOptions {
  download?: Download;
  now?: () => number;
  jitter?: () => number;
  proofs?: Proofs;
  pageOrigins?: ReadonlySet<string>;
}
import { extractPage } from "./original-page.ts";
export class Poller {
  private catalog: Catalog;
  private download: Download;
  private now: () => number;
  private jitter: () => number;
  private proofs: Proofs;
  private pageOrigins: ReadonlySet<string>;
  private pending = new Map<string, Promise<unknown>>();
  private tail = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  constructor(catalog: Catalog, options: PollOptions = {}) {
    this.catalog = catalog;
    this.now = options.now ?? Date.now;
    this.download = options.download ?? createDownloader(undefined, this.now);
    this.jitter = options.jitter ?? (() => Math.floor(Math.random() * 90000));
    this.pageOrigins = options.pageOrigins ?? new Set();
    this.proofs = options.proofs ?? new Map();
  }
  // A personal installation needs one publisher request at a time. Manual, scheduled and
  // discovery requests share this bounded queue, so they also respect per-host concurrency.
  private queue<T>(key: string, work: () => Promise<T>) {
    const running = this.pending.get(key);
    if (running) return running as Promise<T>;
    if (this.pending.size >= 64)
      throw new FeedError(
        "busy",
        "The feed service is busy. Try again shortly.",
        503,
      );
    const result = this.tail.then(work).finally(() => this.pending.delete(key));
    this.tail = result.then(
      () => {},
      () => {},
    );
    this.pending.set(key, result);
    return result;
  }
  private async edition(url: string, f?: Feed): Promise<Edition> {
    const validators = f
      ? { url: f.validator_url, etag: f.etag, modified: f.modified }
      : undefined;
    let response = await this.download(url, validators);
    let aliases = response.aliases;
    let parsed = null;
    if (response.status === 200) {
      let input = decodeDocument(
        response.bytes,
        response.headers.get("content-type"),
      );
      if (
        !f &&
        (/text\/html/i.test(response.headers.get("content-type") ?? "") ||
          /^\s*(?:<!doctype\s+html|<html\b)/i.test(input))
      ) {
        const alternate = discoverAlternate(input, response.url);
        response = await this.download(alternate);
        if (response.status !== 200)
          throw publisherError(response.status, response.headers, this.now());
        input = decodeDocument(
          response.bytes,
          response.headers.get("content-type"),
        );
        aliases = [...aliases, ...response.aliases];
      }
      parsed = parseFeed(input, response.url, {
        storeText: !storageRestricted(response.headers),
        proofs: this.proofs,
        pageOrigins: this.pageOrigins,
      });
    } else if (
      response.status !== 304 ||
      response.url !== validators?.url ||
      !(validators.etag || validators.modified)
    ) {
      throw publisherError(response.status, response.headers, this.now());
    }
    const noStore = storageRestricted(response.headers);
    return {
      url: response.url,
      aliases,
      parsed,
      noStore,
      freshness: freshness(response.headers, this.now()),
      etag: noStore
        ? null
        : (response.headers.get("etag") ?? (parsed ? null : (f?.etag ?? null))),
      modified: noStore
        ? null
        : (response.headers.get("last-modified") ??
          (parsed ? null : (f?.modified ?? null))),
    };
  }
  subscribe(owner: string, input: string) {
    const url = subscriptionUrl(input);
    return this.queue(JSON.stringify(["add", owner, url]), async () => {
      const prior = this.catalog.find(owner, url);
      if (prior?.active)
        return { status: "subscribed", subscription: describeFeed(prior) };
      if (prior) {
        this.catalog.reactivate(owner, prior.id, this.now());
        return this.poll(owner, prior.id, true);
      }
      const edition = await this.edition(url);
      return {
        status: "subscribed",
        subscription: describeFeed(
          this.catalog.subscribe(owner, edition, this.now(), this.jitter()),
        ),
      };
    });
  }
  private async poll(
    owner: string,
    id: string,
    manual: boolean,
  ): Promise<Result> {
    const f = this.catalog.claim(owner, id, this.now(), manual);
    if (!f) {
      const current = this.catalog.get(owner, id);
      return {
        status: current.lease_until > this.now() ? "busy" : "cooldown",
        subscription: describeFeed(current),
      };
    }
    let status: string;
    try {
      const edition = await this.edition(f.url, f);
      const applied = this.catalog.commit(
        f,
        edition,
        this.now(),
        this.jitter(),
      );
      status = applied
        ? edition.parsed
          ? "updated"
          : "not_modified"
        : "superseded";
    } catch (err) {
      // A failed database transaction must never advance validators or the article journal.
      const issue =
        err instanceof FeedError
          ? err
          : new FeedError(
              "storage_error",
              "Could not commit the refresh. Check free space and retry.",
              503,
            );
      this.catalog.fail(f, issue, this.now());
      status = "failed";
    }
    return { status, subscription: describeFeed(this.catalog.get(owner, id)) };
  }
  refresh(owner: string, id: string, manual = true) {
    return this.queue(JSON.stringify(["poll", owner, id]), () =>
      this.poll(owner, id, manual),
    );
  }
  original(owner: string, id: string) {
    return this.queue(JSON.stringify(["original", owner, id]), async () => {
      const input = this.catalog.pageInput(owner, id);
      if (
        input.pageCandidate &&
        !input.withdrawn &&
        (input.checked === null || this.now() - input.checked >= 60000)
      ) {
        const feed = this.catalog.get(owner, input.feedId);
        const reviewedText = this.proofs.get(
          reviewKey(feed.validator_url, input.pageCandidate.url),
        );
        const result = await extractPage(
          { ...input, reviewedText, retained: this.catalog.article(owner, id) },
          this.download,
          this.now,
        );
        if (result.edition) {
          this.catalog.recordPage(
            owner,
            id,
            input.revision,
            result.edition,
            this.now(),
            !result.issue,
          );
        }
        return result.issue;
      }
    });
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = this.catalog.nextDue(this.now());
      if (due) await this.refresh(due.owner, due.id, false);
    } finally {
      this.ticking = false;
    }
  }
  start() {
    if (this.timer) return;
    const tick = () =>
      void this.tick().catch(() =>
        console.error(
          "Feed scheduler could not complete a check. It will retry.",
        ),
      );
    this.timer = setInterval(tick, 2000);
    this.timer.unref();
    tick();
  }
  async stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.tail;
  }
}
