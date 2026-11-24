import { originalText } from "../../shared/original";
import {
  articleListItem,
  bodyText,
  initialState,
  type Article,
  type ArticleListItem,
  type Collection,
  type ReadingState,
} from "./model";

const words = new Intl.Segmenter("en", { granularity: "word" });
export function tokens(text: string) {
  const result: string[] = [];
  for (const part of words.segment(text.normalize("NFKC"))) {
    if (part.isWordLike)
      result.push(
        part.segment
          .toLowerCase()
          .normalize("NFD")
          .replace(/(\p{Script=Latin})\p{M}+/gu, "$1"),
      );
  }
  return result;
}
export function indexEdition(article: Article) {
  const list = articleListItem(article);
  const text =
    article.coverage !== "missing" &&
    article.permissions.display &&
    article.permissions.retain
      ? article.document
        ? originalText(article.document.nodes)
        : bodyText(article.blocks)
      : "";
  const body = tokens(text);
  if (article.coverage === "complete" && body.length)
    list.wordCount = body.length;
  const terms = new Set(
    tokens(
      [list.title, list.author, list.publication, ...list.topics].join(" "),
    ),
  );
  for (const word of body) terms.add(word);
  return { list, posting: { id: list.id, terms: [...terms] } };
}

export const sortOptions = {
  newest: "Newest first",
  oldest: "Oldest first",
  shortest: "Shortest first",
  longest: "Longest first",
};
export interface SearchOptions {
  text: string;
  publication: string;
  topic: string | null; // The empty string selects untagged articles.
  read: "any" | "unread" | "opened";
  saved: boolean;
  archived: boolean;
  sort: keyof typeof sortOptions;
  grouped: boolean;
}
export const defaults: SearchOptions = {
  text: "",
  publication: "",
  topic: null,
  read: "any",
  saved: false,
  archived: false,
  sort: "newest",
  grouped: false,
};
export function filtered(o: SearchOptions) {
  return !!(
    o.text.trim() ||
    o.publication ||
    o.topic !== null ||
    o.read !== "any" ||
    o.saved ||
    o.archived
  );
}
type Row = { a: ArticleListItem; s: ReadingState };
function membership(map: Map<string, Set<string>>, label: string, id: string) {
  let set = map.get(label);
  if (!set) {
    set = new Set();
    map.set(label, set);
  }
  set.add(id);
}
// A warm projection of metadata and membership. Body text stays in the article
// store; IndexedDB's multi-entry token index supplies only matching primary keys.
export function buildCatalog(
  articles: ArticleListItem[],
  states: ReadingState[],
) {
  const reading = new Map(states.map((s) => [s.id, s]));
  const rows = new Map<string, Row>();
  const publications = new Map<string, Set<string>>(),
    topics = new Map<string, Set<string>>();
  const status = {
    unarchived: new Set<string>(),
    unread: new Set<string>(),
    opened: new Set<string>(),
    saved: new Set<string>(),
    archived: new Set<string>(),
  };
  for (const a of articles) {
    const s = reading.get(a.id) ?? initialState(a.id);
    rows.set(a.id, { a, s });
    membership(publications, a.publication, a.id);
    for (const topic of a.topics.length ? a.topics : [""])
      membership(topics, topic, a.id);
    status[s.archived ? "archived" : "unarchived"].add(a.id);
    status[s.opened ? "opened" : "unread"].add(a.id);
    if (s.saved) status.saved.add(a.id);
  }
  return { rows, publications, topics, status };
}
export type SearchCatalog = ReturnType<typeof buildCatalog>;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function order(a: ArticleListItem, b: ArticleListItem, o: SearchOptions) {
  if (o.grouped && a.publication !== b.publication)
    return compare(a.publication, b.publication);
  if (o.sort === "shortest" || o.sort === "longest") {
    if ((a.wordCount === undefined) !== (b.wordCount === undefined))
      return a.wordCount === undefined ? 1 : -1;
    if (a.wordCount !== b.wordCount)
      return (o.sort === "shortest" ? 1 : -1) * (a.wordCount! - b.wordCount!);
  }
  if (
    a.newestFirst === Number.MAX_SAFE_INTEGER ||
    b.newestFirst === Number.MAX_SAFE_INTEGER
  )
    return a.newestFirst - b.newestFirst || compare(a.id, b.id);
  return (
    (o.sort === "oldest" ? -1 : 1) * (a.newestFirst - b.newestFirst) ||
    compare(a.id, b.id)
  );
}
function candidates(
  c: SearchCatalog,
  collection: Collection,
  o: SearchOptions,
  terms: Set<string>[],
  prospective = false,
) {
  const sets = [...terms];
  if (collection === "Unread") sets.push(c.status.unarchived, c.status.unread);
  if (collection === "Saved" || o.saved) sets.push(c.status.saved);
  if (collection === "Archive" || o.archived) sets.push(c.status.archived);
  if (collection === "Inbox" && !filtered(o) && !prospective)
    sets.push(c.status.unarchived);
  if (o.read !== "any") sets.push(c.status[o.read]);
  if (o.publication) sets.push(c.publications.get(o.publication) ?? new Set());
  if (o.topic !== null) sets.push(c.topics.get(o.topic) ?? new Set());
  sets.sort((a, b) => a.size - b.size);
  const [smallest, ...others] = sets;
  const rows: Row[] = [];
  for (const id of smallest ?? c.rows.keys()) {
    if (others.every((set) => set.has(id))) {
      const row = c.rows.get(id);
      if (row) rows.push(row);
    }
  }
  return rows;
}
export function resultPage(
  c: SearchCatalog,
  collection: Collection,
  o: SearchOptions,
  terms: Set<string>[],
  limit: number,
  chosen?: string,
) {
  const matches = candidates(c, collection, o, terms);
  matches.sort((x, y) => order(x.a, y.a, o));
  return {
    collection,
    text: o.text,
    rows: matches.slice(0, limit),
    total: matches.length,
    unread: matches.reduce((n, r) => n + Number(!r.s.opened), 0),
    selected: chosen ? c.rows.get(chosen) : matches[0],
  };
}
// Each option shows how many articles would match with the other filters kept.
export function facetCounts(
  c: SearchCatalog,
  collection: Collection,
  o: SearchOptions,
  terms: Set<string>[],
) {
  const publications = new Map<string, number>(),
    topics = new Map<string, number>();
  for (const { a } of candidates(
    c,
    collection,
    { ...o, publication: "" },
    terms,
    true,
  ))
    publications.set(a.publication, (publications.get(a.publication) ?? 0) + 1);
  for (const { a } of candidates(
    c,
    collection,
    { ...o, topic: null },
    terms,
    true,
  ))
    for (const t of a.topics.length ? a.topics : [""])
      topics.set(t, (topics.get(t) ?? 0) + 1);
  return { publications, topics };
}
