import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { digest, FeedError, type ParsedFeed } from "./types.ts";
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
        else if (version !== 1)
          throw new Error("Unsupported Reading Box service database version.");
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
  subscribe(owner: string, edition: Edition, now: number, jitter: number) {
    return this.transaction(() => {
      const known = edition.aliases
        .map((url) => this.find(owner, url))
        .find(Boolean);
      if (known) {
        this.aliases(known, edition.aliases);
        if (known.active) return known;
        this.reactivate(owner, known.id, now);
        this.apply(known, edition, now, jitter);
        return this.get(owner, known.id);
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
      const f = this.get(owner, id);
      this.apply(f, edition, now, jitter);
      return this.get(owner, id);
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
    if (edition.noStore) {
      for (const row of this.all<StoredArticle>(
        "SELECT * FROM articles WHERE feed_id=? AND body_bytes>0",
        f.id,
      )) {
        this.restrictContent(row, f.id, "no_store");
      }
    }
    if (edition.parsed) {
      // Feed-level rights also apply to articles that have rolled out of its window.
      const affected = this.all<StoredArticle>(
        "SELECT * FROM articles WHERE feed_id=? AND body_bytes>0 AND json_extract(metadata,'$.permissionSource')='feed' AND json_extract(metadata,'$.license') IS NOT ?",
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
  private restrictContent(
    row: StoredArticle,
    feedId: string,
    cause: "no_store" | "license" | "review",
  ) {
    const m = JSON.parse(row.metadata);
    const removeText = cause !== "review";
    m.coverage = m.coverage === "complete" ? "unverified" : m.coverage;
    m.reason = {
      no_store: "The publisher requested no storage.",
      license: "The feed’s permission for retaining this text has changed.",
      review: "The original is no longer verified.",
    }[cause];
    if (cause === "license") {
      m.license = null;
      m.permissionSource = null;
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
        "SELECT a.*,f.validator_url FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE json_extract(a.metadata,'$.coverage')='complete'",
      );
      for (const row of full) {
        const { url } = JSON.parse(row.metadata);
        if (
          proofs.get(reviewKey(row.validator_url, url)) !==
          digest(JSON.parse(row.body).join("\n\n"))
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
      const { paragraphs, ...content } = e.content;
      const body = JSON.stringify(paragraphs);
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
        policyVersion: 1,
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
      m.withdrawn = true;
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
    const row = this.one<StoredArticle>(
      "SELECT a.* FROM articles a JOIN feeds f ON f.id=a.feed_id WHERE f.owner=? AND a.id=?",
      owner,
      id,
    );
    if (!row) throw notFound();
    return { ...JSON.parse(row.metadata), paragraphs: JSON.parse(row.body) };
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
