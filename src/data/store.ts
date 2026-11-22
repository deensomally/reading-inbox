import Dexie, { type Table } from "dexie";
import { adapt, fixtures } from "./fixtures";
import {
  articleListItem,
  initialState,
  stages,
  type ReadingState,
  type Article,
  type ArticleListItem,
  type Stage,
  type SummaryStage,
} from "./model";
export class Library extends Dexie {
  articles!: Table<Article, string>;
  articleList!: Table<ArticleListItem, string>;
  indexProgress!: Table<{ id: string; lastId?: string }, string>;
  states!: Table<ReadingState, string>;
  summaries!: Table<
    { key: string; articleId: string; paragraphs: string[] },
    string
  >;
  // The database belongs to this browser profile, which defines the device and reader scope in Phase 1.
  positions!: Table<{ id: string; top: number }, string>;
  meta!: Table<{ id: string; value: number }, string>;
  constructor(name = "reading-inbox") {
    super(name);
    this.version(1).stores({
      articles: "id",
      states: "id",
      summaries: "key, articleId",
      positions: "id",
      meta: "id",
    });
    // Leave every v1 record readable by the released reader, including its mock keys.
    this.version(2)
      .stores({
        articleList: "id, [library+newestFirst]",
        indexProgress: "id",
      })
      .upgrade((tx) => tx.table("indexProgress").add({ id: "articleList" }));
  }
  async indexNextBatch(): Promise<boolean> {
    return this.transaction(
      "rw",
      this.articles,
      this.articleList,
      this.indexProgress,
      async () => {
        const cursor = await this.indexProgress.get("articleList");
        if (!cursor) return false;
        const source =
          cursor.lastId === undefined
            ? this.articles.orderBy("id")
            : this.articles.where("id").above(cursor.lastId);
        const batchSize = 64;
        const batch = await source.limit(batchSize).toArray();
        await this.articleList.bulkPut(batch.map(articleListItem));
        if (batch.length < batchSize) {
          await this.indexProgress.delete(cursor.id);
          return false;
        }
        // The checkpoint and the rows it covers commit together, even with two tabs open.
        await this.indexProgress.put({
          id: cursor.id,
          lastId: batch[batch.length - 1].id,
        });
        return true;
      },
    );
  }
  listDemoArticles() {
    return this.articleList
      .where("[library+newestFirst]")
      .between(["demo", Dexie.minKey], ["demo", Dexie.maxKey])
      .toArray();
  }
  async deliver(articles: Article[], { onlyMissing = false } = {}) {
    await this.transaction(
      "rw",
      this.articles,
      this.articleList,
      this.states,
      this.summaries,
      async () => {
        for (const article of articles) {
          const previous = await this.articles.get(article.id);
          if (previous && onlyMissing) {
            // A rolled-back v1 reader can seed an article without its v2 index row.
            await this.articleList.put(articleListItem(previous));
            continue;
          }
          if (
            previous &&
            (previous.bodyHash !== article.bodyHash ||
              previous.coverage !== article.coverage ||
              !article.permissions.summarise)
          )
            await this.summaries.where("articleId").equals(article.id).delete();
          // Opening another tab with the same edition should leave active readers alone.
          if (JSON.stringify(previous) !== JSON.stringify(article)) {
            await this.articles.put(article);
            await this.articleList.put(articleListItem(article));
          }
          if (!(await this.states.get(article.id)))
            await this.states.add(initialState(article.id));
        }
      },
    );
  }
  changeFlag(id: string, field: "saved" | "archived") {
    return this.states
      .where("id")
      .equals(id)
      .modify((s) => {
        s[field] = !s[field];
      });
  }
  viewed(id: string, stage: Stage, reached: boolean) {
    return this.states
      .where("id")
      .equals(id)
      .modify((s) => {
        s.opened = true;
        s.lastStage = stage;
        if (
          reached &&
          (!s.deepest || stages.indexOf(s.deepest) < stages.indexOf(stage))
        )
          s.deepest = stage;
      });
  }
}
export const db = new Library();
export async function seedLibrary(library = db) {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "Open the demo on localhost or HTTPS so this browser can prepare the local library.",
    );
  while (await library.indexNextBatch()) {
    // A new transaction resumes at the last committed article ID.
  }
  const existing = new Set(
    await library.articleList
      .where("id")
      .anyOf(fixtures.map((f) => f.id))
      .primaryKeys(),
  );
  const missing = fixtures.filter((f) => !existing.has(f.id));
  if (missing.length) {
    await library.deliver(await Promise.all(missing.map(adapt)), {
      onlyMissing: true,
    });
  }
}
export const summaryKey = (
  a: Article,
  stage: SummaryStage,
  model = "fixture-v1",
  prompt = "neutral-v1",
) =>
  JSON.stringify([
    "local-demo",
    a.id,
    a.bodyHash,
    a.coverage,
    stage,
    model,
    prompt,
  ]);
type Provider = (a: Article, stage: SummaryStage) => Promise<string[]>;
export const mockSummary: Provider = async (a, stage) => {
  const result = await fetch(
    import.meta.env.BASE_URL + "demo/" + a.id + ".json",
  );
  if (!result.ok)
    throw new Error("The local demo summary could not be loaded.");
  const data = await result.json();
  if (data.bodyHash !== a.bodyHash)
    throw new Error("This revision has no reviewed demo summary yet.");
  if (!Array.isArray(data[stage]) || !data[stage].length)
    throw new Error(
      "The publisher’s excerpt is too short to support this depth.",
    );
  return data[stage];
};
export function summaryService(library: Library, provider: Provider) {
  const pending = new Map<string, Promise<string[]>>();
  async function permitted(a: Article) {
    const current = await library.articles.get(a.id);
    if (
      !current ||
      !current.permissions.summarise ||
      !current.permissions.display ||
      !current.permissions.retain ||
      current.bodyHash !== a.bodyHash ||
      current.coverage !== a.coverage
    )
      throw new Error("A summary is unavailable for this source revision.");
  }
  async function generate(a: Article, stage: SummaryStage, key: string) {
    const cached = await library.transaction(
      "rw",
      library.articles,
      library.summaries,
      library.meta,
      async () => {
        await permitted(a);
        const hit = await library.summaries.get(key);
        if (!hit) {
          const counter = await library.meta.get("requests");
          await library.meta.put({
            id: "requests",
            value: (counter?.value ?? 0) + 1,
          });
        }
        return hit;
      },
    );
    if (cached) return cached.paragraphs;
    const paragraphs = await provider(a, stage);
    await library.transaction(
      "rw",
      library.articles,
      library.summaries,
      async () => {
        await permitted(a);
        await library.summaries.put({ key, articleId: a.id, paragraphs });
      },
    );
    return paragraphs;
  }
  return function request(a: Article, stage: SummaryStage) {
    const key = summaryKey(a, stage);
    const existing = pending.get(key);
    if (existing) return existing;
    const run = () => generate(a, stage, key);
    async function withLock() {
      return globalThis.navigator?.locks
        ? await navigator.locks.request("reading-inbox:" + key, run)
        : await run();
    }
    const result = withLock().finally(() => pending.delete(key));
    pending.set(key, result);
    return result;
  };
}
export const requestSummary = summaryService(db, mockSummary);
