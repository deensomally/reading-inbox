import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import {
  collections,
  dateLabel,
  status,
  type Collection,
  type Stage,
} from "./data/model";
import { listUrl, navigate, readerUrl, route, useHash } from "./navigation";
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
  return route(hash).live || (!hash && lastLive) ? (
    <LiveWorkspace hash={hash} />
  ) : (
    <Workspace hash={hash} library={db} />
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
  const [manage, setManage] = useState(false);
  const [limit, setLimit] = useState(40);
  const { collection, id, stage, publisher, discussion } = route(hash);
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
    (live ? library.open() : seedLibrary(library)).then(
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
  const result = useLiveQuery(
    () =>
      loaded
        ? library.collectionPage(
            live ? "subscriptions" : "demo",
            collection,
            limit,
            id,
          )
        : undefined,
    [loaded, library, live, collection, limit, id],
  );
  const page = result?.collection === collection ? result : undefined;
  const visible = page?.rows ?? [];
  const selected = id
    ? page?.selected?.a.id === id
      ? page.selected
      : visible.find((row) => row.a.id === id)
    : visible[0];
  const selectedId = selected?.a.id;
  const article = useLiveQuery(
    () => (selectedId ? library.articles.get(selectedId) : undefined),
    [library, selectedId],
  );
  const current =
    selected && article?.id === selected.a.id
      ? { a: article, s: selected.s }
      : undefined;
  const ready = loaded && !!page;
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
    );
  }
  function back() {
    if (history.state?.fromList) history.back();
    else navigate(listUrl(collection, live), true);
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
                  <span className="count">{page?.total ?? 0}</span>
                </div>
                <div className="list-meta">
                  <span>
                    {collection === "Inbox"
                      ? (page?.unread ?? 0) + " unread"
                      : (page?.total ?? 0) +
                        " " +
                        (page?.total === 1 ? "article" : "articles")}
                  </span>
                  <span>
                    <ArrowDownWideNarrow /> Newest first
                  </span>
                </div>
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
                ref={list}
                onScroll={(e) => {
                  if (!id)
                    sessionStorage.setItem(
                      (live ? "feeds-list-" : "list-") + collection,
                      String(e.currentTarget.scrollTop),
                    );
                }}
              >
                {visible.map(({ a, s }) => (
                  <div
                    key={a.id}
                    className={
                      "article-row" +
                      (a.id === current?.a.id ? " selected" : "")
                    }
                  >
                    <a
                      className="row-link"
                      id={"row-" + a.id}
                      href={readerUrl(
                        collection,
                        a.id,
                        s.lastStage ?? "essence",
                        live,
                      )}
                      onClick={(e) => {
                        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
                          return;
                        e.preventDefault();
                        open(a.id, s.lastStage ?? "essence");
                      }}
                    >
                      <div className="row-top">
                        <span>{a.publication}</span>
                        <time dateTime={a.published ?? a.received}>
                          {dateLabel(a)}
                        </time>
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
                        {s.saved && <Bookmark aria-label="Saved" size={13} />}
                      </div>
                    </a>
                    <a
                      className="quick-original"
                      aria-label={"Read original of " + a.title}
                      title="Read original"
                      href={readerUrl(collection, a.id, "original", live)}
                      onClick={(e) => {
                        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
                          return;
                        e.preventDefault();
                        open(a.id, "original");
                      }}
                    >
                      <BookOpen />
                    </a>
                  </div>
                ))}
                {(page?.total ?? 0) > visible.length && (
                  <button
                    className="secondary load-more"
                    onClick={() => setLimit((n) => n + 40)}
                  >
                    Show more articles
                  </button>
                )}
                {!visible.length && (
                  <div className="empty">
                    <BookOpen />
                    <h2>
                      {live && collection === "Inbox"
                        ? "No articles in the inbox"
                        : empty[collection][0]}
                    </h2>
                    <p>
                      {live && collection === "Inbox"
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
