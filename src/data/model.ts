export const stages = [
  "essence",
  "brief",
  "understanding",
  "original",
] as const;
export type Stage = (typeof stages)[number];
export type SummaryStage = Exclude<Stage, "original">;
export const stageInfo: Record<Stage, [string, string]> = {
  essence: ["Essence", "The central idea in one sentence"],
  brief: ["Brief", "The argument in one paragraph"],
  understanding: [
    "Understanding",
    "The reasoning and caveats in three paragraphs",
  ],
  original: ["Original", "The author's own words"],
};

export type Block =
  | {
      kind: "paragraph" | "heading" | "quote";
      text: string;
      link?: { text: string; href: string };
    }
  | { kind: "list"; items: string[] }
  | { kind: "figure"; src: string; alt: string; caption: string };
export type Delivery =
  | { kind: "rss"; guid: string; blocks: Block[] }
  | { kind: "newsletter"; messageId: string; text: string };
export interface Fixture {
  id: string;
  title: string;
  publication: string;
  author?: string;
  published?: string;
  received: string;
  delivery: Delivery;
  coverage: "complete" | "excerpt" | "missing";
  reason?: string;
  publisher?: string;
  discussion?: string;
  commentsDisabled?: boolean;
}
export interface Article extends Omit<Fixture, "delivery"> {
  source: "rss" | "newsletter";
  sourceKey: string;
  blocks: Block[];
  bodyHash: string;
  permissions: {
    display: boolean;
    copy: boolean;
    retain: boolean;
    summarise: boolean;
  };
}
export interface ReadingState {
  id: string;
  saved: boolean;
  archived: boolean;
  opened: boolean;
  deepest?: Stage;
  lastStage?: Stage;
  publisherOpened?: boolean;
}
export const initialState = (id: string): ReadingState => ({
  id,
  saved: false,
  archived: false,
  opened: false,
});
export function bodyText(blocks: Block[]) {
  return blocks
    .map((b) =>
      b.kind === "figure"
        ? b.caption
        : b.kind === "list"
          ? b.items.map((t) => "• " + t).join("\n")
          : b.text + (b.link ? " " + b.link.text : ""),
    )
    .join("\n\n");
}
export function status(state: ReadingState) {
  if (state.deepest === "original") return "Original opened";
  if (state.deepest) return "Skimmed";
  return state.opened ? "Opened" : "Unread";
}
export const collections = ["Inbox", "Unread", "Saved", "Archive"] as const;
export type Collection = (typeof collections)[number];
export function belongs(collection: Collection, s: ReadingState) {
  if (collection === "Saved") return s.saved;
  if (collection === "Archive") return s.archived;
  return !s.archived && (collection === "Inbox" || !s.opened);
}
export function dateLabel(article: Article, long = false) {
  const date = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: long ? "long" : "short",
    ...(long && { year: "numeric" }),
    timeZone: "UTC",
  }).format(new Date(article.published ?? article.received));
  return (article.published ? "" : "Received ") + date;
}
