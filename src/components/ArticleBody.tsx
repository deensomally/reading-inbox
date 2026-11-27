import { ExternalLink, ChevronRight } from "lucide-react";
import { StructuredOriginal } from "./StructuredOriginal";
import type { Article } from "../data/model";
import { useLibrary } from "../data/library-context";
function useHandoff(a: Article) {
  const db = useLibrary();
  return () => void db.markRead(a.id, "publisherOpened");
}
export function PublisherLink({ a }: { a: Article }) {
  const handoff = useHandoff(a);
  return (
    a.publisher && (
      <a
        className="text-action"
        href={a.publisher}
        target="_blank"
        rel="noreferrer"
        onClick={handoff}
      >
        Open on publisher site <ExternalLink />
      </a>
    )
  );
}
export function ArticleBody({ a }: { a: Article }) {
  const handoff = useHandoff(a);
  if (!a.permissions.display)
    return <p>{a.reason ?? "The article text is unavailable."}</p>;
  return (
    <div className="original-body">
      {a.document ? (
        <StructuredOriginal nodes={a.document.nodes} />
      ) : (
        a.blocks.map((b, i) => {
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
              {b.inlineLink && b.text.includes(b.inlineLink.text) ? (
                <>
                  {b.text.slice(0, b.text.indexOf(b.inlineLink.text))}
                  <a href={b.inlineLink.href} target="_blank" rel="noreferrer">
                    {b.inlineLink.text}
                  </a>
                  {b.text.slice(
                    b.text.indexOf(b.inlineLink.text) +
                      b.inlineLink.text.length,
                  )}
                </>
              ) : (
                b.text
              )}
              {b.link && (
                <>
                  {" "}
                  <a
                    href={b.link.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={handoff}
                  >
                    {b.link.text}
                  </a>
                </>
              )}
            </p>
          );
        })
      )}
    </div>
  );
}
export function Discussion({ a }: { a: Article }) {
  const handoff = useHandoff(a);
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
            <p>
              {a.library
                ? "The publisher provides a discussion for this article."
                : "This fictional article has a demo discussion page."}
            </p>
            <a
              className="text-action"
              href={a.discussion}
              target="_blank"
              rel="noreferrer"
              onClick={handoff}
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
