import { type Table } from "dexie";
import { debianReview } from "../../shared/reviewed-article";
import { Library } from "./store";
import type { Article } from "./model";
import { ServiceError, type BrowserSession } from "./connection";
export interface Subscription {
  id: string;
  title: string;
  url: string;
  active: boolean;
  paused: boolean;
  lastSuccess: number | null;
  nextPoll: number | null;
  retryAfter: number;
  possibleGapSince: number | null;
  error: string | null;
}
export interface ChangeRequest {
  seq?: number;
  action: "subscribe" | "unsubscribe" | "refresh";
  value: string;
  error?: string;
}
// Replay older snapshots once to fill in page eligibility, topics and portable identities.
const articleFormat = 5;
interface Checkpoint {
  id: "delivery";
  phase: "snapshot" | "changes";
  cursor: string | null;
  articleFormat?: number;
}
export interface Delivery {
  id: string;
  feedId: string;
  sourceRef?: string;
  portableId?: string;
  title: string;
  author: string | null;
  publication: string;
  topics?: string[];
  published: string | null;
  received: string;
  url: string | null;
  discussion: string | null;
  coverage: Article["coverage"];
  revision: string;
  reason: string;
  withdrawn: boolean;
  provenance?: Article["provenance"];
  pageCandidate?: { url: string };
  pageUrl?: string;
  pageCheckedAt?: number;
  document?: Article["document"];
  commentsDisabled?: boolean;
  subscriberOnly?: boolean;
  paragraphs: string[];
  license: string | null;
  permissions: Article["permissions"];
}
export function adaptDelivery(d: Delivery): Article {
  const display =
    !d.withdrawn &&
    d.permissions.display &&
    d.permissions.retain &&
    d.paragraphs.length > 0;
  const reviewed =
    (!d.provenance || d.provenance === "verified-feed") &&
    d.url === debianReview.article &&
    d.license === debianReview.license &&
    d.coverage === "complete" &&
    display;
  const blocks = display
    ? d.paragraphs.map((text, i) => {
        const link = reviewed
          ? debianReview.links.find((l) => l.paragraph === i)
          : undefined;
        return {
          kind: "paragraph" as const,
          text,
          ...(link ? { inlineLink: { text: link.text, href: link.href } } : {}),
        };
      })
    : [];
  return {
    id: "rss-" + d.id,
    library: "subscriptions",
    source: "rss",
    sourceKey: d.id,
    sourceRef: d.sourceRef,
    portableId: d.portableId,
    withdrawn: d.withdrawn,
    title: d.title,
    publication: d.publication,
    topics: d.topics ?? [],
    author: d.author ?? undefined,
    published: d.published ?? undefined,
    received: d.received,
    publisher: d.url ?? undefined,
    discussion: d.discussion ?? undefined,
    coverage: d.withdrawn ? "missing" : d.coverage,
    bodyHash: d.revision,
    blocks,
    reason: d.reason,
    license: d.license ?? undefined,
    reviewedDebian: reviewed,
    document: display ? d.document : undefined,
    pageUrl: d.pageUrl,
    pageCheckedAt: d.pageCheckedAt,
    provenance: d.provenance,
    checkPage: !!d.pageCandidate && !d.withdrawn,
    commentsDisabled: d.commentsDisabled,
    subscriberOnly: d.subscriberOnly,
    permissions: {
      display,
      retain: display,
      copy: display && d.permissions.copy,
      externalAI: display && d.permissions.externalAI === true,
      export: display && d.permissions.export === true,
      summarise: false,
    },
  };
}
export class LiveLibrary extends Library {
  subscriptions!: Table<Subscription, string>;
  checkpoint!: Table<Checkpoint, string>;
  outbox!: Table<ChangeRequest, number>;
  constructor(id: string) {
    super("reading-box-subscriptions-" + id);
    this.version(3).stores({
      subscriptions: "id",
      checkpoint: "id",
      outbox: "++seq",
    });
  }
  async applyPage(
    previous: Checkpoint | undefined,
    next: Checkpoint,
    items: Delivery[],
  ) {
    return this.transaction(
      "rw",
      [
        this.articles,
        this.articleList,
        this.searchTerms,
        this.summaries,
        this.states,
        this.checkpoint,
      ],
      async () => {
        const current = await this.checkpoint.get("delivery");
        if (
          current?.phase !== previous?.phase ||
          current?.cursor !== previous?.cursor ||
          current?.articleFormat !== previous?.articleFormat
        )
          return false;
        await this.deliver(items.map(adaptDelivery));
        await this.checkpoint.put({ ...next, articleFormat });
        return true;
      },
    );
  }
}
interface Snapshot {
  items: Delivery[];
  nextCursor: string | null;
  changesCursor: string;
}
interface Changes {
  items: { article: Delivery }[];
  nextCursor: string;
  hasMore: boolean;
}
type Client = Pick<BrowserSession, "request">;
export async function collect(library: LiveLibrary, client: Client) {
  const run = async () => {
    let feedback = "";
    for (const op of await library.outbox.toArray()) {
      if (op.error) continue;
      try {
        if (op.action === "subscribe") {
          await client.request("subscriptions", "POST", { url: op.value });
          feedback = "Subscription added.";
        } else if (op.action === "unsubscribe") {
          await client.request(
            "subscriptions/" + encodeURIComponent(op.value),
            "DELETE",
          );
          feedback =
            "Subscription removed. Its observed articles are still available.";
        } else {
          const r = await client.request<{
            status: string;
            subscription: Subscription;
          }>(
            "subscriptions/" + encodeURIComponent(op.value) + "/refresh",
            "POST",
          );
          feedback =
            r.status === "cooldown"
              ? "This feed can be checked again after " +
                new Date(r.subscription.retryAfter).toLocaleString() +
                "."
              : r.status === "failed"
                ? (r.subscription.error ?? "Refresh failed.")
                : r.status === "not_modified"
                  ? "The publisher has no changes."
                  : "Feed checked.";
        }
        await library.outbox.delete(op.seq!);
      } catch (err) {
        if (
          !(err instanceof ServiceError) ||
          !err.status ||
          err.status === 401 ||
          err.status === 429 ||
          err.status === 503
        )
          throw err;
        await library.outbox.update(op.seq!, { error: err.message });
      }
    }
    const subscriptions = await client.request<{ items: Subscription[] }>(
      "subscriptions",
    );
    await library.transaction("rw", library.subscriptions, async () => {
      await library.subscriptions.clear();
      await library.subscriptions.bulkPut(subscriptions.items);
    });
    let reset = false;
    while (true) {
      const prior = await library.checkpoint.get("delivery");
      // Replay authoritative, body-bearing snapshot pages once for an older
      // format. Keep the prior records and cursor until a page commits.
      const resume = prior?.articleFormat === articleFormat ? prior : undefined;
      const query =
        "?bodies=true&limit=24" +
        (resume?.cursor ? "&cursor=" + encodeURIComponent(resume.cursor) : "");
      try {
        if (!resume || resume.phase === "snapshot") {
          const p = await client.request<Snapshot>("articles" + query);
          await library.applyPage(
            prior,
            {
              id: "delivery",
              phase: p.nextCursor ? "snapshot" : "changes",
              cursor: p.nextCursor ?? p.changesCursor,
            },
            p.items,
          );
        } else {
          const p = await client.request<Changes>("changes" + query);
          const applied = await library.applyPage(
            prior,
            { id: "delivery", phase: "changes", cursor: p.nextCursor },
            p.items.map((i) => i.article),
          );
          if (applied && !p.hasMore) break;
        }
      } catch (err) {
        if (
          !reset &&
          resume?.cursor &&
          err instanceof ServiceError &&
          err.code === "invalid_cursor"
        ) {
          reset = true;
          // Another tab may already have recovered this cursor.
          await library.applyPage(
            prior,
            { id: "delivery", phase: "snapshot", cursor: null },
            [],
          );
          continue;
        }
        throw err;
      }
    }
    return feedback;
  };
  return navigator.locks
    ? navigator.locks.request(library.name + "/collect", run)
    : run();
}
