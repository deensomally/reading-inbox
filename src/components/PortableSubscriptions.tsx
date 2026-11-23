import { useEffect, useRef, useState } from "react";
import { opmlByteLimit, type PreviewRow } from "../../shared/opml";
import { type BrowserSession, ServiceError } from "../data/connection";

type Row = Omit<PreviewRow, "status"> & {
  status: PreviewRow["status"] | "unavailable";
  outcome?: "added" | "kept" | "failed";
  message?: string;
};
const labels = {
  unavailable: "Unavailable",
  valid: "Ready to add",
  duplicate: "Duplicate",
  invalid: "Invalid",
  private: "Private",
  unsupported: "Unsupported",
  added: "Added",
  kept: "Already subscribed",
  failed: "Failed",
};
export function PortableSubscriptions({
  session,
  sync,
}: {
  session: BrowserSession;
  sync: () => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>(),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function preview(file: File) {
    setRows(undefined);
    setNotice("");
    setBusy(true);
    try {
      if (file.size > opmlByteLimit)
        throw Error("Choose an OPML file of 1 MiB or less.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const encoding =
        bytes[0] === 255 && bytes[1] === 254
          ? "utf-16le"
          : bytes[0] === 254 && bytes[1] === 255
            ? "utf-16be"
            : "utf-8";
      const xml = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      const result = await session.request<{ rows: Row[] }>(
        "opml/preview",
        "POST",
        { xml },
      );
      const checked: Row[] = [];
      const seen = new Map<string, Set<string>>();
      for (const [index, row] of result.rows.entries()) {
        if (!mounted.current) return;
        const entry = row.entry;
        if (entry) {
          setNotice(
            "Checking outline " +
              (index + 1) +
              " of " +
              result.rows.length +
              "…",
          );
          try {
            const check = await session.request<{
              canonical: string;
              active: boolean;
              storedFolder: boolean;
              title: string;
            }>("opml/check", "POST", entry);
            const folders = seen.get(check.canonical) ?? new Set<string>();
            const path = JSON.stringify(entry.folders);
            if (!entry.title && check.title) row.title = check.title;
            if (check.active || folders.size) {
              row.status = "duplicate";
              if (check.storedFolder || folders.has(path)) {
                delete row.entry;
                row.detail = "Already subscribed or listed in this file.";
              } else row.detail = "Keep this outline on export.";
            } else {
              row.status = "valid";
              row.detail = "Add subscription.";
            }
            folders.add(path);
            seen.set(check.canonical, folders);
          } catch (err) {
            if (
              !(err instanceof ServiceError) ||
              err.status === 0 ||
              err.status === 401
            )
              throw err;
            const status = [
              "public_url_required",
              "http_401",
              "http_402",
              "http_403",
            ].includes(err.code)
              ? "private"
              : [
                    "invalid_feed",
                    "discovery",
                    "encoding",
                    "too_large",
                    "robots_denied",
                  ].includes(err.code)
                ? "unsupported"
                : "unavailable";
            checked.push({
              ...row,
              status,
              entry: undefined,
              detail: err.message,
            });
            continue;
          }
        }
        checked.push(row);
      }
      setRows(checked);
      setNotice("");
    } catch (err) {
      setNotice(
        err instanceof Error ? err.message : "Could not read the OPML file.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    setBusy(true);
    setNotice("");
    try {
      const { xml } = await session.request<{ xml: string }>("opml/export");
      const href = URL.createObjectURL(
        new Blob([xml], { type: "text/x-opml;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = href;
      link.download = "reading-box-subscriptions.opml";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 30000);
      setNotice("Subscription file ready to download.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }
  const pending = (r: Row) =>
    !!r.entry && (!r.outcome || r.outcome === "failed");
  async function confirm() {
    if (!rows || busy) return;
    setBusy(true);
    setNotice("");
    try {
      for (const [index, row] of rows.entries()) {
        if (!mounted.current) break;
        if (!pending(row)) continue;
        setNotice("Importing " + row.title + "…");
        let outcome: Row["outcome"],
          message: string,
          disconnected = false;
        try {
          const result = await session.request<{
            added: boolean;
            status: string;
          }>("opml/import", "POST", row.entry);
          outcome = result.added ? "added" : "kept";
          message =
            result.status === "failed"
              ? "Subscription active. The publisher refresh failed."
              : "Included in your subscriptions.";
        } catch (err) {
          outcome = "failed";
          message =
            err instanceof Error
              ? err.message
              : "Could not confirm this subscription.";
          disconnected =
            err instanceof ServiceError && [0, 401].includes(err.status);
        }
        if (mounted.current)
          setRows((prev) =>
            prev?.map((r, i) => (i === index ? { ...r, outcome, message } : r)),
          );
        if (disconnected) break;
      }
      if (mounted.current) setNotice("");
      await sync();
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const remaining = rows?.filter(pending) ?? [];
  const additionalOutlines = remaining.filter(
    (r) => r.status === "duplicate",
  ).length;
  return (
    <section className="portable" aria-label="Portable subscriptions">
      <div className="feed-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          Import OPML
        </button>
        <button
          className="plain"
          disabled={busy}
          onClick={() => void download()}
        >
          Export OPML
        </button>
        <input
          hidden
          ref={fileInput}
          type="file"
          accept=".opml,.xml,text/xml,application/xml,text/x-opml"
          aria-label="Subscription file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void preview(file);
          }}
        />
      </div>
      {rows && (
        <div className="opml-preview">
          <h3>Import preview</h3>
          <p>Confirm to add the reviewed feeds and keep their folders.</p>
          <ul>
            {rows.map((r, i) => (
              <li key={i}>
                <strong>{r.title}</strong>
                {" · "}
                {labels[r.outcome ?? r.status]}
                {r.folders.length > 0 && <small>{r.folders.join(" / ")}</small>}
                {r.url && <small>{r.url}</small>}
                <small>{r.message ?? r.detail}</small>
              </li>
            ))}
          </ul>
          <p role="status">
            {rows.length === 0
              ? "No subscription outlines found."
              : rows.some((r) => r.outcome)
                ? rows.filter((r) => r.outcome === "added").length +
                  " added · " +
                  rows.filter((r) => r.outcome === "kept").length +
                  " already subscribed · " +
                  rows.filter((r) => r.outcome === "failed").length +
                  " failed"
                : rows.filter((r) => r.status === "valid").length +
                  " subscriptions to add" +
                  (additionalOutlines
                    ? " · " +
                      additionalOutlines +
                      " additional outlines to keep"
                    : "")}
          </p>
          <div className="feed-actions">
            {remaining.length > 0 && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void confirm()}
              >
                {rows.some((r) => r.outcome)
                  ? "Retry remaining entries"
                  : "Confirm import"}
              </button>
            )}
            <button
              className="plain"
              disabled={busy}
              onClick={() => setRows(undefined)}
            >
              {rows.some((r) => r.outcome) ? "Done" : "Cancel preview"}
            </button>
          </div>
        </div>
      )}
      {(busy || notice) && (
        <p role="status">{notice || "Working on subscriptions…"}</p>
      )}
    </section>
  );
}
