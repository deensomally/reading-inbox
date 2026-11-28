import { restrictedUses, responseDirectives } from "./private-policy.ts";
import type { Outline } from "../shared/opml.ts";
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
    /\bno-store\b/i.test(headers.get("cache-control") ?? "") ||
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
  terms?: ReadonlyMap<string, "feed-only" | "no-retention">;
}
import { extractPage } from "./original-page.ts";
export class Poller {
  private catalog: Catalog;
  private download: Download;
  private now: () => number;
  private jitter: () => number;
  private proofs: Proofs;
  private terms: ReadonlyMap<string, "feed-only" | "no-retention">;
  private pending = new Map<string, Promise<unknown>>();
  private tail = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  constructor(catalog: Catalog, options: PollOptions = {}) {
    this.catalog = catalog;
    this.now = options.now ?? Date.now;
    this.terms = options.terms ?? new Map();
    this.download =
      options.download ??
      createDownloader(undefined, this.now, 15000, this.terms);
    this.jitter = options.jitter ?? (() => Math.floor(Math.random() * 90000));
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
        storeText:
          !storageRestricted(response.headers) &&
          this.terms.get(new URL(response.url).origin) !== "no-retention",
        terms: this.terms,
        headerDirectives: responseDirectives(response.headers),
        proofs: this.proofs,
      });
    } else if (
      response.status !== 304 ||
      response.url !== validators?.url ||
      !(validators.etag || validators.modified)
    ) {
      throw publisherError(response.status, response.headers, this.now());
    }
    const noStore =
      storageRestricted(response.headers) ||
      this.terms.get(new URL(response.url).origin) === "no-retention";
    return {
      url: response.url,
      aliases,
      parsed,
      noStore,
      useLimits:
        parsed?.useLimits ??
        restrictedUses(responseDirectives(response.headers)),
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
  inspectOutline(owner: string, entry: Outline) {
    return this.queue(
      JSON.stringify(["opml-check", owner, entry]),
      async () => {
        let canonical = entry.xmlUrl;
        let known = this.catalog.find(owner, canonical);
        let title = known?.title;
        if (!known?.active) {
          const edition = await this.edition(canonical);
          canonical = edition.aliases.at(-1)!;
          known = edition.aliases
            .map((url) => this.catalog.find(owner, url))
            .find(Boolean);
          title = edition.parsed!.title;
        }
        return {
          canonical: known?.url ?? canonical,
          title,
          active: !!known?.active,
          storedFolder:
            !!known?.active && this.catalog.hasOutline(known.id, entry.folders),
        };
      },
    );
  }
  subscribe(owner: string, input: string, outline?: Outline) {
    const url = subscriptionUrl(input);
    return this.queue(
      JSON.stringify(["add", owner, url, outline]),
      async () => {
        const prior = this.catalog.find(owner, url);
        if (prior) {
          const accepted = this.catalog.acceptKnown(
            owner,
            prior.id,
            this.now(),
            outline,
          );
          if (accepted.added)
            return { ...(await this.poll(owner, prior.id, true)), added: true };
          return {
            status: "subscribed",
            subscription: describeFeed(accepted),
            added: false,
          };
        }
        const edition = await this.edition(url);
        const accepted = this.catalog.subscribe(
          owner,
          edition,
          this.now(),
          this.jitter(),
          outline,
        );
        return {
          status: "subscribed",
          subscription: describeFeed(accepted),
          added: accepted.added,
        };
      },
    );
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
        !this.catalog.pageGone(id) &&
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
  async recoverOne() {
    const job = this.catalog.claimRecovery(this.now());
    if (!job) return false;
    const done = (status: string, detail: string, due = 0) =>
      this.catalog.finishRecovery(job.id, job.lease, status, detail, due);
    try {
      const legacy = this.catalog.legacyPolicyFeed(job.owner, job.id);
      if (legacy) {
        if (legacy.not_before > this.now()) {
          done(
            "queued",
            "Waiting for the publisher’s next permitted feed check.",
            legacy.not_before,
          );
          return true;
        }
        if (legacy.active) {
          const refresh = await this.refresh(job.owner, legacy.id);
          if (refresh.status === "failed")
            throw new Error(
              refresh.subscription.error ??
                "Feed policy could not be refreshed.",
            );
          if (this.catalog.legacyPolicyFeed(job.owner, job.id)) {
            done("retry", "Waiting for feed policy.", this.now() + 60000);
            return true;
          }
        } else {
          // Explicit history recovery can check an inactive feed once without resubscribing.
          const edition = await this.queue("history-policy:" + legacy.id, () =>
            this.edition(legacy.url),
          );
          this.catalog.recordInactiveFeedUse(legacy, edition, this.now());
        }
      }
      const base = this.catalog.prepareRecovery(job.owner, job.id, this.terms);
      if (!base.pageCandidate || base.withdrawn || base.subscriberOnly) {
        done(
          base.subscriberOnly
            ? "access"
            : base.withdrawn ||
                base.pagePolicy ||
                /no storage|permission/.test(base.reason)
              ? "restricted"
              : "unavailable",
          base.pagePolicy ?? base.reason,
        );
        return true;
      }
      const issue = await this.original(job.owner, job.id);
      if (issue) {
        done(
          job.attempts >= 3 ? "failed" : "retry",
          issue.message,
          Math.max(issue.retryAt ?? 0, this.now() + 60000 * 2 ** job.attempts),
        );
      } else {
        const a = this.catalog.article(job.owner, job.id);
        const status =
          a.subscriberOnly || a.outcome === "access"
            ? "access"
            : a.coverage === "complete" && a.permissions.display
              ? "recovered"
              : a.outcome === "restriction"
                ? "restricted"
                : a.outcome === "technical"
                  ? "failed"
                  : a.permissions.display
                    ? "partial"
                    : "unavailable";
        done(status, a.reason);
      }
    } catch (e) {
      done(
        job.attempts >= 3 ? "failed" : "retry",
        e instanceof Error ? e.message : "Recovery interrupted",
        this.now() + 60000 * 2 ** job.attempts,
      );
    }
    return true;
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = this.catalog.nextDue(this.now());
      if (due) await this.refresh(due.owner, due.id, false);
      else await this.recoverOne();
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
