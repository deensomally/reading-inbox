import { createElement, type ReactNode } from "react";
import { originalTags, type OriginalNode } from "../../shared/original";
const tags = new Set<string>(originalTags);
function webLink(url?: string) {
  try {
    const u = new URL(url ?? "");
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function StructuredOriginal({ nodes }: { nodes: OriginalNode[] }) {
  function render(n: OriginalNode, key: number): ReactNode {
    if (typeof n === "string") return n;
    if (!tags.has(n.tag)) return null;
    const href = webLink(n.href);
    if (n.tag === "img") {
      if (n.image?.startsWith("data:image/png;base64,"))
        return <img key={key} src={n.image} alt={n.alt ?? ""} />;
      return (
        <span key={key} className="figure-handoff">
          {n.alt && <span>{n.alt} </span>}
          {href && (
            <a href={href} rel="noreferrer" target="_blank">
              View publisher image
            </a>
          )}
        </span>
      );
    }
    if (n.tag === "hr" || n.tag === "br") return createElement(n.tag, { key });
    const children = n.children.map(render);
    if (n.tag === "a" && !href) return children;
    const content = createElement(
      n.tag,
      {
        key,
        ...(n.passage && { id: "reading-passage-" + n.passage }),
        ...(n.fragment &&
          n.tag === "a" && {
            onClick: (event: React.MouseEvent) => {
              const target = document.getElementById(
                "reading-passage-" + n.fragment,
              );
              if (
                target &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey
              ) {
                event.preventDefault();
                target.scrollIntoView({ block: "start" });
              }
            },
          }),
        ...(n.tag === "a" && { href, rel: "noreferrer", target: "_blank" }),
        ...(n.tag === "ol" && { start: n.start }),
        ...((n.tag === "th" || n.tag === "td") && {
          colSpan: n.colspan,
          rowSpan: n.rowspan,
        }),
      },
      children,
    );
    return n.tag === "table" ? (
      <div
        key={key}
        className="article-table"
        tabIndex={0}
        aria-label="Article table"
        role="region"
      >
        {content}
      </div>
    ) : (
      content
    );
  }
  return <>{nodes.map(render)}</>;
}
