import { PortableSubscriptions } from "./PortableSubscriptions";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ExternalLink, Rss } from "lucide-react";
import { Dialog } from "./Dialogs";
import { BrowserSession, pairBrowser, ServiceError } from "../data/connection";
import { collect, LiveLibrary, type ChangeRequest } from "../data/live-library";
import { debianReview } from "../../shared/reviewed-article";
import type { OriginalCheck } from "../../shared/original";
export function useCollector(library: LiveLibrary, session?: BrowserSession) {
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [needsCode, setNeedsCode] = useState(false);
  const [feedback, setFeedback] = useState("");
  const active = useRef<Promise<void> | undefined>(undefined);
  const sync = useCallback(() => {
    if (!session) return Promise.resolve();
    if (active.current) return active.current;
    setBusy(true);
    const work = collect(library, session)
      .then((message) => {
        setStatus("");
        if (message) setFeedback(message);
        setNeedsCode(false);
      })
      .catch((e: unknown) => {
        setStatus(
          e instanceof Error
            ? e.message
            : "The feed service could not be reached.",
        );
        setNeedsCode(e instanceof ServiceError && e.status === 401);
      })
      .finally(() => {
        setBusy(false);
        active.current = undefined;
      });
    active.current = work;
    return work;
  }, [library, session]);
  useEffect(() => {
    if (!session) return;
    const resume = () => {
      if (document.visibilityState === "visible") void sync();
    };
    resume();
    const timer = window.setInterval(resume, 60000);
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [session, sync]);
  // A collection already in progress may have read its snapshot before the change.
  const syncAfterChanges = useCallback(async () => {
    if (active.current) await active.current;
    await sync();
  }, [sync]);
  const checkOriginal = useCallback(
    async (id: string) => {
      if (!session) return;
      const confirmed = await session.request<OriginalCheck>(
        "articles/" + encodeURIComponent(id) + "/original",
        "POST",
      );
      await syncAfterChanges();
      return confirmed;
    },
    [session, syncAfterChanges],
  );
  async function queue(action: ChangeRequest["action"], value: string) {
    await library.outbox.add({ action, value });
    await syncAfterChanges();
  }
  return {
    session,
    sync,
    syncAfterChanges,
    queue,
    checkOriginal,
    status,
    busy,
    needsCode,
    feedback,
  };
}
export type Collector = ReturnType<typeof useCollector>;
function localTime(time: number) {
  return new Date(time).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}
export function Subscriptions({
  library,
  collector,
  paired,
  onClose,
  onOpen,
}: {
  library: LiveLibrary;
  collector: Collector;
  paired: boolean;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const [code, setCode] = useState(""),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [changing, setChanging] = useState(false);
  const subscriptions =
    useLiveQuery(() => library.subscriptions.toArray(), [library]) ?? [];
  const pending = useLiveQuery(() => library.outbox.toArray(), [library]) ?? [];
  const verified = useLiveQuery(async () => {
    const candidates = await library.articleList
      .filter((a) => a.title === debianReview.title)
      .primaryKeys();
    const articles = await library.articles.bulkGet(candidates);
    return articles.find(
      (a) =>
        a?.reviewedDebian && a.permissions.display && a.coverage === "complete",
    );
  }, [library]);
  async function work(fn: () => Promise<void>) {
    setError("");
    setWorking(true);
    try {
      await fn();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save this change.",
      );
    } finally {
      setWorking(false);
    }
  }
  const connect = !paired || collector.needsCode || changing;
  return (
    <Dialog title="Subscriptions" onClose={onClose}>
      {connect ? (
        <form
          className="feed-form"
          onSubmit={(e) => {
            e.preventDefault();
            void work(async () => {
              await pairBrowser(code);
              setCode("");
              setChanging(false);
            });
          }}
        >
          <p>
            Connect this browser to the feed service on your PC. Run{" "}
            <code>npm.cmd run feeds -- pair</code> in the project folder for a
            five-minute code.
          </p>
          <label htmlFor="pair-code">One-time pairing code</label>
          <input
            id="pair-code"
            type="password"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className="primary" disabled={working}>
            Connect browser
          </button>
        </form>
      ) : (
        <>
          <form
            className="feed-form"
            onSubmit={(e) => {
              e.preventDefault();
              const v = url.trim();
              if (v)
                void work(async () => {
                  await collector.queue("subscribe", v);
                  setUrl("");
                });
            }}
          >
            <label htmlFor="feed-url">Feed or publication URL</label>
            <input
              id="feed-url"
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
              placeholder="https://publication.example/feed"
              value={url}
              required
              maxLength={4096}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button className="primary" disabled={working}>
              Add subscription
            </button>
          </form>
          {!subscriptions.some(
            (f) => f.url === debianReview.feed && f.active,
          ) &&
            !pending.some((op) => op.value === debianReview.feed) && (
              <button
                className="text-action feed-example"
                disabled={working}
                onClick={() =>
                  void work(() =>
                    collector.queue("subscribe", debianReview.feed),
                  )
                }
              >
                <Rss /> Try Bits from Debian
              </button>
            )}
          {verified && (
            <button
              className="text-action feed-example"
              onClick={() => {
                onClose();
                onOpen(verified.id);
              }}
            >
              Open reviewed Debian article <ExternalLink />
            </button>
          )}
          {collector.session && (
            <PortableSubscriptions
              session={collector.session}
              sync={collector.syncAfterChanges}
            />
          )}
          <div className="feed-list">
            {subscriptions
              .filter((f) => f.active)
              .map((f) => (
                <section key={f.id} className="feed-row">
                  <h3>{f.title}</h3>
                  <p className="feed-address">{f.url}</p>
                  <p>
                    {f.lastSuccess
                      ? "Last collected " + localTime(f.lastSuccess)
                      : "Awaiting first collection"}
                    {f.paused ? " · Paused" : ""}
                  </p>
                  {f.error && (
                    <p className="notice">
                      {f.error}
                      {f.retryAfter
                        ? " Try after " + localTime(f.retryAfter) + "."
                        : ""}
                    </p>
                  )}
                  {f.possibleGapSince && (
                    <p>
                      Collection may have a gap since{" "}
                      {localTime(f.possibleGapSince)}.
                    </p>
                  )}
                  {removing === f.id ? (
                    <div>
                      <p>
                        Stop collecting this publication? Its observed articles
                        stay in your library.
                      </p>
                      <button
                        className="secondary"
                        onClick={() => {
                          setRemoving(undefined);
                          void work(() => collector.queue("unsubscribe", f.id));
                        }}
                      >
                        Confirm removal
                      </button>{" "}
                      <button
                        className="plain"
                        onClick={() => setRemoving(undefined)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="feed-actions">
                      <button
                        className="plain"
                        disabled={
                          working ||
                          pending.some((o) => o.value === f.id && !o.error)
                        }
                        onClick={() =>
                          void work(() => collector.queue("refresh", f.id))
                        }
                      >
                        Refresh
                      </button>
                      <button
                        className="plain"
                        disabled={
                          working ||
                          pending.some(
                            (o) =>
                              o.action === "unsubscribe" &&
                              o.value === f.id &&
                              !o.error,
                          )
                        }
                        onClick={() => setRemoving(f.id)}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </section>
              ))}
          </div>
          {pending.map((op) => (
            <div className="feed-row" key={op.seq}>
              <strong>
                {op.error ? "Needs attention" : "Pending"} ·{" "}
                {op.action === "subscribe"
                  ? "Add"
                  : op.action === "unsubscribe"
                    ? "Remove"
                    : "Refresh"}
              </strong>
              <p>
                {subscriptions.find((f) => f.id === op.value)?.title ??
                  op.value}
              </p>
              {op.error && (
                <>
                  <p>{op.error}</p>
                  <button
                    className="plain"
                    onClick={() =>
                      void work(async () => {
                        await library.outbox.update(op.seq!, {
                          error: undefined,
                        });
                        await collector.sync();
                      })
                    }
                  >
                    Retry change
                  </button>
                </>
              )}
              {op.error && (
                <button
                  className="plain"
                  onClick={() => void library.outbox.delete(op.seq!)}
                >
                  Dismiss change
                </button>
              )}
            </div>
          ))}
        </>
      )}
      <p role="status">
        {error ||
          collector.status ||
          (working || collector.busy
            ? "Checking the feed service…"
            : collector.feedback)}
      </p>
      {paired && (
        <div className="feed-actions">
          <button
            className="secondary"
            disabled={collector.busy}
            onClick={() => void collector.sync()}
          >
            Check for deliveries
          </button>
          {!connect && (
            <button className="plain" onClick={() => setChanging(true)}>
              Change pairing
            </button>
          )}
          {changing && (
            <button className="plain" onClick={() => setChanging(false)}>
              Cancel
            </button>
          )}
        </div>
      )}
    </Dialog>
  );
}
