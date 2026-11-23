// Only these elements and explicitly modelled attributes can reach the reader.
export const originalTags = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "em",
  "strong",
  "small",
  "sub",
  "sup",
  "s",
  "mark",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "blockquote",
  "cite",
  "figure",
  "figcaption",
  "img",
  "table",
  "caption",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "code",
  "pre",
  "br",
  "hr",
] as const;
export type OriginalTag = (typeof originalTags)[number];
export type OriginalNode =
  | string
  | {
      tag: OriginalTag;
      children: OriginalNode[];
      href?: string;
      passage?: string;
      fragment?: string;
      start?: number;
      colspan?: number;
      rowspan?: number;
      alt?: string;
      image?: string;
    };
export interface OriginalDocument {
  nodes: OriginalNode[];
  limitations: string[];
}
export interface PublisherCheckIssue {
  message: string;
  retryAt?: number;
}
export interface OriginalCheck {
  revision: string;
  issue?: PublisherCheckIssue;
}
// Build paragraphs rather than normalising the finished text. Whitespace inside a
// preformatted passage is part of the publisher's edition.
export function originalText(nodes: OriginalNode[]): string {
  function series(children: OriginalNode[]) {
    const parts: string[] = [];
    let line = "";
    const flush = () => {
      if (line.trim()) parts.push(line.trim());
      line = "";
    };
    for (const n of children) {
      if (typeof n === "string") {
        line += n;
        continue;
      }
      if (n.tag === "br") {
        line += "\n";
        continue;
      }
      if (n.tag === "img") {
        if (n.alt) line += "[" + n.alt + "]";
        continue;
      }
      if (
        [
          "a",
          "em",
          "strong",
          "mark",
          "sup",
          "sub",
          "small",
          "s",
          "code",
          "cite",
        ].includes(n.tag)
      ) {
        line += inline(n.children);
        continue;
      }
      flush();
      const { tag, children: inner } = n;
      let text: string;
      if (tag === "pre") text = inline(inner);
      else if (tag === "ul" || tag === "ol") {
        text = inner
          .filter(
            (i): i is Exclude<OriginalNode, string> =>
              typeof i !== "string" && i.tag === "li",
          )
          .map((item, i) => {
            const label =
              tag === "ul" ? "• " : String((n.start ?? 1) + i) + ". ";
            const lines = series(item.children).split("\n");
            return label + lines.filter(Boolean).join("\n  ");
          })
          .join("\n");
      } else if (tag === "tr")
        text = inner
          .filter(
            (i): i is Exclude<OriginalNode, string> =>
              typeof i !== "string" && (i.tag === "td" || i.tag === "th"),
          )
          .map((i) => series(i.children))
          .join("\t");
      else if (["thead", "tbody", "tfoot"].includes(tag))
        text = inner
          .filter((i) => typeof i !== "string" && i.tag === "tr")
          .map((i) => series([i]))
          .join("\n");
      else text = series(inner);
      if (text) parts.push(text);
    }
    flush();
    return parts.join("\n\n");
  }
  function inline(children: OriginalNode[]): string {
    return children
      .map((n) =>
        typeof n === "string"
          ? n
          : n.tag === "br"
            ? "\n"
            : n.tag === "img"
              ? n.alt
                ? "[" + n.alt + "]"
                : ""
              : inline(n.children),
      )
      .join("");
  }
  return series(nodes);
}
