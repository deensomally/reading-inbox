import Dexie, { type Table } from "dexie";
import { adapt, fixtures } from "./fixtures";
import {
  initialState,
  stages,
  type ReadingState,
  type Article,
  type Stage,
  type SummaryStage,
} from "./model";
export class Library extends Dexie {
  articles!: Table<Article, string>;
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
  }
  async deliver(articles: Article[]) {
    await this.transaction(
      "rw",
      this.articles,
      this.states,
      this.summaries,
      async () => {
        for (const article of articles) {
          const previous = await this.articles.get(article.id);
          if (
            previous &&
            (previous.bodyHash !== article.bodyHash ||
              previous.coverage !== article.coverage ||
              !article.permissions.summarise)
          )
            await this.summaries.where("articleId").equals(article.id).delete();
          await this.articles.put(article);
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
export async function seedLibrary() {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "Open the demo on localhost or HTTPS so this browser can prepare the local library.",
    );
  await db.deliver(await Promise.all(fixtures.map(adapt)));
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
