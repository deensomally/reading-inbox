import { memo } from "react";
import { Archive, Bookmark, BookOpen } from "lucide-react";
import { dateLabel, status, type Collection } from "../data/model";
import type { Row } from "../data/search";
import { readerUrl } from "../navigation";

export const InboxRow = memo(function InboxRow({
  row,
  selected,
  live,
  collection,
  showLength,
}: {
  row: Row;
  selected: boolean;
  live: boolean;
  collection: Collection;
  showLength: boolean;
}) {
  const { a, s } = row;
  return (
    <div className={"article-row" + (selected ? " selected" : "")}>
      <a
        className="row-link"
        id={"row-" + a.id}
        href={readerUrl(collection, a.id, s.lastStage ?? "essence", live)}
      >
        <div className="row-top">
          <span>{a.publication}</span>
          <time dateTime={a.published ?? a.received}>{dateLabel(a)}</time>
        </div>
        <h2>{a.title}</h2>
        <div className="row-bottom">
          {a.author && (
            <>
              <span>{a.author}</span>
              <i />
            </>
          )}
          <span className="read-state">
            {!s.opened && <b />}
            {status(s)}
          </span>
          {s.archived && <Archive size={13} aria-label="Archived" />}
          {showLength && (
            <span>
              {a.wordCount === undefined
                ? "Length unknown"
                : "Verified · " +
                  a.wordCount.toLocaleString() +
                  (a.wordCount === 1 ? " word" : " words")}
            </span>
          )}
          {s.saved && <Bookmark aria-label="Saved" size={13} />}
        </div>
      </a>
      <a
        className="quick-original"
        aria-label={"Read original of " + a.title}
        title="Read original"
        href={readerUrl(collection, a.id, "original", live)}
      >
        <BookOpen />
      </a>
    </div>
  );
});
