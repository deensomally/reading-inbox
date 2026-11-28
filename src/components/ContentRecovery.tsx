import { useEffect, useState } from "react";
import type { LiveLibrary } from "../data/live-library";
import type { BrowserSession } from "../data/connection";

interface Progress {
  counts: Record<string, number>;
  latest: { title: string; status: string; detail: string }[];
}
export function ContentRecovery({
  library,
  session,
  sync,
}: {
  library: LiveLibrary;
  session: BrowserSession;
  sync: () => Promise<void>;
}) {
  const [progress, setProgress] = useState<Progress>();
  const [busy, setBusy] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    let previous = "";
    const update = async () => {
      try {
        const p = await session.request<Progress>("recovery");
        if (!active) return;
        setDisconnected(false);
        setProgress(p);
        const key = JSON.stringify(p.counts);
        if (previous && previous !== key) await sync();
        previous = key;
      } catch {
        if (active) setDisconnected(true);
      }
    };
    void update();
    const timer = setInterval(() => void update(), 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session, sync]);
  async function recover() {
    setBusy(true);
    setMessage("");
    try {
      const saved = await library.states.filter((s) => s.saved).primaryKeys();
      for (let i = 0; i < Math.max(1, saved.length); i += 100) {
        const articles = await library.articles.bulkGet(
          saved.slice(i, i + 100),
        );
        const ids = articles.flatMap((a) =>
          a?.library === "subscriptions" ? [a.sourceKey] : [],
        );
        setProgress(
          await session.request<Progress>("recovery", "POST", {
            saved: ids,
            start: i === 0,
          }),
        );
      }
      await sync();
      setMessage(
        "Recovery requested. Keep the feed service running. You can close the reader.",
      );
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Could not start recovery.",
      );
    } finally {
      setBusy(false);
    }
  }
  const c = progress?.counts ?? {};
  return (
    <section className="content-recovery">
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void recover()}
      >
        Recover article content
      </button>
      {progress && (
        <p role="status">
          {(c.queued ?? 0) + (c.working ?? 0) + (c.retry ?? 0)} remaining ·{" "}
          {c.recovered ?? 0} recovered · {c.complete ?? 0} complete from feed or
          already retained · {c.partial ?? 0} partial ·{" "}
          {(c.access ?? 0) + (c.restricted ?? 0) + (c.unavailable ?? 0)}{" "}
          unavailable or restricted · {c.failed ?? 0} failed
        </p>
      )}
      {disconnected && (
        <p role="status">
          Recovery progress is available when the feed service is running.
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!!progress?.latest.length && (
        <details>
          <summary>Recent outcomes</summary>
          <ul>
            {progress.latest.map((r, i) => (
              <li key={i}>
                <strong>{r.title}</strong> · {r.detail}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
