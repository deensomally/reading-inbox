import { ExternalLink, ChevronRight } from "lucide-react";
import type { Article } from "../data/model";
import { db } from "../data/store";
export function handoff(a: Article) {
  void db.states.update(a.id, { publisherOpened: true });
}
export function PublisherLink({ a }: { a: Article }) {
  return (
    a.publisher && (
      <a
        className="text-action"
        href={a.publisher}
        target="_blank"
        rel="noreferrer"
        onClick={() => handoff(a)}
      >
        Open on publisher site <ExternalLink />
      </a>
    )
  );
}
export function ArticleBody({ a }: { a: Article }) {
  if (!a.permissions.display)
    return <p>{a.reason ?? "The article text is unavailable."}</p>;
  return (
    <div className="original-body">
      {a.blocks.map((b, i) => {
        if (b.kind === "figure")
          return (
            <figure key={i}>
              <img src={b.src} alt={b.alt} width={800} height={220} />
              <figcaption>{b.caption}</figcaption>
            </figure>
          );
        if (b.kind === "list")
          return (
            <ul key={i}>
              {b.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          );
        if (b.kind === "heading") return <h3 key={i}>{b.text}</h3>;
        if (b.kind === "quote")
          return <blockquote key={i}>{b.text}</blockquote>;
        return (
          <p key={i}>
            {b.text}
            {b.link && (
              <>
                {" "}
                <a
                  href={b.link.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => handoff(a)}
                >
                  {b.link.text}
                </a>
              </>
            )}
          </p>
        );
      })}
    </div>
  );
}
export function Discussion({ a }: { a: Article }) {
  if (a.coverage !== "complete" || !a.permissions.display) return null;
  return (
    <details className="discussion">
      <summary>
        <ChevronRight /> Reader discussion
      </summary>
      <div>
        {a.commentsDisabled ? (
          <p>The publisher has disabled comments for this article.</p>
        ) : a.discussion ? (
          <>
            <p>This fictional article has a demo discussion page.</p>
            <a
              className="text-action"
              href={a.discussion}
              target="_blank"
              rel="noreferrer"
              onClick={() => handoff(a)}
            >
              View original comments <ExternalLink />
            </a>
          </>
        ) : a.publisher ? (
          <>
            <p>
              The publisher supplied a post link. Check the post for a
              discussion.
            </p>
            <PublisherLink a={a} />
          </>
        ) : (
          <p>This newsletter supplied no web address for a discussion.</p>
        )}
      </div>
    </details>
  );
}
