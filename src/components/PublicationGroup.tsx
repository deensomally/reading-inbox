import { useId, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { pageSize, type PublicationPage } from "../data/search";

export function PublicationGroup({
  group,
  resize,
  children,
}: {
  group: PublicationPage;
  resize: (limit: number) => void;
  children: ReactNode;
}) {
  const id = useId();
  const expanded = group.limit > 0;
  return (
    <section>
      <h2 className="group-heading">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => resize(expanded ? 0 : pageSize)}
        >
          <ChevronRight aria-hidden="true" />
          <span className="publication-group">{group.name}</span>
          <span className="group-count">
            {group.total.toLocaleString()}{" "}
            {group.total === 1 ? "article" : "articles"}
          </span>
        </button>
      </h2>
      <div id={id} hidden={!expanded}>
        {children}
        {expanded && group.total > group.rows.length && (
          <button
            className="secondary load-more"
            onClick={() => resize(group.limit + pageSize)}
          >
            Show more from {group.name}
          </button>
        )}
      </div>
    </section>
  );
}
