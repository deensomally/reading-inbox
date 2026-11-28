import type { Outline } from "../shared/opml.ts";
import { originalText } from "../shared/original.ts";
import type { PageEdition } from "./original-page.ts";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { digest, FeedError, type ParsedFeed } from "./types.ts";
import { pageCandidate } from "./page-policy.ts";
import { reviewKey, type Proofs } from "./parser.ts";

export const INTERVAL = 30 * 60000;
export const LEASE = 60000;
const BODY_BUDGET = 64 * 1024 * 1024;
export interface Feed {
  id: string;
  owner: string;
  url: string;
  title: string;
  active: number;
  next_poll: number;
  not_before: number;
  last_attempt: number | null;
  last_success: number | null;
  gap_since: number | null;
  error: string | null;
  error_code: string | null;
  failures: number;
  paused: number;
  lease: string | null;
  lease_until: number;
  validator_url: string;
  etag: string | null;
  modified: string | null;
  freshness: number;
  ttl: number;
}
interface StoredArticle {
  id: string;
  first_seen: number;
  revision: string;
  metadata: string;
  body: string;
  body_bytes: number;
}
interface Change {
  seq: number;
  article_id: string;
  sort_at: number;
  kind: string;
  metadata: string;
}
export interface Edition {
  url: string;
  aliases: string[];
  parsed: ParsedFeed | null;
  useLimits?: ParsedFeed["useLimits"];
  etag: string | null;
  modified: string | null;
  freshness: number | null;
  noStore: boolean;
}
export const notFound = () =>
  new FeedError("not_found", "Unknown subscription or article.", 404);
function installationToken(key: Buffer, owner: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(owner))
    throw new Error(
      "Use a profile name of 1–64 letters, digits, dashes or underscores.",
    );
  return (
    owner +
    "." +
    createHmac("sha256", key)
      .update("installation\0")
      .update(owner)
      .digest("base64url")
  );
}
export function localCredential(path: string, owner: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return installationToken(
      Buffer.from(
        String(
          db
            .prepare("SELECT value FROM settings WHERE name='signing-key'")
            .get()!.value,
        ),
        "hex",
      ),
      owner,
    );
  } finally {
    db.close();
  }
}
export const describeFeed = (f: Feed) => ({
  id: f.id,
  url: f.url,
  title: f.title,
  active: !!f.active,
  paused: !!f.paused,
  lastAttempt: f.last_attempt,
  lastSuccess: f.last_success,
  nextPoll: f.active && !f.paused ? f.next_poll : null,
  retryAfter: f.not_before,
  possibleGapSince: f.gap_since,
  error: f.error,
  errorCode: f.error_code,
});

const schema = `
CREATE TABLE settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings VALUES ('signing-key', hex(randomblob(32)));
CREATE TABLE feeds (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 next_poll INTEGER NOT NULL DEFAULT 0, not_before INTEGER NOT NULL DEFAULT 0, last_attempt INTEGER, last_success INTEGER, gap_since INTEGER,
 error TEXT, error_code TEXT, failures INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0,
 lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, validator_url TEXT NOT NULL DEFAULT '', etag TEXT, modified TEXT,
 freshness INTEGER NOT NULL DEFAULT 0, ttl INTEGER NOT NULL DEFAULT 0);
CREATE INDEX due ON feeds(active,paused,next_poll,lease_until);
CREATE INDEX subscriptions ON feeds(owner,id);
CREATE TABLE feed_aliases (owner TEXT NOT NULL, url TEXT NOT NULL, feed_id TEXT NOT NULL REFERENCES feeds(id), PRIMARY KEY(owner,url));
CREATE TABLE articles (id TEXT PRIMARY KEY,feed_id TEXT NOT NULL REFERENCES feeds(id),first_seen INTEGER NOT NULL,
 revision TEXT NOT NULL, metadata TEXT NOT NULL, body TEXT NOT NULL, body_bytes INTEGER NOT NULL);
CREATE INDEX feed_articles ON articles(feed_id);
CREATE TABLE item_aliases (feed_id TEXT NOT NULL REFERENCES feeds(id),alias TEXT NOT NULL,article_id TEXT NOT NULL REFERENCES articles(id),PRIMARY KEY(feed_id,alias));
CREATE TABLE withdrawn_ids (feed_id TEXT NOT NULL REFERENCES feeds(id), source_id TEXT NOT NULL, PRIMARY KEY(feed_id,source_id));
CREATE TABLE changes (seq INTEGER PRIMARY KEY,feed_id TEXT NOT NULL REFERENCES feeds(id),article_id TEXT NOT NULL REFERENCES articles(id),
 sort_at INTEGER NOT NULL, kind TEXT NOT NULL,metadata TEXT NOT NULL);
CREATE INDEX deliveries ON changes(feed_id,seq);
CREATE INDEX revisions ON changes(article_id,seq);
PRAGMA user_version=1;`;

export class Catalog {
  readonly db: DatabaseSync;
  private statements = new Map<string, StatementSync>();
  private key: Buffer;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(
        "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL",
      );
      this.transaction(() => {
        const version = Number(
          this.db.prepare("PRAGMA user_version").get()?.user_version,
        );
        if (version === 0) this.db.exec(schema);
        else if (
          version !== 1 &&
          version !== 2 &&
          version !== 3 &&
          version !== 4 &&
          version !== 5
        )
          throw new Error("Unsupported Reading Box service database version.");
        if (version < 2)
          this.db.exec(`
          CREATE TABLE page_editions(article_id TEXT PRIMARY KEY REFERENCES articles(id), metadata TEXT NOT NULL, body TEXT, checked INTEGER NOT NULL);
          CREATE TRIGGER clear_page AFTER UPDATE ON articles BEGIN DELETE FROM page_editions WHERE article_id=NEW.id; END;
          UPDATE feeds SET etag=NULL,modified=NULL;
          PRAGMA user_version=2;`);
        if (version < 3)
          this.db.exec(`
          CREATE TABLE subscription_outlines (
            feed_id TEXT NOT NULL REFERENCES feeds(id), folders TEXT NOT NULL, title TEXT NOT NULL, html_url TEXT,
            PRIMARY KEY(feed_id,folders));
          PRAGMA user_version=3;`);
        if (version < 4) {
          this.db.exec(`
            CREATE TABLE IF NOT EXISTS portable_sources(feed_id TEXT PRIMARY KEY REFERENCES feeds(id), source_ref TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS article_alias_lookup ON item_aliases(article_id);
            PRAGMA user_version=4;`);
          for (const feed of this.db.prepare("SELECT id,url FROM feeds").all())
            this.run(
              "INSERT OR IGNORE INTO portable_sources VALUES(?,?)",
              feed.id,
              digest(String(feed.url)),
            );
        }
        if (version < 5)
          this.db.exec(`
          CREATE TABLE IF NOT EXISTS recovery(article_id TEXT PRIMARY KEY REFERENCES articles(id), owner TEXT NOT NULL, revision TEXT NOT NULL, status TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0, recent INTEGER NOT NULL, due INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, lease TEXT, manual INTEGER NOT NULL DEFAULT 0, detail TEXT);
          CREATE INDEX IF NOT EXISTS recovery_work ON recovery(status,priority DESC,recent DESC,due);
          CREATE INDEX IF NOT EXISTS recovery_owner ON recovery(owner,status);
          CREATE TABLE IF NOT EXISTS feed_use(feed_id TEXT PRIMARY KEY REFERENCES feeds(id),blocked INTEGER NOT NULL,page_policy TEXT);
          UPDATE feeds SET etag=NULL,modified=NULL,next_poll=min(next_poll,not_before);
          PRAGMA user_version=5;`);
      });
      this.key = Buffer.from(
        String(
          this.db
            .prepare("SELECT value FROM settings WHERE name='signing-key'")
            .get()!.value,
        ),
        "hex",
      );
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  private stmt(sql: string) {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }
  private one<T>(sql: string, ...args: SQLInputValue[]) {
    return this.stmt(sql).get(...args) as T | undefined;
  }
  private all<T>(sql: string, ...args: SQLInputValue[]) {
    return this.stmt(sql).all(...args) as T[];
  }
  private run(sql: string, ...args: SQLInputValue[]) {
    return this.stmt(sql).run(...args);
  }
  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
  private sign(domain: string, data: string) {
    return createHmac("sha256", this.key)
      .update(domain)
      .update("\0")
      .update(data)
      .digest("base64url");
  }
  private equal(a: string, b: string) {
    return (
      a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
    );
  }
  credential(owner: string) {
    return installationToken(this.key, owner);
  }
  browserLibrary(owner: string) {
    return this.sign("browser-library", owner);
  }
  authenticate(token: string) {
    const match = /^([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{43})$/.exec(token);
    return match && this.equal(token, this.credential(match[1]))
      ? match[1]
      : null;
  }
  subscriptions(owner: string) {
    return this.all<Feed>(
      "SELECT * FROM feeds WHERE owner=? ORDER BY title,id",
      owner,
    ).map(describeFeed);
  }
  get(owner: string, id: string) {
    const f = this.one<Feed>(
      "SELECT * FROM feeds WHERE owner=? AND id=?",
      owner,
      id,
    );
    if (!f) throw notFound();
    return f;
  }
  find(owner: string, url: string) {
    return this.one<Feed>(
      "SELECT f.* FROM feed_aliases a JOIN feeds f ON f.id=a.feed_id WHERE a.owner=? AND a.url=?",
      owner,
      url,
    );
  }
  unsubscribe(owner: string, id: string) {
    this.get(owner, id);
    this.run(
      "UPDATE feeds SET active=0,lease=NULL,lease_until=0,gap_since=coalesce(gap_since,last_success) WHERE owner=? AND id=?",
      owner,
      id,
    );
  }
  reactivate(owner: string, id: string, now: number) {
    const result = this.run(
      "UPDATE feeds SET active=1,paused=0,next_poll=max(?,not_before),etag=NULL,modified=NULL WHERE owner=? AND id=? AND active=0 AND (SELECT count(*) FROM feeds WHERE owner=? AND active=1)<256",
      now,
      owner,
      id,
      owner,
    );
    if (!result.changes && !this.get(owner, id).active)
      throw new FeedError(
        "subscription_limit",
        "This installation has reached its active feed limit.",
        409,
      );
    return this.get(owner, id);
  }
  private aliases(f: Feed, urls: string[]) {
    for (const url of urls) {
      const other = this.find(f.owner, url);
      if (other && other.id !== f.id)
        throw new FeedError(
          "alias_conflict",
          "This feed now points to another subscription. Its history was kept.",
        );
      this.run(
        "INSERT OR IGNORE INTO feed_aliases VALUES(?,?,?)",
        f.owner,
        url,
        f.id,
      );
    }
  }
  hasOutline(feedId: string, folders: string[]) {
    return !!this.one(
      "SELECT 1 FROM subscription_outlines WHERE feed_id=? AND folders=?",
      feedId,
      JSON.stringify(folders),
    );
  }
  private keepOutline(feedId: string, outline?: Outline) {
    if (outline)
      this.run(
        "INSERT OR IGNORE INTO subscription_outlines VALUES(?,?,?,?)",
        feedId,
        JSON.stringify(outline.folders),
        outline.title,
        outline.htmlUrl ?? null,
      );
  }
  exportOutlines(owner: string): Outline[] {
    return this.all<{
      xmlUrl: string;
      title: string;
      htmlUrl: string | null;
      folders: string | null;
    }>(
      `SELECT f.url AS xmlUrl,coalesce(nullif(o.title,''),f.title) AS title,o.html_url AS htmlUrl,o.folders
       FROM feeds f LEFT JOIN subscription_outlines o ON o.feed_id=f.id WHERE f.owner=? AND f.active=1 ORDER BY title,f.id,o.folders`,
      owner,
    ).map((row) => ({
      xmlUrl: row.xmlUrl,
      title: row.title,
      folders: JSON.parse(row.folders ?? "[]"),
      ...(row.htmlUrl && { htmlUrl: row.htmlUrl }),
    }));
  }
  acceptKnown(owner: string, id: string, now: number, outline?: Outline) {
    return this.transaction(() => {
      const prior = this.get(owner, id);
      const feed = prior.active ? prior : this.reactivate(owner, id, now);
      this.keepOutline(id, outline);
      return { ...feed, added: !prior.active };
    });
  }
  subscribe(
    owner: string,
    edition: Edition,
    now: number,
    jitter: number,
    outline?: Outline,
  ) {
    return this.transaction(() => {
      const known = edition.aliases
        .map((url) => this.find(owner, url))
        .find(Boolean);
      if (known) {
        this.aliases(known, edition.aliases);
        this.keepOutline(known.id, outline);
        if (known.active) return { ...known, added: false };
        this.reactivate(owner, known.id, now);
        this.apply(known, edition, now, jitter);
        return { ...this.get(owner, known.id), added: true };
      }
      if (
        this.one<{ n: number }>(
          "SELECT count(*) n FROM feeds WHERE owner=? AND active=1",
          owner,
        )!.n >= 256
      )
        throw new FeedError(
          "subscription_limit",
          "This installation has reached its active feed limit.",
          409,
        );
      const id = randomUUID();
      this.run(
        "INSERT INTO feeds(id,owner,url,title,last_attempt) VALUES(?,?,?,?,?)",
        id,
        owner,
        edition.aliases.at(-1)!,
        edition.parsed!.title,
        now,
      );
      this.run(
        "INSERT INTO portable_sources VALUES(?,?)",
        id,
        digest(edition.aliases.at(-1)!),
      );
      const f = this.get(owner, id);
      this.apply(f, edition, now, jitter);
      this.keepOutline(id, outline);
      return { ...this.get(owner, id), added: true };
    });
  }
  nextDue(now: number) {
    return this.one<Feed>(
      "SELECT * FROM feeds WHERE active=1 AND paused=0 AND next_poll<=? AND lease_until<=? ORDER BY next_poll,id LIMIT 1",
      now,
      now,
    );
  }
  claim(owner: string, id: string, now: number, manual: boolean) {
    return this.transaction(() => {
      const f = this.get(owner, id);
      if (!f.active)
        throw new FeedError(
          "inactive",
          "Re-subscribe to refresh this feed.",
          409,
        );
      if (
        f.lease_until > now ||
        f.not_before > now ||
        (!manual && (f.paused || f.next_poll > now))
      )
        return null;
      const lease = randomUUID();
      this.run(
        "UPDATE feeds SET lease=?,lease_until=?,last_attempt=? WHERE id=?",
        lease,
        now + LEASE,
        now,
        id,
      );
      return { ...f, lease };
    });
  }
  commit(f: Feed, edition: Edition, now: number, jitter: number) {
    return this.transaction(() => {
      const current = this.get(f.owner, f.id);
      if (!current.active || current.lease !== f.lease) return false;
      this.apply(current, edition, now, jitter);
      return true;
    });
  }
  fail(f: Feed, err: FeedError, now: number) {
    const failures =
      err.code === "http_404" && f.error_code !== err.code ? 1 : f.failures + 1;
    const pause =
      [
        "http_410",
        "http_401",
        "http_403",
        "robots_denied",
        "alias_conflict",
        "public_url_required",
      ].includes(err.code) ||
      (err.code === "http_404" && failures >= 3);
    const retry = Math.max(
      now + Math.min(24 * 3600000, 60000 * 2 ** Math.min(failures - 1, 12)),
      err.retryAt ?? 0,
    );
    this.run(
      "UPDATE feeds SET error=?,error_code=?,failures=?,paused=?,gap_since=coalesce(last_success,gap_since),next_poll=?,not_before=?,lease=NULL,lease_until=0 WHERE id=? AND active=1 AND lease=?",
      err.message,
      err.code,
      failures,
      Number(pause),
      retry,
      retry,
      f.id,
      f.lease,
    );
  }
  private apply(f: Feed, edition: Edition, now: number, jitter: number) {
    this.aliases(f, edition.aliases);
    this.recordFeedUse(f.id, edition);
    if (edition.noStore) {
      for (const row of this.all<StoredArticle>(
        "SELECT * FROM articles WHERE feed_id=? AND (body_bytes>0 OR json_extract(metadata,'$.pageCandidate') IS NOT NULL)",
        f.id,
      )) {
        this.restrictContent(row, f.id, "no_store");
      }
    }
    if (edition.parsed) {
      if (edition.parsed.pagePolicy) {
        for (const row of this.all<StoredArticle>(
          "SELECT * FROM articles WHERE feed_id=? AND json_extract(metadata,'$.pageCandidate') IS NOT NULL",
          f.id,
        )) {
          const m = JSON.parse(row.metadata);
          delete m.pageCandidate;
          m.pagePolicy = edition.parsed.pagePolicy;
          m.revision = digest(row.revision + m.pagePolicy);
          const json = JSON.stringify(m);
          this.run(
            "UPDATE articles SET metadata=?,revision=? WHERE id=?",
            json,
            m.revision,
            row.id,
          );
          this.run(
            "INSERT INTO changes(feed_id,article_id,sort_at,kind,metadata) VALUES(?,?,?,'upsert',?)",
            f.id,
            row.id,
            Date.parse(m.published ?? m.received),
            json,
          );
          this.run(
            "UPDATE recovery SET status='restricted',lease=NULL,detail=? WHERE article_id=?",
            m.pagePolicy,
            row.id,
          );
        }
      }
      if (edition.parsed.pageRestriction) {
        for (const row of this.all<StoredArticle>(
          "SELECT * FROM articles WHERE feed_id=? AND (body_bytes>0 OR json_extract(metadata,'$.pageCandidate') IS NOT NULL)",
          f.id,
        ))
          this.restrictContent(row, f.id, "license");
      }
      // Feed-level rights also apply to articles that have rolled out of its window.
      const affected = this.all<StoredArticle>(
        "SELECT * FROM articles WHERE feed_id=? AND (body_bytes>0 OR json_extract(metadata,'$.pageCandidate') IS NOT NULL) AND json_extract(metadata,'$.permissionSource')='feed' AND json_extract(metadata,'$.license') IS NOT ?",
        f.id,
        edition.parsed.license,
      );
      for (const row of affected) this.restrictContent(row, f.id, "license");
      this.ingest(f, edition.parsed, now);
    }
    const ttl = edition.parsed?.ttl ?? f.ttl;
    const freshness = edition.freshness ?? (edition.parsed ? 0 : f.freshness);
    const wait = Math.max(ttl, freshness);
    this.run(
      `UPDATE feeds SET url=?,title=?,validator_url=?,etag=?,modified=?,ttl=?,freshness=?,
      gap_since=CASE WHEN last_success IS NOT NULL AND ?>next_poll+? THEN last_success ELSE gap_since END,
      last_success=?,failures=0,paused=0,error=NULL,error_code=NULL,lease=NULL,lease_until=0,next_poll=?,not_before=? WHERE id=?`,
      edition.aliases.at(-1)!,
      edition.parsed?.title ?? f.title,
      edition.url,
      edition.etag,
      edition.modified,
      ttl,
      freshness,
      now,
      INTERVAL,
      now,
      now + Math.max(wait, INTERVAL + jitter),
      now + Math.max(30000, wait),
      f.id,
    );
  }
  // A feed-wide use restriction also covers editions outside its current window.
  // Keep their permitted reading bodies and deliver the narrowed grants atomically.
  private restrictUses(
    feed: string,
    limits: NonNullable<ParsedFeed["useLimits"]>,
  ) {
    const rows = this.all<StoredArticle>(
      `SELECT * FROM articles WHERE feed_id=? AND
       ((? AND coalesce(json_extract(metadata,'$.useLimits.copy'),0)=0) OR
        (? AND coalesce(json_extract(metadata,'$.useLimits.externalAI'),0)=0))`,
      feed,
      Number(limits.copy),
      Number(limits.externalAI),
    );
    const narrow = (json: string) => {
      const m = JSON.parse(json);
      m.useLimits = {
        copy: !!m.useLimits?.copy || limits.copy,
        externalAI: !!m.useLimits?.externalAI || limits.externalAI,
      };
      if (m.useLimits.copy) {
        m.permissions.copy = false;
        m.permissions.export = false;
      }
      if (m.useLimits.externalAI) m.permissions.externalAI = false;
      m.revision = digest(JSON.stringify([m.revision, m.useLimits]));
      return m;
    };
    for (const row of rows) {
      const page = this.one<{
        metadata: string;
        body: string | null;
        checked: number;
      }>(
        "SELECT metadata,body,checked FROM page_editions WHERE article_id=?",
        row.id,
      );
      const base = narrow(row.metadata);
      let json = JSON.stringify(base);
      this.run(
        "UPDATE articles SET metadata=?,revision=? WHERE id=?",
        json,
        base.revision,
        row.id,
      );
      if (page) {
        json = JSON.stringify(narrow(page.metadata));
        this.run(
          "INSERT INTO page_editions VALUES(?,?,?,?)",
          row.id,
          json,
          page.body,
          page.checked,
        );
      }
      this.run(
        "UPDATE recovery SET revision=? WHERE article_id=?",
        base.revision,
        row.id,
      );
      this.run(
        "INSERT INTO changes(feed_id,article_id,sort_at,kind,metadata) VALUES(?,?,?,'upsert',?)",
        feed,
        row.id,
        Date.parse(base.published ?? base.received),
        json,
      );
    }
  }
  private restrictContent(
    row: StoredArticle,
    feedId: string,
    cause: "no_store" | "license" | "review",
  ) {
    const m = JSON.parse(row.metadata);
    const removeText = cause !== "review";
    if (removeText) {
      delete m.provenance;
      delete m.useLimits;
    }
    m.coverage = m.coverage === "complete" ? "unverified" : m.coverage;
    m.reason = {
      no_store: "The publisher requested no storage.",
      license: "The feed’s permission for retaining this text has changed.",
      review: "The original is no longer verified.",
    }[cause];
    if (cause === "review") delete m.provenance;
    if (cause === "license") {
      m.license = null;
      m.permissionSource = null;
    }
    if (removeText) {
      delete m.pageCandidate;
      this.run(
        "UPDATE recovery SET status='restricted',lease=NULL,detail=? WHERE article_id=?",
        m.reason,
        row.id,
      );
    }
    if (removeText)
      m.permissions = {
        display: false,
        copy: false,
        retain: false,
        export: false,
        summarise: false,
      };
    m.revision = digest(row.revision + m.reason);
    const json = JSON.stringify(m);
    this.run(
      "UPDATE articles SET revision=?,metadata=?,body=?,body_bytes=? WHERE id=?",
      m.revision,
      json,
      removeText ? "[]" : row.body,
      removeText ? 0 : row.body_bytes,
      row.id,
    );
    this.run(
      "INSERT INTO changes(feed_id,article_id,sort_at,kind,metadata) VALUES(?,?,?,?,?)",
      feedId,
      row.id,
      m.published ? Date.parse(m.published) : row.first_seen,
      "upsert",
      json,
    );
  }
  reconcileProofs(proofs: Proofs) {
    this.transaction(() => {
      const full = this.all<
        StoredArticle & { feed_id: string; validator_url: string }
      >(
        "SELECT a.*,f.validator_url FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE json_extract(a.metadata,'$.coverage')='complete' AND (json_extract(a.metadata,'$.provenance') IS NULL OR json_extract(a.metadata,'$.provenance')='verified-feed')",
      );
      for (const row of full) {
        const { url } = JSON.parse(row.metadata);
        if (
          proofs.get(reviewKey(row.validator_url, url)) !==
          digest(
            (Array.isArray(JSON.parse(row.body))
              ? JSON.parse(row.body)
              : JSON.parse(row.body).paragraphs
            ).join("\n\n"),
          )
        )
          this.restrictContent(row, row.feed_id, "review");
      }
    });
  }
  private itemId(feed: string, alias: string) {
    return this.one<{ article_id: string }>(
      "SELECT article_id FROM item_aliases WHERE feed_id=? AND alias=?",
      feed,
      alias,
    )?.article_id;
  }
  private ingest(f: Feed, parsed: ParsedFeed, now: number) {
    const counts = new Map<string, Set<string>>();
    for (const e of parsed.entries)
      if (e.url) {
        const keys = counts.get(e.url) ?? new Set<string>();
        keys.add(e.sourceId ?? e.fingerprint);
        counts.set(e.url, keys);
      }
    let used = this.one<{ n: number }>(
      "SELECT coalesce(sum(a.body_bytes),0) n FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE f.owner=?",
      f.owner,
    )!.n;
    for (const e of parsed.entries) {
      if (
        e.sourceId &&
        this.one(
          "SELECT 1 FROM withdrawn_ids WHERE feed_id=? AND source_id=?",
          f.id,
          e.sourceId,
        )
      )
        continue;
      const aliases = [];
      if (e.sourceId) aliases.push("id:" + e.sourceId);
      if (e.url && counts.get(e.url)!.size === 1) aliases.push("url:" + e.url);
      if (!aliases.length) aliases.push("hash:" + e.fingerprint);
      const id =
        aliases.map((a) => this.itemId(f.id, a)).find(Boolean) ?? randomUUID();
      const prior = this.one<StoredArticle>(
        "SELECT * FROM articles WHERE id=?",
        id,
      );
      const previous = prior ? JSON.parse(prior.metadata) : undefined;
      if (previous?.withdrawn) continue;
      const received = prior?.first_seen ?? now;
      const published = e.published ?? previous?.published ?? null;
      const { paragraphs, document, ...content } = e.content;
      const body = JSON.stringify(
        document ? { paragraphs, document } : paragraphs,
      );
      const bytes = paragraphs.length ? Buffer.byteLength(body) : 0;
      const fits = used - (prior?.body_bytes ?? 0) + bytes <= BODY_BUDGET;
      if (!fits) {
        if (content.coverage === "complete") content.coverage = "unverified";
        content.reason = "The installation’s text cache is full.";
        content.permissions = {
          display: false,
          copy: false,
          export: false,
          retain: false,
          summarise: false,
        };
      }
      const metadata = {
        id,
        feedId: f.id,
        sourceId: e.sourceId ?? previous?.sourceId ?? null,
        publication: parsed.title,
        title: e.title,
        author: e.author,
        published,
        updated: e.updated ?? previous?.updated ?? null,
        received: new Date(received).toISOString(),
        url: e.url,
        discussion: e.discussion,
        topics: e.topics,
        permissionSource: e.permissionSource,
        policyVersion: 2,
        ...content,
        withdrawn: false,
      };
      const revision = digest(
        JSON.stringify([metadata, e.fingerprint, fits ? digest(body) : null]),
      );
      if (prior?.revision !== revision) {
        const json = JSON.stringify({ ...metadata, revision });
        this.run(
          `INSERT INTO articles VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,metadata=excluded.metadata,body=excluded.body,body_bytes=excluded.body_bytes`,
          id,
          f.id,
          received,
          revision,
          json,
          fits ? body : "[]",
          fits ? bytes : 0,
        );
        this.run(
          "INSERT INTO changes(feed_id,article_id,sort_at,kind,metadata) VALUES(?,?,?,?,?)",
          f.id,
          id,
          published ? Date.parse(published) : received,
          "upsert",
          json,
        );
        this.trackArticle(
          f.owner,
          id,
          revision,
          metadata,
          Date.parse(published ?? metadata.received),
          now,
        );
        used += (fits ? bytes : 0) - (prior?.body_bytes ?? 0);
      }
      for (const a of aliases)
        this.run(
          "INSERT OR IGNORE INTO item_aliases VALUES(?,?,?)",
          f.id,
          a,
          id,
        );
    }
    for (const ref of parsed.withdrawals) {
      this.run("INSERT OR IGNORE INTO withdrawn_ids VALUES(?,?)", f.id, ref);
      const id = this.itemId(f.id, "id:" + ref);
      if (!id) continue;
      const article = this.one<StoredArticle>(
        "SELECT * FROM articles WHERE id=?",
        id,
      )!;
      const m = JSON.parse(article.metadata);
      if (m.withdrawn) continue;
      delete m.pageCandidate;
      m.withdrawn = true;
      this.run(
        "UPDATE recovery SET status='restricted',lease=NULL,detail='Withdrawn' WHERE article_id=?",
        id,
      );
      m.coverage = "missing";
      m.reason = "The publisher withdrew this entry.";
      m.permissions = {
        display: false,
        retain: false,
        copy: false,
        export: false,
        summarise: false,
      };
      m.revision = digest(article.revision + ":withdrawn");
      const json = JSON.stringify(m);
      this.run(
        "UPDATE articles SET revision=?,metadata=?,body='[]',body_bytes=0 WHERE id=?",
        m.revision,
        json,
        id,
      );
      this.run(
        "INSERT INTO changes(feed_id,article_id,sort_at,kind,metadata) VALUES(?,?,?,?,?)",
        f.id,
        id,
        m.published ? Date.parse(m.published) : article.first_seen,
        "withdrawal",
        json,
      );
    }
  }
  article(owner: string, id: string) {
    const row = this.one<
      StoredArticle & { source_ref: string; first_alias: string }
    >(
      `SELECT a.*, p.source_ref,
       (SELECT alias FROM item_aliases WHERE feed_id=a.feed_id AND article_id=a.id ORDER BY rowid LIMIT 1) AS first_alias
       FROM articles a JOIN feeds f ON f.id=a.feed_id JOIN portable_sources p ON p.feed_id=f.id WHERE f.owner=? AND a.id=?`,
      owner,
      id,
    );
    if (!row) throw notFound();
    const feed = JSON.parse(row.metadata);
    // The first observed alias survives subsequent publisher edits. Hash the
    // feed and alias together so neither private query values nor GUIDs travel.
    const sourceRef = row.source_ref;
    const portableId = digest(
      JSON.stringify([sourceRef, row.first_alias ?? id]),
    );
    const data = JSON.parse(row.body);
    const page = this.one<{ metadata: string; body: string | null }>(
      "SELECT metadata,body FROM page_editions WHERE article_id=?",
      id,
    );
    return {
      ...feed,
      sourceRef,
      portableId,
      ...(Array.isArray(data) ? { paragraphs: data } : data),
      ...(page && JSON.parse(page.metadata)),
      ...(page?.body && JSON.parse(page.body)),
    };
  }
  pageGone(id: string) {
    // A changed feed edition invalidates this page row in the same transaction.
    return !!this.one(
      "SELECT 1 FROM page_editions WHERE article_id=? AND json_extract(metadata,'$.outcome')='unavailable'",
      id,
    );
  }
  pageInput(owner: string, id: string) {
    const row = this.one<{ metadata: string; checked: number | null }>(
      "SELECT a.metadata,p.checked FROM articles a JOIN feeds f ON f.id=a.feed_id LEFT JOIN page_editions p ON p.article_id=a.id WHERE f.owner=? AND a.id=?",
      owner,
      id,
    );
    if (!row) throw notFound();
    return { ...JSON.parse(row.metadata), checked: row.checked };
  }
  private trackArticle(
    owner: string,
    id: string,
    revision: string,
    article: {
      coverage: string;
      permissions: { display: boolean };
      pageCandidate?: unknown;
      subscriberOnly?: boolean;
      pagePolicy?: string;
      reason: string;
    },
    recent: number,
    now: number,
  ) {
    const status = article.subscriberOnly
      ? "access"
      : article.coverage === "complete" && article.permissions.display
        ? "complete"
        : article.pageCandidate
          ? "queued"
          : article.pagePolicy || /no storage/.test(article.reason)
            ? "restricted"
            : article.permissions.display
              ? "partial"
              : "unavailable";
    this.run(
      `INSERT INTO recovery(article_id,owner,revision,status,recent,due,detail) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(article_id) DO UPDATE SET revision=excluded.revision,status=excluded.status,recent=excluded.recent,due=excluded.due,attempts=0,lease=NULL,detail=excluded.detail`,
      id,
      owner,
      revision,
      status,
      recent,
      now + 15000,
      article.pagePolicy ?? article.reason,
    );
  }
  applyPublisherTerms(terms: ReadonlyMap<string, string>) {
    const edition = JSON.stringify([...terms].sort());
    if (
      (this.one<{ value: string }>(
        "SELECT value FROM settings WHERE name='publisher-terms'",
      )?.value ?? "[]") === edition
    )
      return;
    this.transaction(() => {
      const rows = this.all<
        StoredArticle & { feed_id: string; feed_url: string }
      >(
        "SELECT a.*, f.validator_url feed_url FROM articles a JOIN feeds f ON f.id=a.feed_id",
      );
      for (const row of rows) {
        const m = JSON.parse(row.metadata);
        const modes = [
          terms.get(new URL(row.feed_url).origin),
          m.url && terms.get(new URL(m.url).origin),
        ];
        if (m.withdrawn || !modes.some(Boolean)) continue;
        if (modes.includes("no-retention"))
          this.restrictContent(row, row.feed_id, "no_store");
        else if (m.pageCandidate) {
          delete m.pageCandidate;
          m.pagePolicy =
            "The recorded publisher terms prohibit page retrieval.";
          m.revision = digest(row.revision + m.pagePolicy);
          const json = JSON.stringify(m);
          this.run(
            "UPDATE articles SET metadata=?,revision=? WHERE id=?",
            json,
            m.revision,
            row.id,
          );
          this.run(
            "INSERT INTO changes(feed_id,article_id,sort_at,kind,metadata) VALUES(?,?,?,'upsert',?)",
            row.feed_id,
            row.id,
            Date.parse(m.published ?? m.received),
            json,
          );
          this.run(
            "UPDATE recovery SET status='restricted',lease=NULL,detail=? WHERE article_id=?",
            m.pagePolicy,
            row.id,
          );
        }
      }
      this.run(
        "UPDATE feeds SET etag=NULL,modified=NULL,next_poll=min(next_poll,not_before)",
      );
      this.run(
        "INSERT OR REPLACE INTO settings VALUES('publisher-terms',?)",
        edition,
      );
    });
  }
  requestRecovery(owner: string, saved: string[], start = true) {
    this.transaction(() => {
      // Historical bodies and marks stay in place. Reassess old rows lazily.
      if (start)
        this.run(
          `INSERT OR IGNORE INTO recovery(article_id,owner,revision,status,recent,manual)
        SELECT a.id,f.owner,a.revision,CASE WHEN json_extract(a.metadata,'$.withdrawn') THEN 'restricted'
        WHEN json_extract(a.metadata,'$.subscriberOnly') THEN 'access'
        WHEN json_extract(coalesce(p.metadata,a.metadata),'$.coverage')='complete' THEN 'complete'
        ELSE 'queued' END,coalesce(unixepoch(json_extract(a.metadata,'$.published'))*1000,a.first_seen),1
        FROM articles a JOIN feeds f ON f.id=a.feed_id LEFT JOIN page_editions p ON p.article_id=a.id WHERE f.owner=?`,
          owner,
        );
      if (start) {
        this.run(
          "UPDATE recovery SET manual=1,due=0 WHERE owner=? AND status='queued'",
          owner,
        );
        this.run(
          "UPDATE recovery SET priority=0 WHERE owner=? AND priority!=0",
          owner,
        );
      }
      for (const id of saved)
        this.run(
          "UPDATE recovery SET priority=1 WHERE owner=? AND article_id=?",
          owner,
          id,
        );
    });
    return this.recoveryStatus(owner);
  }
  recoveryStatus(owner: string) {
    const counts: Record<string, number> = {};
    for (const r of this.all<{ status: string; n: number }>(
      "SELECT status,count(*) n FROM recovery WHERE owner=? GROUP BY status",
      owner,
    ))
      counts[r.status] = r.n;
    const latest = this.all<{ title: string; detail: string; status: string }>(
      `SELECT json_extract(a.metadata,'$.title') title,r.detail,r.status FROM recovery r JOIN articles a ON a.id=r.article_id WHERE r.owner=? AND r.status IN ('retry','failed','access','restricted','unavailable','partial') ORDER BY r.recent DESC LIMIT 8`,
      owner,
    );
    return { counts, latest };
  }
  claimRecovery(now: number) {
    return this.transaction(() => {
      const job = this.one<{
        id: string;
        owner: string;
        revision: string;
        attempts: number;
      }>(
        `SELECT r.article_id id,r.owner,r.revision,r.attempts FROM recovery r JOIN articles a ON a.id=r.article_id JOIN feeds f ON f.id=a.feed_id
        WHERE r.status IN ('queued','retry','working') AND r.due<=? AND (r.manual=1 OR f.active=1)
        ORDER BY r.priority DESC,r.recent DESC,r.article_id LIMIT 1`,
        now,
      );
      if (!job) return;
      const lease = randomUUID();
      this.run(
        "UPDATE recovery SET status='working',lease=?,due=?,attempts=attempts+1 WHERE article_id=?",
        lease,
        now + LEASE,
        job.id,
      );
      return { ...job, lease };
    });
  }
  legacyPolicyFeed(owner: string, id: string) {
    const row = this.one<{ id: string }>(
      `SELECT f.id FROM articles a JOIN feeds f ON f.id=a.feed_id LEFT JOIN feed_use u ON u.feed_id=f.id WHERE a.id=? AND f.owner=? AND u.feed_id IS NULL AND coalesce(json_extract(a.metadata,'$.policyVersion'),1)<2`,
      id,
      owner,
    );
    return row && this.get(owner, row.id);
  }
  recordInactiveFeedUse(feed: string, edition: Edition) {
    this.transaction(() => this.recordFeedUse(feed, edition));
  }
  private recordFeedUse(feed: string, edition: Edition) {
    if (edition.useLimits) this.restrictUses(feed, edition.useLimits);
    if (edition.parsed || edition.noStore)
      this.run(
        "INSERT OR REPLACE INTO feed_use VALUES(?,?,?)",
        feed,
        Number(edition.noStore || !!edition.parsed?.pageRestriction),
        edition.parsed?.pagePolicy ?? null,
      );
  }
  prepareRecovery(
    owner: string,
    id: string,
    terms: ReadonlyMap<string, string>,
  ) {
    const base = this.pageInput(owner, id);
    if (
      base.pageCandidate ||
      base.policyVersion === 2 ||
      base.withdrawn ||
      base.subscriberOnly
    )
      return base;
    const feed = this.get(owner, base.feedId);
    const use = this.one<{ blocked: number; page_policy: string | null }>(
      "SELECT * FROM feed_use WHERE feed_id=?",
      feed.id,
    );
    // A legacy entry can reference an independently published public page. Never
    // revive an explicit prohibition or a previously withdrawn syndication grant.
    if (
      base.pagePolicy ||
      terms.has(new URL(feed.validator_url).origin) ||
      (base.url && terms.has(new URL(base.url).origin)) ||
      use?.blocked ||
      use?.page_policy ||
      /no storage|permission.*changed/.test(base.reason)
    )
      return base;
    const candidate = pageCandidate(feed.validator_url, base.url, base.license);
    if (!candidate) return base;
    // Store the candidate in the journal without modifying a cached page edition.
    // A legacy article with a retained page already has its original candidate.
    const { checked: _checked, ...metadata } = base;
    void _checked;
    metadata.pageCandidate = candidate;
    const json = JSON.stringify(metadata);
    this.transaction(() => {
      this.run(
        "UPDATE articles SET metadata=? WHERE id=? AND revision=?",
        json,
        id,
        base.revision,
      );
      this.run(
        "INSERT INTO changes(feed_id,article_id,sort_at,kind,metadata) VALUES(?,?,?,'upsert',?)",
        feed.id,
        id,
        Date.parse(base.published ?? base.received),
        json,
      );
    });
    return this.pageInput(owner, id);
  }
  finishRecovery(
    id: string,
    lease: string,
    status: string,
    detail: string,
    due: number,
  ) {
    this.run(
      "UPDATE recovery SET status=?,detail=?,due=?,lease=NULL WHERE article_id=? AND lease=?",
      status,
      detail,
      due,
      id,
      lease,
    );
  }
  recordPage(
    owner: string,
    id: string,
    revision: string,
    result: PageEdition,
    now: number,
    resourcesChecked = true,
  ) {
    return this.transaction(() => {
      const base = this.pageInput(owner, id);
      if (base.revision !== revision || !base.pageCandidate || base.withdrawn)
        return;
      let { document, ...patch } = result;
      let body = document
        ? JSON.stringify({
            document,
            paragraphs: originalText(document.nodes).split(/\n\n/),
          })
        : null;
      const used = this.one<{ bytes: number }>(
        "SELECT coalesce(sum(length(CAST(p.body AS BLOB))),0) AS bytes FROM page_editions p JOIN articles a ON a.id=p.article_id JOIN feeds f ON f.id=a.feed_id WHERE f.owner=? AND a.id!=?",
        owner,
        id,
      )!.bytes;
      if (body && used + Buffer.byteLength(body) > 16 * 1024 * 1024) {
        body = null;
        document = undefined;
        patch = {
          reason:
            "The publisher-page cache is full. Open the original at the publisher.",
        };
      }
      const suppressBody =
        (patch.subscriberOnly ||
          patch.outcome === "access" ||
          patch.outcome === "restriction") &&
        base.coverage !== "excerpt";
      if (suppressBody)
        body = JSON.stringify({ document: null, paragraphs: [] });
      const { checked: previousCheck, ...baseline } = base;
      // With a transient figure failure, publish any actual changes but keep
      // the previous check time. Zero makes a first partial check retryable.
      const checked = resourcesChecked ? now : (previousCheck ?? 0);
      const meta = {
        ...baseline,
        ...patch,
        ...(document && {
          pageUrl: base.pageCandidate.url,
          pageCheckedAt: now,
        }),
        coverage:
          patch.coverage ??
          (patch.subscriberOnly
            ? "excerpt"
            : baseline.coverage === "complete"
              ? "unverified"
              : baseline.coverage),
        ...(suppressBody && {
          permissions: {
            ...base.permissions,
            display: false,
            retain: false,
            copy: false,
            export: false,
            externalAI: false,
          },
        }),
        ...(document && {
          permissions: {
            ...patch.permissions,
          },
        }),
      };
      meta.revision = digest(
        JSON.stringify([base.revision, patch, body && digest(body)]),
      );
      const old = this.one<{ metadata: string }>(
        "SELECT metadata FROM page_editions WHERE article_id=?",
        id,
      );
      if (old && JSON.parse(old.metadata).revision === meta.revision) {
        if (checked === previousCheck) return;
        this.run(
          "UPDATE page_editions SET checked=? WHERE article_id=?",
          checked,
          id,
        );
        return;
      }
      const metadata = JSON.stringify(meta);
      this.run(
        "INSERT OR REPLACE INTO page_editions VALUES(?,?,?,?)",
        id,
        metadata,
        body,
        checked,
      );
      this.run(
        "INSERT INTO changes(feed_id,article_id,sort_at,kind,metadata) VALUES(?,?,?,'upsert',?)",
        base.feedId,
        id,
        Date.parse(base.published ?? base.received),
        metadata,
      );
    });
  }
  private cursor(owner: string, kind: string, values: unknown[]) {
    const text = Buffer.from(JSON.stringify(values)).toString("base64url");
    return text + "." + this.sign(kind + ":" + owner, text);
  }
  private decode(owner: string, kind: string, cursor?: string) {
    if (!cursor) return null;
    const match = /^([A-Za-z0-9_-]{1,1000})\.([A-Za-z0-9_-]{43})$/.exec(cursor);
    if (
      !match ||
      !this.equal(match[2], this.sign(kind + ":" + owner, match[1]))
    )
      throw new FeedError(
        "invalid_cursor",
        "Invalid cursor for this installation or collection.",
        400,
      );
    return JSON.parse(Buffer.from(match[1], "base64url").toString()) as (
      number | string | null
    )[];
  }
  private high(owner: string) {
    return this.one<{ n: number }>(
      "SELECT coalesce(max(seq),0) n FROM changes c JOIN feeds f ON f.id=c.feed_id WHERE f.owner=?",
      owner,
    )!.n;
  }
  articles(owner: string, limit: number, cursor?: string) {
    const [high, sort, id] = this.decode(owner, "articles", cursor) ?? [
      this.high(owner),
      null,
      "",
    ];
    const rows = this.all<Change>(
      `WITH latest AS (SELECT c.article_id,max(seq) s FROM changes c JOIN feeds f ON f.id=c.feed_id
      WHERE f.owner=? AND seq<=? GROUP BY c.article_id)
      SELECT c.* FROM latest JOIN changes c ON c.seq=latest.s WHERE (? IS NULL OR sort_at<? OR (sort_at=? AND c.article_id>?))
      ORDER BY sort_at DESC,c.article_id LIMIT ?`,
      owner,
      high,
      sort,
      sort,
      sort,
      id,
      limit + 1,
    );
    const page = rows.slice(0, limit),
      last = page.at(-1);
    return {
      items: page.map((r) => JSON.parse(r.metadata)),
      nextCursor:
        rows.length > limit && last
          ? this.cursor(owner, "articles", [
              high,
              last.sort_at,
              last.article_id,
            ])
          : null,
      changesCursor: this.cursor(owner, "changes", [high, null]),
    };
  }
  changes(owner: string, limit: number, cursor?: string) {
    const [after, until] = this.decode(owner, "changes", cursor) ?? [0, null];
    const high = until ?? this.high(owner);
    const rows = this.all<Change>(
      "SELECT c.* FROM changes c JOIN feeds f ON f.id=c.feed_id WHERE f.owner=? AND c.seq>? AND c.seq<=? ORDER BY seq LIMIT ?",
      owner,
      after,
      high,
      limit + 1,
    );
    const page = rows.slice(0, limit),
      more = rows.length > limit;
    return {
      items: page.map((r) => ({
        type: r.kind,
        article: JSON.parse(r.metadata),
      })),
      hasMore: more,
      nextCursor: this.cursor(
        owner,
        "changes",
        more ? [page.at(-1)!.seq, high] : [high, null],
      ),
    };
  }
}
