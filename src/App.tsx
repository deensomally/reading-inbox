import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Archive,
  ArrowDownWideNarrow,
  ArrowLeft,
  BookOpen,
  BookOpenText,
  Bookmark,
  Check,
  CircleDot,
  Inbox,
  Info,
  Rss,
  LibraryBig,
  WifiOff,
} from "lucide-react";
import { Library, db, seedLibrary } from "./data/store";
import { collections, type Collection, type Stage } from "./data/model";
import {
  listUrl,
  navigate,
  readerUrl,
  route,
  useHash,
  type ListContext,
} from "./navigation";
import { Appearance } from "./components/Appearance";
import { Reader } from "./components/Reader";
import { Dialog } from "./components/Dialogs";
import { ArticleBody } from "./components/ArticleBody";

import { LiveLibrary } from "./data/live-library";
import { connections, BrowserSession } from "./data/connection";
import {
  Subscriptions,
  useCollector,
  type Collector,
} from "./components/Subscriptions";
import { LibraryContext } from "./data/library-context";
import {
  defaults,
  filtered,
  resultPage,
  orderedRows,
  pageSize,
  type Row,
  type SearchOptions,
} from "./data/search";
import { InboxRow } from "./components/InboxRow";
import { AppUpdate } from "./components/AppUpdate";
import { PublicationGroup } from "./components/PublicationGroup";
import { InboxControls, SortOrder } from "./components/InboxControls";
// The narrow layout shows one pane at a time. Loading the hidden desktop
// preview would read an article body on every change of the first result.
const narrowLayout = window.matchMedia("(max-width: 51rem)");
function subscribeLayout(change: () => void) {
  narrowLayout.addEventListener("change", change);
  return () => narrowLayout.removeEventListener("change", change);
}
const icons = { Inbox, Unread: CircleDot, Saved: Bookmark, Archive };
const empty: Record<Collection, [string, string]> = {
  Inbox: ["Your inbox is clear", "Archived articles are available in Archive."],
  Unread: [
    "You’re all caught up",
    "Every article in your inbox has been opened.",
  ],
  Saved: [
    "No saved articles yet",
    "Use Save in the reading desk to keep an article here.",
  ],
  Archive: [
    "Your archive is empty",
    "Articles you archive stay available here.",
  ],
};
function About({ onClose }: { onClose: () => void }) {
  const requests = useLiveQuery(
    async () => (await db.meta.get("requests"))?.value ?? 0,
    [],
  );
  return (
    <Dialog title="About this demo" onClose={onClose}>
      <p>
        These articles, publications and publisher pages are fictional. The
        three summary depths use a deterministic mock on this device.
      </p>
      <p>
        Your library and reading progress stay in this browser. Opening a new
        summary depth requests it once. Revisiting it uses the local cache.
      </p>
      <div className="counter">
        <span>Mock summary requests</span>
        <strong>{requests ?? "…"}</strong>
      </div>
    </Dialog>
  );
}
export default function App() {
  const hash = useHash();
  let lastLive = false;
  try {
    lastLive = localStorage.getItem("reading-box.library") === "subscriptions";
  } catch {
    /* The demo also works with preferences disabled. */
  }
  return (
    <>
      <AppUpdate reading={!!route(hash).id} />
      {route(hash).live || (!hash && lastLive) ? (
        <LiveWorkspace hash={hash} />
      ) : (
        <Workspace hash={hash} library={db} />
      )}
    </>
  );
}
function LiveWorkspace({ hash }: { hash: string }) {
  const pairing = useLiveQuery(
    async () => (await connections.pairing.get("browser")) ?? null,
    [],
  );
  const session = useMemo(
    () => (pairing ? new BrowserSession(pairing) : undefined),
    [pairing],
  );
  const library = useMemo(
    () => new LiveLibrary(pairing?.libraryId ?? "unpaired"),
    [pairing?.libraryId],
  );
  const collector = useCollector(library, session);
  if (pairing === undefined)
    return (
      <main className="fallback" role="status">
        Opening your subscriptions…
      </main>
    );
  return (
    <Workspace
      key={library.name}
      hash={hash}
      library={library}
      feeds={{ collector, library, paired: !!pairing }}
    />
  );
}
function Workspace({
  hash,
  library,
  feeds,
}: {
  hash: string;
  library: Library;
  feeds?: { collector: Collector; library: LiveLibrary; paired: boolean };
}) {
  const live = !!feeds;
  const { collection, id, stage, publisher, discussion } = route(hash);
  // A browser may discard the reader tab on mobile. Keep its return context
  // in this history entry, scoped to the local library and outside the URL.
  const remembered: ListContext | undefined = history.state?.listContext;
  const context =
    remembered?.library === library.name && remembered.collection === collection
      ? remembered
      : undefined;
  const [filters, setFilters] = useState<Omit<SearchOptions, "text">>(
    () => context?.options ?? defaults,
  );
  const [text, setText] = useState(() => context?.options.text ?? "");
  const options = useMemo(() => ({ ...filters, text }), [filters, text]);
  const [manage, setManage] = useState(false);
  const [limit, setLimit] = useState(() => context?.limit ?? pageSize);
  const [groupLimits, setGroupLimits] = useState<Map<string, number>>(
    () => context?.groupLimits ?? new Map(),
  );
  const [loaded, setLoaded] = useState(false);
  const [upgradeBlocked, setUpgradeBlocked] = useState(false);
  const [failure, setFailure] = useState("");
  const [showAbout, setAbout] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [message, setMessage] = useState("");
  const noticeTimer = useRef<number>(undefined);
  const list = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const origin = useRef<string | undefined>(undefined);
  const previous = useRef<string | undefined>(id);
  useEffect(() => {
    const blocked = () => setUpgradeBlocked(true);
    library.on("blocked", blocked);
    (live ? library.prepareIndexes() : seedLibrary(library)).then(
      () => setLoaded(true),
      (e) =>
        setFailure(
          e instanceof Error ? e.message : "Local storage could not be opened.",
        ),
    );
    const online = () => setOffline(!navigator.onLine);
    window.addEventListener("online", online);
    window.addEventListener("offline", online);
    return () => {
      library.on.blocked.unsubscribe(blocked);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", online);
      clearTimeout(noticeTimer.current);
    };
  }, [library, live]);
  const catalog = useLiveQuery(
    async () =>
      loaded
        ? library.searchCatalog(live ? "subscriptions" : "demo")
        : undefined,
    [loaded, library, live],
  );
  useEffect(() => {
    if (catalog?.needsIndex.size)
      void library
        .repairLegacyRows(catalog.needsIndex)
        .catch(() =>
          setFailure(
            "The local search index could not be updated. Reload to try again.",
          ),
        );
  }, [catalog, library]);
  const matches = useLiveQuery(
    async () =>
      loaded ? { text, terms: await library.matchingTerms(text) } : undefined,
    [loaded, library, text],
  );
  const ordered = useMemo(
    () => catalog && orderedRows(catalog, filters.sort, filters.grouped),
    [catalog, filters.sort, filters.grouped],
  );
  const page = useMemo(
    () =>
      catalog && matches && ordered
        ? resultPage(
            catalog,
            collection,
            { ...filters, text: matches.text },
            matches.terms,
            limit,
            id,
            ordered,
            groupLimits,
          )
        : undefined,
    [catalog, matches, ordered, collection, filters, limit, id, groupLimits],
  );
  function changeOptions({ text, ...patch }: Partial<SearchOptions>) {
    if (text !== undefined) setText(text);
    if (Object.keys(patch).length)
      setFilters((previous) => ({ ...previous, ...patch }));
    setLimit(pageSize);
    setGroupLimits((previous) => (previous.size ? new Map() : previous));
    if (list.current) list.current.scrollTop = 0;
  }
  function clearOptions() {
    changeOptions(defaults);
    if (collection !== "Inbox" || id) navigate(listUrl("Inbox", live));
  }
  const visible = page?.rows ?? [];
  const selected = id
    ? page?.selected?.a.id === id
      ? page.selected
      : visible.find((row) => row.a.id === id)
    : visible[0];
  const narrow = useSyncExternalStore(
    subscribeLayout,
    () => narrowLayout.matches,
  );
  const selectedId = id || !narrow ? selected?.a.id : undefined;
  const article = useLiveQuery(
    () => (selectedId ? library.articles.get(selectedId) : undefined),
    [library, selectedId],
  );
  const current =
    selected && article?.id === selected.a.id
      ? { a: article, s: selected.s }
      : undefined;
  const ready = loaded && !!page;
  useEffect(() => {
    const pane = list.current;
    if (!ready || id || !pane) return;
    const key = (live ? "feeds-list-" : "list-") + collection;
    const save = () => sessionStorage.setItem(key, String(pane.scrollTop));
    pane.addEventListener("scrollend", save);
    window.addEventListener("pagehide", save);
    return () => {
      pane.removeEventListener("scrollend", save);
      window.removeEventListener("pagehide", save);
    };
  }, [collection, id, live, ready]);
  useLayoutEffect(() => {
    if (!ready) return;
    if (ready && list.current && !id) {
      list.current.scrollTop =
        Number(
          sessionStorage.getItem((live ? "feeds-list-" : "list-") + collection),
        ) || 0;
      if (previous.current) {
        const target = document.getElementById(
          "row-" + (origin.current ?? previous.current),
        );
        (target ?? title.current)?.focus({ preventScroll: true });
      }
    }
    previous.current = id;
  }, [collection, id, ready, live]);
  const pageTitle =
    (id && selected ? selected.a.title : collection) + " · Reading Box";
  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);
  function notify(text: string) {
    setMessage(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setMessage(""), 2700);
  }
  function open(articleId: string, s: Stage) {
    if (articleId !== id) {
      origin.current = articleId;
      if (list.current)
        sessionStorage.setItem(
          (live ? "feeds-list-" : "list-") + collection,
          String(list.current.scrollTop),
        );
    }
    navigate(
      readerUrl(collection, articleId, s, live),
      !!id,
      !id || !!history.state?.fromList,
      { library: library.name, collection, options, limit, groupLimits },
    );
  }
  function back() {
    if (history.state?.fromList) history.back();
    else navigate(listUrl(collection, live), true);
  }
  function renderRow(row: Row) {
    return (
      <InboxRow
        key={row.a.id}
        row={row}
        selected={row.a.id === selected?.a.id}
        live={live}
        collection={collection}
        showLength={options.sort === "shortest" || options.sort === "longest"}
      />
    );
  }
  const layoutReady = ready && !failure;
  return (
    <LibraryContext.Provider value={library}>
      <div className={"app" + (id ? " reading" : "")}>
        <header className="masthead">
          <a className="brand" href={listUrl("Inbox", live)}>
            <span className="brand-mark">
              <BookOpenText />
            </span>
            Reading Box
          </a>
          {!publisher && (
            <nav className="collections" aria-label="Collections">
              {collections.map((c) => {
                const Icon = icons[c];
                return (
                  <a
                    key={c}
                    href={listUrl(c, live)}
                    onClick={(e) => {
                      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey)
                        changeOptions(defaults);
                    }}
                    aria-current={collection === c ? "page" : undefined}
                  >
                    <Icon />
                    {c}
                  </a>
                );
              })}
            </nav>
          )}
          <div className="edition">
            <Appearance />
            {offline && (
              <span className="offline">
                <WifiOff /> Offline
              </span>
            )}
            {!publisher && (
              <a
                className="plain library-switch"
                href={listUrl("Inbox", !live)}
                onClick={() => {
                  try {
                    localStorage.setItem(
                      "reading-box.library",
                      live ? "demo" : "subscriptions",
                    );
                  } catch {
                    /* Navigation still works. */
                  }
                }}
              >
                {live ? <BookOpen /> : <Rss />}
                {live ? "Fictional demo" : "Subscriptions"}
              </a>
            )}
            {!live && (
              <button
                className="demo-badge"
                onClick={() => setAbout(true)}
                aria-label="About the fictional demo"
              >
                <span />
                Fictional demo
                <Info />
              </button>
            )}
          </div>
        </header>
        {!layoutReady ? (
          <main className="fallback" role="status">
            <BookOpen />
            <h1>{failure ? "Library unavailable" : "Opening your library…"}</h1>
            {!failure && upgradeBlocked && (
              <p>
                Close other Reading Box tabs and windows to finish updating your
                library. This window will continue automatically.
              </p>
            )}
            {failure && (
              <>
                <p>{failure}</p>
                <button className="secondary" onClick={() => location.reload()}>
                  Try again
                </button>
              </>
            )}
          </main>
        ) : publisher && current ? (
          <main className="publisher-page">
            <span className="section-label">
              Demo publisher {discussion ? "discussion" : "page"}
            </span>
            <h1>{current.a.title}</h1>
            <p className="byline">
              {current.a.publication} ·{" "}
              {current.a.author ?? "Publication edition"}
            </p>
            {discussion ? (
              <p>
                This is the fictional discussion destination for this article.
              </p>
            ) : (
              <>
                <ArticleBody a={current.a} />
                {current.a.discussion && (
                  <a href={current.a.discussion}>View original comments</a>
                )}
              </>
            )}
            <p>
              <a href="#/inbox">Return to Reading Box</a>
            </p>
          </main>
        ) : (
          <main className="layout">
            <section
              className="collection-panel"
              aria-label={collection + " articles"}
            >
              <header className="list-heading">
                <div className="section-label">
                  <LibraryBig /> {live ? "Subscriptions" : "Your library"}
                </div>
                <div className="list-title">
                  <h1 tabIndex={-1} ref={title}>
                    {collection}
                  </h1>
                  <span
                    className="count"
                    role="status"
                    aria-label={
                      page?.text
                        ? page.total +
                          (page.total === 1 ? " match for " : " matches for ") +
                          page.text
                        : (page?.total ?? 0) + " articles"
                    }
                  >
                    {page?.total ?? 0}
                  </span>
                </div>
                <div className="list-meta">
                  <span>
                    {collection === "Inbox" && filtered(options)
                      ? "Across your library"
                      : collection === "Inbox"
                        ? (catalog?.inboxUnread ?? 0) + " unread"
                        : (page?.total ?? 0) +
                          " " +
                          (page?.total === 1 ? "article" : "articles")}
                  </span>
                  <div className="quick-sort">
                    <ArrowDownWideNarrow aria-hidden="true" />
                    <SortOrder sort={options.sort} change={changeOptions} />
                  </div>
                </div>
                {catalog && matches && (
                  <InboxControls
                    options={options}
                    change={changeOptions}
                    clear={clearOptions}
                    catalog={catalog}
                    terms={matches.terms}
                    collection={collection}
                    total={page?.total ?? 0}
                  />
                )}
                {feeds && (
                  <div className="subscription-tools">
                    <button
                      className="text-action"
                      onClick={() => setManage(true)}
                    >
                      <Rss />{" "}
                      {feeds.paired
                        ? "Manage subscriptions"
                        : "Connect browser"}
                    </button>
                    {feeds.collector.status && (
                      <p role="status">{feeds.collector.status}</p>
                    )}
                  </div>
                )}
              </header>
              <div
                className="list-scroll"
                aria-busy={page?.text !== options.text}
                ref={list}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                  const link =
                    e.target instanceof Element
                      ? e.target.closest<HTMLAnchorElement>(
                          "a.row-link, a.quick-original",
                        )
                      : null;
                  if (!link) return;
                  const target = route(link.hash);
                  if (target.id) {
                    e.preventDefault();
                    open(target.id, target.stage);
                  }
                }}
              >
                {options.grouped
                  ? page?.groups.map((group) => (
                      <PublicationGroup
                        key={group.name}
                        group={group}
                        resize={(size) =>
                          setGroupLimits((previous) =>
                            new Map(previous).set(group.name, size),
                          )
                        }
                      >
                        {group.rows.map(renderRow)}
                      </PublicationGroup>
                    ))
                  : visible.map(renderRow)}
                {!options.grouped && (page?.total ?? 0) > visible.length && (
                  <button
                    className="secondary load-more"
                    onClick={() => setLimit((n) => n + pageSize)}
                  >
                    Show more articles
                  </button>
                )}
                {page?.total === 0 && (
                  <div className="empty">
                    <BookOpen />
                    <h2>
                      {filtered(options)
                        ? "No matching articles"
                        : live && collection === "Inbox"
                          ? "No articles in the inbox"
                          : empty[collection][0]}
                    </h2>
                    <p>
                      {filtered(options)
                        ? "Try another search or clear your filters."
                        : live && collection === "Inbox"
                          ? "Add a publication in Subscriptions to collect its articles."
                          : empty[collection][1]}
                    </p>
                  </div>
                )}
              </div>
            </section>
            {current ? (
              <Reader
                key={current.a.id + "/" + (id ? stage : "preview")}
                checkOriginal={feeds?.collector.checkOriginal}
                offline={offline}
                a={current.a}
                state={current.s}
                stage={id ? stage : undefined}
                onBack={back}
                onStage={(s) => open(current.a.id, s)}
                notify={notify}
              />
            ) : (
              <section className="desk empty-desk">
                <BookOpen />
                {selected ? (
                  <p role="status">Opening article…</p>
                ) : id ? (
                  <>
                    <h2>Article unavailable</h2>
                    <button className="plain" onClick={back}>
                      <ArrowLeft /> Back to list
                    </button>
                  </>
                ) : (
                  <>
                    <h2>Reading desk</h2>
                    <p>Articles from this collection open here.</p>
                  </>
                )}
              </section>
            )}
          </main>
        )}
        <div className={"toast" + (message ? " visible" : "")} role="status">
          {message && (
            <>
              <Check />
              {message}
            </>
          )}
        </div>
        {manage && feeds && (
          <Subscriptions
            library={feeds.library}
            collector={feeds.collector}
            paired={feeds.paired}
            onClose={() => setManage(false)}
            onOpen={(id) => open(id, "original")}
          />
        )}
        {showAbout && <About onClose={() => setAbout(false)} />}
      </div>
    </LibraryContext.Provider>
  );
}
