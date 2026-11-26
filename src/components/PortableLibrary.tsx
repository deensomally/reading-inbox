import { useState } from "react";
import { Dialog } from "./Dialogs";
import type { Library } from "../data/store";
import {
  exportLibrary,
  restoreLibrary,
  type RestorePreview,
} from "../data/portable-library";
import {
  parseBackup,
  backupFile,
  maxBackupBytes,
  type Backup,
  type LibraryKind,
} from "../data/backup-format";

export function PortableLibrary({
  db,
  kind,
  checkService,
  onClose,
}: {
  db: Library;
  kind: LibraryKind;
  checkService?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [backup, setBackup] = useState<Backup>();
  const [preview, setPreview] = useState<RestorePreview>();
  const [limit, setLimit] = useState(30);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function work(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Library operation failed.",
      );
      setPreview(undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Library backup"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        Save or restore this{" "}
        {kind === "demo" ? "fictional demo" : "subscriptions"} library’s reading
        state. The JSON file includes saved text and cached summaries where
        export is permitted.
      </p>
      {kind === "subscriptions" && !checkService && (
        <p>
          This is the offline, unpaired library. Pair first to restore directly
          into your service library.
        </p>
      )}
      <button
        className="secondary"
        disabled={busy}
        onClick={() =>
          void work(async () => {
            await checkService?.();
            const data = await exportLibrary(db, kind);
            const blob = backupFile(data);
            const href = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = href;
            link.download = "reading-box-" + kind + "-library-v1.json";
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(href), 30000);
            setMessage(
              "Exported " +
                data.entries.length +
                " article records, " +
                data.entries.filter((e) => e.body !== undefined).length +
                " saved texts and " +
                data.entries.reduce((n, e) => n + e.summaries.length, 0) +
                " summaries. Each record lists omissions and reasons.",
            );
          })
        }
      >
        Export library JSON
      </button>
      <hr />
      <label className="file-label">
        Library file
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0]);
            setPreview(undefined);
            setBackup(undefined);
            setMessage("");
          }}
        />
      </label>
      <button
        className="secondary"
        disabled={busy || !file}
        onClick={() =>
          void work(async () => {
            if (!file || file.size > maxBackupBytes)
              throw new Error("Choose a JSON file up to 128 MiB.");
            const data = parseBackup(await file.text(), kind);
            const checked = (await checkService?.()) ?? false;
            setPreview(await restoreLibrary(db, data, checked));
            setBackup(data);
            setLimit(30);
            setMessage(
              kind === "subscriptions" && !checked
                ? "Service unavailable. Reading state can be restored. Publisher bodies cannot be restored from this file offline."
                : "",
            );
          })
        }
      >
        Preview restore
      </button>
      {preview && backup && (
        <>
          <h3>Restore preview</h3>
          <p>
            {preview.rows.length} records ·{" "}
            {preview.rows.filter((r) => r.added).length} new ·{" "}
            {
              preview.rows.filter((r) =>
                r.kept.some(
                  (k) => k.startsWith("Local") || k.startsWith("Identity"),
                ),
              ).length
            }{" "}
            with local conflicts.
          </p>
          <p>
            Newer local changes win. Existing changes with unknown or equal
            dates also stay local.
          </p>
          <ul className="restore-list">
            {preview.rows.slice(0, limit).map((r, i) => (
              <li key={i}>
                <strong>{r.title}</strong>
                <small>
                  {[
                    r.added ? "Add article" : "",
                    ...r.changes,
                    ...r.kept,
                    ...r.omitted,
                    ...(backup.entries[i]?.omissions ?? []),
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Already matches"}
                </small>
              </li>
            ))}
          </ul>
          {preview.rows.length > limit && (
            <button
              className="text-action"
              onClick={() => setLimit((n) => n + 30)}
            >
              Show more records
            </button>
          )}
          <button
            className="primary"
            disabled={busy || !preview.rows.length}
            onClick={() =>
              void work(async () => {
                const checked = (await checkService?.()) ?? false;
                await restoreLibrary(db, backup, checked, preview);
                setMessage(
                  "Restore complete for " + preview.rows.length + " records.",
                );
                setPreview(undefined);
              })
            }
          >
            Confirm restore
          </button>
        </>
      )}
      {busy && <p role="status">Checking library…</p>}
      {message && <p role="status">{message}</p>}
    </Dialog>
  );
}
