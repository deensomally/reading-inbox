import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Dialog } from "./Dialogs";
import type { Library } from "../data/store";
import {
  beforeDate,
  archiveBatch,
  localMidnight,
  undoArchive,
} from "../data/archive";
import type { Collection } from "../data/model";
import {
  candidates,
  pageSize,
  type Row,
  type SearchCatalog,
  type SearchOptions,
} from "../data/search";
import { PortableLibrary } from "./PortableLibrary";
import type { LibraryKind } from "../data/backup-format";

interface Props {
  db: Library;
  kind: LibraryKind;
  collection: Collection;
  options: SearchOptions;
  catalog: SearchCatalog;
  terms: Set<string>[];
  ordered: Row[];
  checkService?: () => Promise<boolean>;
  onClose: () => void;
}
export function LibraryActions({
  db,
  kind,
  collection,
  options,
  catalog,
  terms,
  ordered,
  checkService,
  onClose,
}: Props) {
  const [view, setView] = useState<"menu" | "archive" | "backup">("menu");
  const [mode, setMode] = useState<"select" | "date">("select");
  const [date, setDate] = useState("");
  const [selection, setSelection] = useState(new Set<string>());
  const [limit, setLimit] = useState(pageSize);
  const [review, setReview] = useState<{ ids: string[]; operation: string }>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const receipt = useLiveQuery(() => db.archiveUndo.get("last"), [db]);
  const scope = [
    collection,
    options.text.trim() && "“" + options.text.trim() + "”",
    options.publication,
    options.topic === null ? "" : options.topic || "Untagged",
    options.read !== "any" && options.read,
    options.saved && "Saved",
    options.archived && "Archived",
  ]
    .filter(Boolean)
    .join(" · ");
  const eligible = useMemo(() => {
    if (view !== "archive") return [];
    const ids = candidates(catalog, collection, options, terms);
    return ordered.filter((r) => ids.has(r.a.id) && !r.s.archived);
  }, [catalog, collection, options, terms, ordered, view]);
  const cutoff = localMidnight(date);
  const chosen = eligible.filter((r) =>
    mode === "date"
      ? beforeDate(r.a.newestFirst, cutoff)
      : selection.has(r.a.id),
  );
  async function work(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Library operation failed.",
      );
      setReview(undefined);
    } finally {
      setBusy(false);
    }
  }
  if (view === "backup")
    return (
      <PortableLibrary
        db={db}
        kind={kind}
        checkService={checkService}
        onClose={onClose}
      />
    );
  return (
    <Dialog
      title={
        view === "menu"
          ? "Library actions"
          : review
            ? "Confirm archive"
            : "Archive articles"
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {view === "menu" ? (
        <div className="library-actions">
          <button
            className="secondary"
            onClick={() => {
              setView("archive");
              setMessage("");
            }}
          >
            Archive articles
          </button>
          <button className="secondary" onClick={() => setView("backup")}>
            Library backup
          </button>
          {receipt && (
            <button
              className="text-action"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  const n = await undoArchive(db, receipt.operation);
                  setMessage(
                    "Restored " +
                      n +
                      " " +
                      (n === 1 ? "article" : "articles") +
                      " from Archive.",
                  );
                })
              }
            >
              Undo last bulk archive
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="backup-scope">Unarchived matches · {scope}</p>
          {review ? (
            <>
              <p>
                <strong>
                  {review.ids.length}{" "}
                  {review.ids.length === 1 ? "article" : "articles"}
                </strong>{" "}
                will move to Archive. The selection is fixed.{" "}
                {mode === "date" && "Cutoff: " + date + " at local midnight."}
              </p>
              <p>
                Saved flags and reading positions are kept. Undo is available in
                Library actions.
              </p>
              <div className="filter-footer">
                <button
                  className="plain"
                  disabled={busy}
                  onClick={() => setReview(undefined)}
                >
                  Edit selection
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void work(async () => {
                      const n = await archiveBatch(
                        db,
                        review.ids,
                        review.operation,
                      );
                      setMessage(
                        "Archived " +
                          n +
                          " " +
                          (n === 1 ? "article." : "articles."),
                      );
                      setReview(undefined);
                      setView("menu");
                      setSelection(new Set());
                    })
                  }
                >
                  Confirm archive of {review.ids.length}
                </button>
              </div>
            </>
          ) : (
            <>
              <fieldset className="archive-modes">
                <legend>Choose articles</legend>
                <label>
                  <input
                    type="radio"
                    name="archive-mode"
                    checked={mode === "select"}
                    onChange={() => setMode("select")}
                  />{" "}
                  Select articles
                </label>
                <label>
                  <input
                    type="radio"
                    name="archive-mode"
                    checked={mode === "date"}
                    onChange={() => setMode("date")}
                  />{" "}
                  Older than a date
                </label>
              </fieldset>
              {mode === "select" ? (
                <>
                  <button
                    className="text-action"
                    disabled={!eligible.length}
                    onClick={() =>
                      setSelection(
                        chosen.length === eligible.length
                          ? new Set()
                          : new Set(eligible.map((r) => r.a.id)),
                      )
                    }
                  >
                    {eligible.length && chosen.length === eligible.length
                      ? "Clear selection"
                      : "Select all " + eligible.length + " matching articles"}
                  </button>
                  <div className="selection-list">
                    {eligible.slice(0, limit).map(({ a }) => (
                      <label key={a.id}>
                        <input
                          type="checkbox"
                          checked={selection.has(a.id)}
                          onChange={() =>
                            setSelection((last) => {
                              const next = new Set(last);
                              if (!next.delete(a.id)) next.add(a.id);
                              return next;
                            })
                          }
                        />
                        <span>
                          {a.title}
                          <small>{a.publication}</small>
                        </span>
                      </label>
                    ))}
                    {eligible.length > limit && (
                      <button
                        className="text-action"
                        onClick={() => setLimit((n) => n + pageSize)}
                      >
                        Show more matches
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <label className="file-label">
                    Archive articles before
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <p>
                    Strictly before midnight in{" "}
                    {Intl.DateTimeFormat().resolvedOptions().timeZone}. Missing
                    publication dates use first receipt.
                  </p>
                </>
              )}
              {!eligible.length && (
                <p>No unarchived articles match these results.</p>
              )}
              <div className="filter-footer">
                <span role="status">{chosen.length} selected</span>
                <button
                  className="primary"
                  disabled={!chosen.length}
                  onClick={() => {
                    setMessage("");
                    setReview({
                      ids: chosen.map((r) => r.a.id),
                      operation: crypto.randomUUID(),
                    });
                  }}
                >
                  Review archive
                </button>
              </div>
            </>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </Dialog>
  );
}
