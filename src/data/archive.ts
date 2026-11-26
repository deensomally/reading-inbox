import type { Library } from "./store";
import { initialState, type ReadingState } from "./model";

export function localMidnight(value: string) {
  if (!/^\d{4}-\d\d-\d\d$/.test(value)) return NaN;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(2000, 0, 1);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date.getTime()
    : NaN;
}

export function beforeDate(newestFirst: number, cutoff: number) {
  return newestFirst !== Number.MAX_SAFE_INTEGER && -newestFirst < cutoff;
}

export async function archiveBatch(
  db: Library,
  ids: readonly string[],
  operation: string,
) {
  return db.transaction(
    "rw",
    db.states,
    db.articleList,
    db.archiveUndo,
    async () => {
      if (await db.archiveUndo.get(operation)) return 0;
      const frozen = [...new Set(ids)];
      const states = await db.states.bulkGet(frozen);
      const rows = await db.articleList.bulkGet(frozen);
      const now = Date.now();
      const changes: ReadingState[] = [];
      for (const [i, id] of frozen.entries()) {
        const s = states[i] ?? initialState(id);
        if (s.archived || !rows[i]) continue;
        changes.push({
          ...s,
          archived: true,
          archiveOperation: operation,
          modified: { ...s.modified, archived: now },
        });
      }
      if (!frozen.length) return 0;
      if (changes.length !== frozen.length)
        throw new Error(
          "The selection changed in another window. Review the articles again.",
        );
      await db.states.bulkPut(changes);
      // A lightweight completion marker also makes a delayed retry harmless
      // after Undo or after a different operation supersedes this receipt.
      await db.archiveUndo.bulkPut([
        { id: operation, operation, ids: [] },
        { id: "last", operation, ids: frozen },
      ]);
      return changes.length;
    },
  );
}

export async function undoArchive(db: Library, operation: string) {
  return db.transaction("rw", db.states, db.archiveUndo, async () => {
    const last = await db.archiveUndo.get("last");
    if (last?.operation !== operation) return 0;
    const states = await db.states.bulkGet(last.ids);
    const changed = states.filter(
      (s): s is ReadingState =>
        !!s?.archived && s.archiveOperation === operation,
    );
    for (const s of changed) {
      s.archived = false;
      delete s.archiveOperation;
      s.modified = { ...s.modified, archived: Date.now() };
    }
    await db.states.bulkPut(changed);
    await db.archiveUndo.delete("last");
    return changed.length;
  });
}
