import { useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Dialog } from "./Dialogs";
import type { Collection } from "../data/model";
import {
  defaults,
  facetCounts,
  filtered,
  sortOptions,
  type SearchCatalog,
  type SearchOptions,
} from "../data/search";

export function InboxControls({
  options,
  change,
  clear,
  catalog,
  terms,
  collection,
  total,
}: {
  options: SearchOptions;
  change: (o: SearchOptions) => void;
  clear: () => void;
  catalog: SearchCatalog;
  terms: Set<string>[];
  collection: Collection;
  total: number;
}) {
  const [show, setShow] = useState(false);
  const counts = useMemo(
    () => (show ? facetCounts(catalog, collection, options, terms) : undefined),
    [show, catalog, collection, options, terms],
  );
  const custom =
    filtered(options) || options.grouped || options.sort !== defaults.sort;
  function set(patch: Partial<SearchOptions>) {
    change({ ...options, ...patch });
  }
  return (
    <>
      <div className="search-bar">
        <label className="search-input">
          <Search aria-hidden="true" />
          <input
            type="search"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            aria-label="Search articles"
            placeholder="Search articles"
            value={options.text}
            onChange={(e) => set({ text: e.target.value })}
          />
        </label>
        <button
          className="secondary"
          onClick={() => setShow(true)}
          aria-label="Filter and sort articles"
        >
          <SlidersHorizontal /> Filters
        </button>
      </div>
      {custom && (
        <button className="text-action clear-filters" onClick={clear}>
          Clear all filters
        </button>
      )}
      {show && counts && (
        <Dialog title="Filter and sort" onClose={() => setShow(false)}>
          <div className="inbox-filters">
            <div>
              <label htmlFor="filter-publication">Publication</label>
              <select
                id="filter-publication"
                value={options.publication}
                onChange={(e) => set({ publication: e.target.value })}
              >
                <option value="">All publications</option>
                {[...catalog.publications.keys()].sort().map((p) => (
                  <option key={p} value={p}>
                    {p} ({counts.publications.get(p) ?? 0})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="filter-topic">Topic</label>
              <select
                id="filter-topic"
                value={JSON.stringify(options.topic)}
                onChange={(e) => set({ topic: JSON.parse(e.target.value) })}
              >
                <option value="null">All topics</option>
                {[...catalog.topics.keys()].sort().map((t) => (
                  <option key={t} value={JSON.stringify(t)}>
                    {t || "Untagged"} ({counts.topics.get(t) ?? 0})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="filter-reading-status">Reading status</label>
              <select
                id="filter-reading-status"
                value={options.read}
                onChange={(e) =>
                  set({ read: e.target.value as SearchOptions["read"] })
                }
              >
                <option value="any">Any reading status</option>
                <option value="unread">Unread</option>
                <option value="opened">Opened</option>
              </select>
            </div>
            <div className="flag-filters">
              <label>
                <input
                  type="checkbox"
                  checked={options.saved}
                  onChange={(e) => set({ saved: e.target.checked })}
                />{" "}
                Saved only
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.archived}
                  onChange={(e) => set({ archived: e.target.checked })}
                />{" "}
                Archived only
              </label>
            </div>
            <div>
              <label htmlFor="filter-sort-order">Sort order</label>
              <select
                id="filter-sort-order"
                value={options.sort}
                onChange={(e) =>
                  set({ sort: e.target.value as SearchOptions["sort"] })
                }
              >
                {Object.entries(sortOptions).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <label className="group-filter">
              <input
                type="checkbox"
                checked={options.grouped}
                onChange={(e) => set({ grouped: e.target.checked })}
              />{" "}
              Group by publication
            </label>
            <div className="filter-footer">
              <button className="plain" onClick={clear}>
                Clear all filters
              </button>
              <button className="primary" onClick={() => setShow(false)}>
                Show {total} {total === 1 ? "article" : "articles"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
